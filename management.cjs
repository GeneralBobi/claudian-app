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
  Setup.prototype.hostPaths = async function(profile, id) {
    const host = profile.hosts.find(h=>h.id===id);
    if (!host || !HOSTS[id]) throw new Error('Connection not found.');
    if (host.artifacts) return host.artifacts;
    // Migrate 0.3/0.4 profiles in memory, without touching installed instructions.
    const definition = HOSTS[id];
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
      const files = await this.hostPaths(profile,host.id);
      const details = [];
      for (const [kind,file] of Object.entries(files)) {
        let status = 'missing';
        try {
          await assertOrdinaryPath(file);
          const content = await fs.readFile(file);
          const owned = profile.files.find(f=>f.path===file);
          status = owned?.hash === hash(content) ? 'ready' : 'changed';
        } catch (e) { if (e.code !== 'ENOENT') status = 'unreadable'; }
        details.push({kind,path:file,status});
      }
      return {id:host.id,label:host.label,files:details,status:details.every(f=>f.status==='ready') ? 'ready' : 'attention'};
    }));
  };
  Setup.prototype.checkFiles = async function() {
    if (this.running) throw new Error('Please wait for the current operation.');
    const profile = await json(this.configFile);
    if (!profile) throw new Error('Memory is not configured.');
    await assertOrdinaryPath(profile.vault);
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
        keep.add(paths.skill); keep.add(paths.rule);
      }
      // A shared Google rule can reference the skill originally installed for another host.
      // Keep that dependency until the last rule using it is removed.
      for (const file of [...keep]) {
        const body = await fs.readFile(file,'utf8').catch(()=> '');
        for (const owned of profile.files) if (body.includes(JSON.stringify(owned.path))) keep.add(owned.path);
      }
      const isNote = file => { const rel = path.relative(profile.vault,file); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
      const candidates = profile.files.filter(f => !isNote(f.path) && !keep.has(f.path));
      const changes = [];
      for (const file of candidates) {
        await assertOrdinaryPath(file.path);
        if (!await exists(file.path)) continue;
        const before = await fs.readFile(file.path,'utf8');
        let after = null;
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
