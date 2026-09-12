'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
module.exports = (Setup, {HOSTS, hash, assertOrdinaryPath, json, atomicJson, exists}) => {
  Setup.prototype.preferences = async function(language) {
    const file = path.join(this.dataDir, 'preferences.json');
    if (language !== undefined) {
      if (!['en','tr'].includes(language)) throw new Error('Invalid language.');
      await atomicJson(file, {language});
    }
    return await json(file, {language:'en'});
  };
  Setup.prototype.useLanguage = async function(language) {
    if (!['en','tr'].includes(language)) throw new Error('Invalid language.');
    await this.preferences(language);
    const profile = await json(this.configFile);
    if (!profile || profile.language === language) return false;
    await atomicJson(this.configFile, {...profile, language});
    return true;
  };
  Setup.prototype.hostPaths = async function(profile, id) {
    const host = profile.hosts.find(h=>h.id===id);
    if (!host || !HOSTS[id]) throw new Error('Connection not found.');
    if (host.artifacts) return host.artifacts;
    // Migrate 0.3/0.4 profiles in memory, without touching installed instructions.
    const definition = HOSTS[id];
    if (definition.kind === 'remote') return {};
    if (definition.kind === 'mcp') return {config: require('./mcp-hosts.cjs').configFile(this.home)};
    const skill = path.join(this.home,...definition.parts,definition.filename || 'SKILL.md');
    let rule = path.join(this.home,'.claude/rules/claudian-memory.md');
    if (id === 'cursor') rule = path.join(this.home,'.cursor/rules/claudian-memory.mdc');
    if (id === 'codex') rule = profile.files.find(f => ['AGENTS.md','AGENTS.override.md'].includes(path.basename(f.path)) && path.dirname(f.path) === this.codexHome)?.path || path.join(this.codexHome,'AGENTS.md');
    if (['gemini-cli','antigravity','antigravity-cli'].includes(id)) {
      let name = 'GEMINI.md';
      if (id === 'gemini-cli') {
        const settings = await json(path.join(this.home,'.gemini/settings.json'),{});
        const names = settings.context?.fileName;
        name = (Array.isArray(names) ? names[0] : names) || name;
        if (typeof name !== 'string' || path.basename(name) !== name) throw new Error('Unsupported context filename.');
      }
      rule = path.join(this.home,'.gemini',name);
    }
    return {skill,rule};
  };
  Setup.prototype.connections = async function() {
    const profile = await json(this.configFile);
    if (!profile) return [];
    return Promise.all(profile.hosts.map(async host => {
      if(HOSTS[host.id].kind==='remote'&&!this.tunnelUrl)return {id:host.id,label:host.label,files:[],
        access:{state:'unavailable',scope:profile.access,step:require('./mcp-hosts.cjs').chatgptStep(null,profile.language)},
        artifacts:{},hookTrust:null,status:'attention'};
      // artifacts carries path entries plus an access descriptor; only paths are read.
      const {access = null, ...files} = await this.hostPaths(profile,host.id);
      const details = [];
      for (const [kind,file] of Object.entries(files)) {
        if (!['skill','rule','config','hooks'].includes(kind) || typeof file !== 'string') continue;
        let status = 'missing';
        try {
          await assertOrdinaryPath(file);
          const content = await fs.readFile(file);
          const owned = profile.files.find(f=>f.path===file);
          status = owned?.hash === hash(content) ? 'ready' : 'changed';
        } catch (e) { if (e.code !== 'ENOENT') status = 'unreadable'; }
        details.push({kind,path:file,status});
      }
      if (HOSTS[host.id].kind === 'mcp' && access?.file && !details.some(f=>f.path===access.file)) {
        let status='missing';
        try {
          await assertOrdinaryPath(access.file);
          const content=await fs.readFile(access.file);
          status=profile.files.find(f=>f.path===access.file)?.hash===hash(content)?'ready':'changed';
        } catch(e) { if(e.code!=='ENOENT')status='unreadable'; }
        details.push({kind:'config',path:access.file,status});
      }
      return {id:host.id,label:host.label,files:details,access,artifacts:host.artifacts||{},hookTrust:host.artifacts?.hookTrust||null,status:details.length>0 && details.every(f=>f.status==='ready') ? 'ready' : 'attention'};
    }));
  };
  // "Files are installed" and "the model actually reads them" are different claims.
  // Installation is observable; model behaviour is only observable through a real
  // read/write round trip, and that proof goes stale when the protocol changes.
  // Skipping is allowed; pretending it did not happen is not. The record keeps the panel
  // honest about an install that was never proven inside an AI.
  Setup.prototype.skipVerification = async function() {
    const profile = await json(this.configFile);
    if (!profile) throw new Error('Memory is not configured.');
    if (profile.hosts.some(h => h.status === 'verified')) return { skipped: false };
    await atomicJson(this.configFile, { ...profile, verificationSkippedAt: new Date().toISOString() });
    return { skipped: true };
  };
  const MANAGED_PROTOCOLS = require('./policy.cjs').MANAGED_PROTOCOLS;
  // A conflict the user cannot resolve is a dead end, not a safeguard. This backs up their
  // version beside the note and installs the current protocol, so the choice stays theirs.
  Setup.prototype.adoptProtocol = async function() {
    if (this.running) throw new Error('Please wait for the current operation.');
    const profile = await json(this.configFile);
    if (!profile) throw new Error('Memory is not configured.');
    const policy = require('./policy.cjs');
    const targets = (profile.migration?.conflicts || []).filter(file => {
      const rel = path.relative(profile.vault, file);
      return rel && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) && MANAGED_PROTOCOLS.includes(path.basename(file));
    });
    if (!targets.length) throw new Error('There is no protocol file waiting to be replaced.');
    this.running = true;
    const replaced = [];
    try {
      const stamp = new Date().toISOString().slice(0,10);
      const updated = new Map(profile.files.map(f => [f.path, f]));
      for (const file of targets) {
        const expected=policy.protocol(profile.language,path.basename(file));
        await assertOrdinaryPath(file);
        const before = await fs.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
        if (before === expected) continue;
        if (before !== null) {
          const kept = path.join(path.dirname(file), `${path.basename(file, '.md')} (yours ${stamp}).md`);
          await assertOrdinaryPath(kept);
          await fs.writeFile(kept, before, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
          replaced.push({ file, kept });
        }
        await fs.writeFile(file, expected);
        updated.set(file, { ...updated.get(file), path: file, type: 'note', hash: hash(expected), backup: updated.get(file)?.backup ?? null });
      }
      await atomicJson(this.configFile, { ...profile, files: [...updated.values()], protocolVersion: policy.VERSION, migration: { target: policy.VERSION, conflicts: [], backup: profile.migration?.backup ?? null } });
      return { replaced: replaced.length, kept: replaced.map(r => path.basename(r.kept)) };
    } finally { this.running = false; }
  };
  Setup.prototype.health = async function() {
    const profile = await json(this.configFile);
    if (!profile) return null;
    let lastChange = null;
    let vaultMissing = false;
    try {
      for (const entry of await fs.readdir(profile.vault, {withFileTypes:true})) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.claudian-check')) continue;
        const at = (await fs.stat(path.join(profile.vault, entry.name))).mtime.toISOString();
        if (!lastChange || at > lastChange.at) lastChange = {at, name: entry.name};
      }
    } catch (e) {
      // Swallowing this was the silent failure in miniature: the folder was gone and the
      // panel reported "no changes yet", which reads as calm rather than broken.
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      vaultMissing = true;
    }
    const maintenance=await require('./memory-runtime.cjs').status(this.dataDir);
    const hosts = profile.hosts.map(host => {
      let state = 'unverified';
      if (host.verifiedAt) state = (host.verifiedProtocol === profile.protocolVersion && host.verifiedVault === profile.vault) ? 'verified' : 'stale';
      return {id: host.id, label: host.label, verifiedAt: host.verifiedAt || null, state, maintenance:maintenance.find(m=>m.host===host.id)||null};
    });
    const verifiedCount = hosts.filter(h => h.state === 'verified').length;
    return {lastChange, hosts, verifiedCount, everVerified: hosts.some(h => h.verifiedAt), skippedAt: profile.verificationSkippedAt || null, vaultMissing, vault: profile.vault};
  };
  /**
   * Moves the memory to a different notes folder.
   *
   * Until now the folder was chosen once during setup and could never be changed. When it
   * was moved or deleted the app had no answer: activity() threw ENOENT and the panel was
   * stuck on a path that no longer existed. The folder also has to be changeable on its own
   * merits -- people reorganise their disks.
   *
   * Everything that names the old path is rewritten: the access rules granted to each host,
   * the recorded file list, and then upgrade() which rebuilds the skill, the startup rule
   * and the notes at the new location. Verification is deliberately NOT carried over -- the
   * proof was about a folder that is no longer the one in use, so health() shows it as stale
   * and asks for the check again.
   */
  Setup.prototype.relocate = async function(target) {
    if (this.running) throw new Error('Please wait for the current operation.');
    const profile = await json(this.configFile);
    if (!profile) throw new Error('Memory is not configured.');
    if (typeof target !== 'string' || !target.trim() || !path.isAbsolute(target) || target.length > 500 || /[\x00-\x1f]/.test(target)) {
      throw new Error('Tam klasör yolu gerekli.');
    }
    const next = path.resolve(target);
    const previousVault = path.resolve(profile.vault);
    // Pointing at the same path is a no-op only while that folder still exists; when it has
    // been deleted, the same call is how the user asks for it to be created again.
    if (next === previousVault && await exists(next)) throw new Error('Not klasörü zaten burada.');
    await assertOrdinaryPath(next);
    await fs.mkdir(next, {recursive: true});
    if (!(await fs.stat(next)).isDirectory()) throw new Error('Seçilen yol bir klasör değil.');

    const grants = require('./grants.cjs');
    this.running = true;
    const moved = [];
    try {
      // Access first. A memory the model cannot read is the failure this product exists to
      // prevent, so the new folder is granted before anything starts pointing at it.
      for (const host of profile.hosts) {
        const plan = await grants.planFor(host.id, this.home, next, async file => {
          await assertOrdinaryPath(file);
          return await exists(file) ? await fs.readFile(file, 'utf8') : null;
        }, profile.access === 'write' ? 'write' : 'read', this.codexHome);
        if (plan.manual || plan.satisfied || !plan.file) continue;
        let content = plan.content;
        // Withdraw the old folder from the same file, so stale grants do not accumulate.
        if (plan.previous !== null) {
          const withdrawn = grants.revokeFor(host.id, plan.previous, previousVault);
          if (withdrawn !== null) {
            const replan = await grants.planFor(host.id, this.home, next, async () => withdrawn, profile.access === 'write' ? 'write' : 'read', this.codexHome);
            if (replan.file && replan.content) content = replan.content;
            else if (replan.satisfied) content = withdrawn;
          }
        }
        await assertOrdinaryPath(plan.file);
        await fs.mkdir(path.dirname(plan.file), {recursive: true});
        await fs.writeFile(plan.file, content);
        moved.push({host: host.id, file: plan.file});
      }

      const inside = file => {
        const rel = path.relative(previousVault, file);
        return rel === '' || (rel && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
      };
      await atomicJson(this.configFile, {
        ...profile,
        vault: next,
        files: (profile.files || []).map(f => inside(f.path) ? {...f, path: path.join(next, path.relative(previousVault, f.path))} : f),
      });
    } finally { this.running = false; }

    // upgrade() rebuilds the skill, the rule and the notes from profile.vault, which now
    // points at the new folder. It takes this.running itself, so it runs outside the block.
    const rebuilt = await this.upgrade(undefined,{restoreMissingProtocols:true});
    return {vault: next, previousVault, grants: moved, changed: rebuilt.changed, conflicts: rebuilt.conflicts};
  };
  /**
   * Dogrulamayi bekler ve olan biteni bildirir.
   *
   * Onceki akis kullanicidan iki program arasinda senkronizasyon gorevi yapmasini
   * istiyordu: yonergeyi kopyala, AI'a yapistir, bitmesini tahmin et, geri gel ve "Sonucu
   * kontrol et"e bas. Erken basildiginda cikan cumle "AI henuz yanit dosyasini
   * olusturmamis" idi -- ki bu bir ariza gibi okunuyor, oysa cogu zaman yalnizca "daha
   * bitmedi" demekti. Olculdu: mekanizmanin kendisi saglam, kopan sey akisti.
   *
   * Burada bekleyen taraf uygulama. Yanit dosyasi diskte belirdigi anda dogrulama
   * kendiliginde calisir; kullanici hicbir seye basmaz.
   */
  Setup.prototype.watchVerification = async function(id, emit = () => {}, options = {}) {
    const profile = await json(this.configFile);
    const host = profile?.hosts.find(h => h.id === id);
    if (!host?.challenge) throw new Error('Önce test yönergesini oluşturun.');
    const output = host.challenge.output;
    await assertOrdinaryPath(output);

    const started = Date.now();
    const LIMIT = options.limitMs ?? 180_000, STEP = options.stepMs ?? 700;
    const SETTLE = options.settleMs ?? 6000;
    // Dosya belirdikten sonra kisa bir sabir: bir yaziyi yarisinda okumak, hic okumamaktan
    // daha kotu bir sonuc uretir -- "yanit eslesmedi" der ve kullanici testi bosuna tekrarlar.
    let appearedAt = null;

    for (;;) {
      const elapsed = Date.now() - started;
      const here = await exists(output);
      if (here && appearedAt === null) { appearedAt = Date.now(); emit({state: 'writing', elapsed}); }
      if (here) {
        const outcome = await this.verify(id).catch(error => ({verified: false, message: error.message}));
        if (outcome.verified) { emit({state: 'verified', elapsed, message: outcome.message}); return outcome; }
        // Hala yaziliyor olabilir; birkac saniye daha bekle, sonra sonucu oldugu gibi ver.
        if (Date.now() - appearedAt > SETTLE) { emit({state: 'mismatch', elapsed, message: outcome.message}); return outcome; }
      } else if (elapsed > LIMIT) {
        const message = 'AI yanıt dosyasını oluşturmadı. Yönergeyi çalıştırdığından ve o uygulamanın not klasörüne yazma izni olduğundan emin ol.';
        emit({state: 'timeout', elapsed, message});
        return {verified: false, message};
      } else if (elapsed % 3500 < STEP) emit({state: 'waiting', elapsed});
      await new Promise(resolve => setTimeout(resolve, STEP));
    }
  };
  Setup.prototype.checkFiles = async function() {
    if (this.running) throw new Error('Please wait for the current operation.');
    const profile = await json(this.configFile);
    if (!profile) throw new Error('Memory is not configured.');
    await assertOrdinaryPath(profile.vault);
    // Without this the absence surfaced as ENOENT on a random probe filename, which reads as
    // a permission problem and names a file the user has never heard of.
    if (!await exists(profile.vault)) throw new Error('Not klasörü bulunamadı.');
    const probe = path.join(profile.vault,`.claudian-access-${crypto.randomUUID()}.tmp`);
    const token = crypto.randomUUID();
    let created = false;
    try {
      await fs.writeFile(probe,token,{flag:'wx'}); created = true;
      if (await fs.readFile(probe,'utf8') !== token) throw new Error('Local read/write check failed.');
    } finally { if (created && await fs.readFile(probe,'utf8').catch(()=>null) === token) await fs.unlink(probe); }
    return {vault:'ready',connections:await this.connections()};
  };
  Setup.prototype.removeHost = async function(id) {
    if (this.running) throw new Error('Please wait for the current operation.');
    this.running = true;
    const changed = [];
    try {
      const profile = await json(this.configFile);
      if (!profile?.hosts.some(h=>h.id===id)) throw new Error('Connection not found.');
      const keep = new Set();
      for (const host of profile.hosts.filter(h=>h.id!==id)) {
        const paths = await this.hostPaths(profile,host.id);
        for (const kind of ['skill','rule','config','hooks']) if(typeof paths[kind]==='string')keep.add(paths[kind]);
        if(paths.access?.file)keep.add(paths.access.file);
      }
      // A shared Google rule can reference the skill originally installed for another host.
      // Keep that dependency until the last rule using it is removed.
      for (const file of [...keep]) {
        const body = await fs.readFile(file,'utf8').catch(()=> '');
        for (const owned of profile.files) if (body.includes(JSON.stringify(owned.path))) keep.add(owned.path);
      }
      const isNote = file => { const rel = path.relative(profile.vault,file); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
      const candidates = profile.files.filter(f => !isNote(f.path) && !keep.has(f.path) && (f.type !== 'grant' || !f.host || f.host === id));
      const changes = [];
      for (const file of candidates) {
        await assertOrdinaryPath(file.path);
        if (!await exists(file.path)) continue;
        const before = await fs.readFile(file.path,'utf8');
        let after = null;
        // A grant lives inside the host's own settings file, which the host itself rewrites
        // whenever the user approves a prompt. Restoring a stale backup would discard those
        // approvals, so withdraw only the entries this installation added.
        if(file.type==='hooks'){
          const host=profile.hosts.find(h=>h.id===id);
          if(!host.artifacts?.hookCommand){
            if(hash(before)!==file.hash)throw Error('Hook ownership is missing; review before removal.');
            let restored=null;
            if(file.backup){await assertOrdinaryPath(file.backup);restored=await fs.readFile(file.backup,'utf8');}
            changes.push({path:file.path,before,after:restored});continue;
          }
          const config=JSON.parse(before);
          for(const event of ['UserPromptSubmit','Stop','PostToolUse'])if(Array.isArray(config.hooks?.[event])){
            config.hooks[event]=config.hooks[event].map(g=>({...g,hooks:g.hooks.filter(h=>h.command!==host.artifacts.hookCommand)})).filter(g=>g.hooks.length);
            if(!config.hooks[event].length)delete config.hooks[event];
          }
          changes.push({path:file.path,before,after:JSON.stringify(config,null,2)+'\n'});continue;
        }
        if (file.type === 'mcp') {
          const revoked=require('./mcp-hosts.cjs').mcpRevoke(before,profile.hosts.find(h=>h.id===id).artifacts?.mcpEntry);
          if(revoked!==null)changes.push({path:file.path,before,after:revoked});
          continue;
        }
        if (file.type === 'grant') {
          let revoked = require('./grants.cjs').revokeFor(file.host || id, before, profile.vault);
          if(id==='claude-desktop')revoked=require('./mcp-hosts.cjs').mcpRevoke(before,profile.hosts.find(h=>h.id===id).artifacts?.mcpEntry);
          if(id==='gemini-cli'&&profile.hosts.find(h=>h.id===id).artifacts?.mcpEntry)revoked=require('./mcp-hosts.cjs').mcpRevoke(revoked||before,profile.hosts.find(h=>h.id===id).artifacts.mcpEntry)||revoked;
          if(id==='codex')revoked=require('./codex-connector.cjs').revoke(revoked||before);
          const host=profile.hosts.find(h=>h.id===id);
          if(id==='claude-code'&&host.artifacts?.hooks===file.path&&host.artifacts.hookCommand)revoked=require('./claude-lifecycle.cjs').revoke(revoked||before,host.artifacts.hookCommand);
          if (revoked === null) continue;
          changes.push({ path: file.path, before, after: revoked });
          continue;
        }
        if (hash(before) === file.hash) {
          if (file.backup) { await assertOrdinaryPath(file.backup); after = await fs.readFile(file.backup,'utf8'); }
        } else {
          const start = '<!-- claudian:memory:start -->', end = '<!-- claudian:memory:end -->';
          if (before.split(start).length !== 2 || before.split(end).length !== 2 || before.indexOf(end) < before.indexOf(start)) throw new Error('A connection file was modified. Review its configuration before removing it.');
          after = before.replace(/\r?\n?<!-- claudian:memory:start -->[\s\S]*?<!-- claudian:memory:end -->\r?\n?/, '');
          // No unrelated edits are discarded, even when this leaves an empty dedicated rule.
        }
        changes.push({path:file.path,before,after});
      }
      const journal = path.join(this.dataDir,'removals',crypto.randomUUID()+'.json');
      await atomicJson(journal,{host:id,changes,startedAt:new Date().toISOString()});
      for (const change of changes) {
        await assertOrdinaryPath(change.path);
        if (await fs.readFile(change.path,'utf8') !== change.before) throw new Error('Configuration changed during removal. Please try again.');
        if (change.after === null) await fs.unlink(change.path);
        else await fs.writeFile(change.path,change.after);
        changed.push(change);
      }
      if (JSON.stringify(await json(this.configFile)) !== JSON.stringify(profile)) throw new Error('Configuration changed during removal. Please try again.');
      const removed = new Set(candidates.map(f=>f.path));
      await atomicJson(this.configFile,{...profile,hosts:profile.hosts.filter(h=>h.id!==id),files:profile.files.filter(f=>!removed.has(f.path))});
      return {removed:id,notesPreserved:true};
    } catch (error) {
      for (const change of changed.reverse()) {
        const current = await fs.readFile(change.path,'utf8').catch(e=>e.code==='ENOENT' ? null : undefined);
        if (current === change.after) await fs.writeFile(change.path,change.before);
      }
      throw error;
    } finally { this.running = false; }
  };
};
