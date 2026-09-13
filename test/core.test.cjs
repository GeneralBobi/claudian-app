'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MemorySetup } = require('../core.cjs');
const allHosts = ['claude-code', 'codex', 'cursor', 'gemini-cli', 'antigravity', 'antigravity-cli'];

test('six hosts share skill aliases and Google context without duplicate writes', async t => {
  const {core, home, input} = await fixture(t);
  input.hosts = allHosts;
  const global = path.join(home, '.gemini', 'GEMINI.md');
  await fs.mkdir(path.dirname(global), {recursive:true});
  await fs.writeFile(global, '# Personal rules\nKeep this.\n');
  const plan = await core.prepare(input);
  assert.equal(new Set(plan.files.map(f => f.path)).size, plan.files.length);
  assert.equal(plan.files.filter(f => f.type === 'skill').length, 4);
  await core.install(plan.id,true);
  assert.equal((await core.snapshot()).profile.hosts.length, 6);
  const rule = await fs.readFile(global, 'utf8');
  assert.ok(rule.startsWith('# Personal rules\nKeep this.\n'));
  assert.equal(rule.split('<!-- claudian:memory:start -->').length, 2);
  assert.match(await fs.readFile(path.join(home, '.cursor/rules/claudian-memory.mdc'), 'utf8'), /alwaysApply: true/);
  assert.match(await fs.readFile(path.join(home, '.gemini/antigravity-cli/skills/claudian-memory.md'), 'utf8'), /name: claudian-memory/);
});

for (const host of allHosts.slice(2)) test(`${host} installs independently`, async t => {
  const {core,input} = await fixture(t); input.hosts = [host];
  const plan = await core.prepare(input);
  assert.equal(plan.files.filter(f => f.type === 'skill').length, 1);
  assert.equal(plan.files.filter(f => f.type === 'rule').length, 1);
  await core.install(plan.id,true);
  assert.equal((await core.snapshot()).profile.hosts[0].id, host);
});

test('add hosts to installed memory, reusing owned shared skill without changing notes', async t => {
  const {core, input} = await fixture(t);
  await core.install((await core.prepare(input)).id,true);
  const note = path.join(input.vault, '00 - Deniz (Hub).md');
  await fs.appendFile(note, '\nUser decision.\n');
  const original = await fs.readFile(note, 'utf8');
  const plan = await core.prepare({...input, action:'extend', mode:'existing', hosts:allHosts.slice(2)});
  assert.equal(plan.files.filter(f => f.type === 'note').length, 0);
  assert.equal(plan.reused.length, 1);
  await core.install(plan.id,true);
  assert.equal((await core.snapshot()).profile.hosts.length, 6);
  assert.equal(await fs.readFile(note,'utf8'), original);
});

test('changed shared skill is preserved while another host gets an isolated bridge', async t => {
  const {core, home, input} = await fixture(t);
  await core.install((await core.prepare(input)).id,true);
  await fs.appendFile(path.join(home,'.agents/skills/claudian-memory/SKILL.md'), '\nChanged');
  const plan=await core.prepare({...input, action:'extend', mode:'existing', hosts:['cursor']}); await core.install(plan.id,true); assert.match(await fs.readFile(path.join(home,'.agents/skills/claudian-memory/SKILL.md'),'utf8'), /Changed/); assert.match(await fs.readFile(path.join(home,'.agents/skills/claudian-memory-bridge/SKILL.md'),'utf8'), /name: claudian-memory-bridge/);
});

test('an existing Claudian startup block is rerouted to the selected vault with a backup', async t => {
  const {core,home,input}=await fixture(t);
  input.hosts=['claude-code'];
  const rule=path.join(home,'.claude/rules/claudian-memory.md');
  await fs.mkdir(path.dirname(rule),{recursive:true});
  const existing='<!-- claudian:memory:start -->\nAlready configured\n<!-- claudian:memory:end -->\n';
  await fs.writeFile(rule,existing);
  const plan=await core.prepare(input);
  assert.ok(plan.files.some(file=>file.path===rule&&file.operation==='append'));
  await core.install(plan.id,true);
  assert.ok((await fs.readFile(rule,'utf8')).includes(JSON.stringify(input.vault)));
  const owned=(await core.snapshot()).profile.files.find(f=>f.path===rule);
  assert.equal(await fs.readFile(owned.backup,'utf8'),existing);
  assert.equal((await core.connections())[0].status,'ready');
  assert.equal((await core.connections())[0].access.state,'granted');
});

test('an unrelated dedicated startup file is preserved using an alternate rule', async t => {
  const {core,home,input}=await fixture(t);
  input.hosts=['cursor'];
  const original=path.join(home,'.cursor/rules/claudian-memory.mdc');
  await fs.mkdir(path.dirname(original),{recursive:true});
  await fs.writeFile(original,'User rule\n');
  const plan=await core.prepare(input);
  assert.ok(plan.files.some(file=>file.path===path.join(home,'.cursor/rules/claudian-memory-bridge.mdc')));
  await core.install(plan.id,true);
  assert.equal(await fs.readFile(original,'utf8'),'User rule\n');
});

// An installed profile's language decides which text every managed protocol file in the vault
// carries, so nothing ambient may change it. It used to follow the NSIS installer marker on
// every launch: reinstalling in the other language flipped the profile, the upgrade rewrote
// each protocol note and preserved the previous one as a "(yours ...)" copy, and the next run
// did the reverse. Measured 12.09.2026 on a real vault -- 18 notes, 11 of them protocol files.
test('an installed language is not changed by an ambient request, only by an explicit one', async t => {
  const {core,input}=await fixture(t);
  input.language='en';
  await core.install((await core.prepare(input)).id,true);

  assert.equal(await core.useLanguage('tr'),false,'an ambient request must not flip the profile');
  let snapshot=await core.snapshot();
  assert.equal(snapshot.profile.language,'en');
  assert.equal((await core.preferences()).language,'en','the interface follows the notes, not the request');

  assert.equal(await core.useLanguage('tr',{explicit:true}),true);
  snapshot=await core.snapshot();
  assert.equal(snapshot.profile.language,'tr');
  assert.equal(snapshot.profile.vault,input.vault);
  assert.equal((await core.preferences()).language,'tr');
});

// The copy exists to protect a user edit. A managed protocol file that still matches what
// Claudian recorded writing carries no such edit, and copying it aside is how a vault ends up
// holding several byte-identical protocols -- the one thing that protocol forbids.
test('replacing an untouched protocol leaves no second copy behind', async t => {
  const {core,input}=await fixture(t);
  input.language='en';
  await core.install((await core.prepare(input)).id,true);
  const {profile}=await core.snapshot();
  const target=path.join(profile.vault,'Vault Protocol.md');
  const english=await fs.readFile(target,'utf8');

  // The exact shape that produced the duplicates: the profile now expects Turkish while the
  // file on disk is the English text this installation itself wrote, untouched.
  await fs.writeFile(core.configFile,JSON.stringify({...profile,language:'tr',migration:{target:'9.9.9',conflicts:[target]}}));
  const result=await core.adoptProtocol();
  assert.equal(result.replaced,1);
  assert.deepEqual(result.kept,[],'an untouched file needs no "(yours ...)" copy');
  assert.deepEqual((await fs.readdir(profile.vault)).filter(n=>n.includes('(yours ')),[]);
  assert.notEqual(await fs.readFile(target,'utf8'),english,'the current protocol is installed');
});

test('Gemini custom context filename is respected without modifying settings', async t => {
  const {core,home,input} = await fixture(t);
  await fs.mkdir(path.join(home,'.gemini'));
  const settings = JSON.stringify({context:{fileName:['CONTEXT.md']}});
  await fs.writeFile(path.join(home,'.gemini/settings.json'), settings);
  const plan = await core.prepare({...input, hosts:['gemini-cli','antigravity']});
  assert.ok(plan.files.some(f => f.path === path.join(home,'.gemini/CONTEXT.md')));
  assert.ok(plan.files.some(f => f.path === path.join(home,'.gemini/GEMINI.md')));
  await core.install(plan.id,true);
  // The context filename and unrelated keys are untouched; only vault access is added.
  const after = JSON.parse(await fs.readFile(path.join(home,'.gemini/settings.json'),'utf8'));
  assert.deepEqual(after.context.fileName, ['CONTEXT.md']);
  assert.deepEqual(after.context.includeDirectories, [input.vault]);
});

test('discovery does not infer Cursor or Antigravity from a shared skills directory', async t => {
  const {core,home} = await fixture(t);
  await fs.mkdir(path.join(home,'.agents'));
  await fs.mkdir(path.join(home,'.codex'));
  const state = await core.snapshot();
  assert.equal(state.hosts.find(h => h.id === 'codex').configurationFound,true);
  assert.equal(state.hosts.find(h => h.id === 'antigravity').configurationFound,false);
});

// Cursor was taken off the list on 13.09.2026. A new installation must not offer or accept it,
// and a connection an earlier version made must still be removable by the current one.
test('a retired host is neither offered nor accepted, and an earlier connection to it still comes off cleanly', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-retired-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'); await fs.mkdir(path.join(home, '.cursor'), {recursive: true});
  const dataDir = path.join(root, 'data');
  const input = { name: 'Deniz', vault: path.join(root, 'notes'), mode: 'new', storage: 'obsidian', hosts: ['cursor'] };
  const current = new MemorySetup({ home, dataDir });
  assert.ok(!(await current.snapshot()).hosts.some(h => h.id === 'cursor'), 'not listed for selection');
  assert.ok(!(await current.discover()).suggested.hosts.includes('cursor'), 'not suggested even when its folder exists');
  await assert.rejects(current.prepare(input), /desteklenen/);
  const earlier = new MemorySetup({ legacy: true, home, dataDir });
  await earlier.install((await earlier.prepare({...input, hosts: ['codex', 'cursor']})).id, true);
  const rule = path.join(home, '.cursor/rules/claudian-memory.mdc');
  assert.ok(await fs.readFile(rule, 'utf8'));
  await current.removeHost('cursor');
  await assert.rejects(fs.readFile(rule, 'utf8'), {code: 'ENOENT'});
  assert.deepEqual((await current.snapshot()).profile.hosts.map(h => h.id), ['codex']);
});
test('unverified hosts get a named access step instead of a guessed file write', async t => {
  const {core,input} = await fixture(t);
  input.hosts = ['cursor','antigravity','antigravity-cli'];
  const plan = await core.prepare(input);
  assert.equal(plan.files.filter(f => f.type === 'grant').length, 0, 'no grant is invented for an unverified host');
  await core.install(plan.id,true);
  for (const connection of await core.connections()) {
    assert.equal(connection.access.state, 'manual');
    assert.ok(connection.access.step.includes(input.vault), 'the step names the exact folder');
  }
});
test('the working agreements note ships, is linked, and states that it is never invented', async t => {
  const {core,input} = await fixture(t);
  await core.install((await core.prepare(input)).id,true);
  const note = await fs.readFile(path.join(input.vault,'Working Agreements.md'),'utf8');
  // `directive`, not `method`: this is the user's own brief and steering, which the protocol
  // names as the one note type that prevents the same friction recurring.
  assert.match(note, /type: directive/);
  assert.match(note, /claudian_role: agreements/, 'the role is the address; the filename is only what the user sees');
  assert.match(note, /in your own words/);
  assert.match(note, /Never invented/, 'the note must refuse fabricated agreements on its face');
  assert.match(await fs.readFile(path.join(input.vault,'00 - Deniz (Hub).md'),'utf8'), /\[\[Working Agreements/);
  const protocol = await fs.readFile(path.join(input.vault,'Vault Protocol.md'),'utf8');
  assert.match(protocol, /Working agreements/, 'the protocol has to explain how they accumulate');
  assert.match(protocol, /That looks like this/, 'rules are carried as cases, not only as prohibitions');
});
async function fixture(t, emit) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'); await fs.mkdir(home);
  const core = new MemorySetup({legacy:true, home, dataDir: path.join(root, 'data'), emit });
  return { root, home, core, input: { name: 'Deniz', vault: path.join(root, 'Notlar Türkçe'), mode: 'new', storage: 'obsidian', hosts: ['claude-code', 'codex'] } };
}
test('new install uses exact custom path, both adapters, durable profile and live logs', async t => {
  const events = []; const { core, home, input } = await fixture(t, e => events.push(e));
  const plan = await core.prepare(input);
  assert.equal(await fs.readdir(home).then(x => x.length), 0, 'preview does not mutate host files');
  assert.equal(plan.files.filter(f=>f.type==='mcp'&&f.host==='claude-code').length,1);
  // One protocol note and one entry map: the starter must never ship competing entry points.
  const notes = plan.files.filter(f => f.type === 'note').map(f => path.basename(f.path));
  assert.deepEqual(notes.filter(n => /Protocol/.test(n)), ['Vault Protocol.md']);
  assert.equal(notes.filter(n => /^00 - /.test(n)).length, 1);
  // The structure the reference vault relies on, and one adapter per selected application.
  for (const required of ['Start Here.md', 'System.md', 'Graph View.md', 'Claudian.md', 'Connected Tools.md', 'Control Panel.md', 'Reminders.md', 'Record Guide.md'])
    assert.ok(notes.includes(required), 'the starter must ship ' + required);
  assert.ok(notes.includes('Claude Code.md') && notes.includes('Codex.md'), 'each selected application gets an adapter note');
  // Claude Code and Codex both get a verified access grant; unverified hosts get a step.
  assert.equal(plan.files.filter(f => f.type === 'grant').length, 2);
  assert.deepEqual(plan.files.filter(f => f.type === 'grant').map(f => f.host).sort(), ['claude-code', 'codex']);
  await core.install(plan.id,true);
  const snapshot = await core.snapshot();
  assert.equal(snapshot.profile.hosts.length, 2);
  assert.equal(snapshot.profile.mode, 'memory');
  for (const dir of ['.claude', '.agents']) {
    const text = await fs.readFile(path.join(home, dir, 'skills', 'claudian-memory', 'SKILL.md'), 'utf8');
    assert.ok(text.includes(JSON.stringify(input.vault)));
  }
  assert.ok(events.some(e => e.stage === 'complete'));
  assert.ok((await core.activity()).length >= 10);
  await assert.rejects(core.prepare(input), /zaten kurulu/);
});
test('existing Turkish vault is preserved byte for byte', async t => {
  const { core, input } = await fixture(t); input.mode = 'existing';
  await fs.mkdir(input.vault);
  const note = path.join(input.vault, 'Vault Protokolü.md');
  await fs.writeFile(note, 'Özgün protokol\n');
  const plan = await core.prepare(input);
  // The vault already carries a protocol under its own name, so no second one is added — two
  // active copies of one rule is exactly what that protocol forbids.
  const added = plan.files.filter(f => f.type === 'note').map(f => path.basename(f.path));
  assert.ok(!added.some(n => /Protocol/i.test(n)), 'the existing protocol is not duplicated');
  await core.install(plan.id,true);
  assert.equal(await fs.readFile(note, 'utf8'), 'Özgün protokol\n');
  assert.ok((await fs.readdir(input.vault)).includes('00 - Deniz (Hub).md'));
});
test('unknown existing Markdown vault gets separate protocol, preserves other notes', async t => {
  const { core, input } = await fixture(t); input.mode = 'existing';
  await fs.mkdir(input.vault); await fs.writeFile(path.join(input.vault, 'My note.md'), 'keep');
  const plan = await core.prepare(input); await core.install(plan.id,true);
  assert.equal(await fs.readFile(path.join(input.vault, 'My note.md'), 'utf8'), 'keep');
  // A folder with no protocol of its own gets exactly one, under a name in its own language.
  assert.deepEqual((await fs.readdir(input.vault)).filter(n => /Protocol/i.test(n)), ['Vault Protocol.md']);
});
test('existing host skill survives isolated installation', async t => {
  const { core, home, input } = await fixture(t);
  const folder = path.join(home, '.claude', 'skills', 'claudian-memory'); await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'SKILL.md'), 'user content');
  const plan=await core.prepare(input); await core.install(plan.id,true);
  assert.equal(await fs.readFile(path.join(folder, 'SKILL.md'), 'utf8'), 'user content');
});
test('preview-to-install race refuses to overwrite new content', async t => {
  const { core, input } = await fixture(t); const plan = await core.prepare(input);
  await fs.mkdir(input.vault); await fs.writeFile(path.join(input.vault, '00 - Deniz (Hub).md'), 'concurrent note');
  await assert.rejects(core.install(plan.id,true), /hedef dosya/);
  assert.equal(await fs.readFile(path.join(input.vault, '00 - Deniz (Hub).md'), 'utf8'), 'concurrent note');
  assert.equal((await core.snapshot()).profile, null);
});
test('cancel rolls back owned files, profile remains uncommitted', async t => {
  let core; const f = await fixture(t, e => { if (e.message === '00 - Deniz (Hub).md hazır.') core.cancel(); }); core = f.core;
  const plan = await core.prepare(f.input);
  await assert.rejects(core.install(plan.id,true), /iptal/);
  assert.deepEqual(await fs.readdir(f.input.vault), []);
  assert.equal((await core.snapshot()).profile, null);
});
test('read/write verification requires nonce from input, not merely skill installation', async t => {
  const { core, input } = await fixture(t); const plan = await core.prepare(input); await core.install(plan.id,true);
  const challenge = await core.challenge('codex');
  const h = (await core.snapshot()).profile.hosts.find(h => h.id === 'codex');
  assert.ok(!challenge.prompt.includes(h.challenge.nonce));
  assert.equal((await core.verify('codex')).verified, false);
  await fs.writeFile(h.challenge.output, 'incorrect');
  assert.equal((await core.verify('codex')).verified, false);
  await fs.writeFile(h.challenge.output, h.challenge.nonce);
  assert.equal((await core.verify('codex')).verified, true);
  assert.equal((await core.snapshot()).profile.hosts.find(h => h.id === 'codex').status, 'verified');
});
test('junction destinations are refused', async t => {
  const { core, root, input } = await fixture(t);
  const actual = path.join(root, 'actual'); await fs.mkdir(actual);
  await fs.symlink(actual, input.vault, 'junction');
  await assert.rejects(core.prepare(input), /junction/);
});
test('invalid config is preserved rather than reset', async t => {
  const { core } = await fixture(t); await fs.mkdir(core.dataDir); await fs.writeFile(core.configFile, 'invalid');
  await assert.rejects(core.snapshot(), /korundu/);
  assert.equal(await fs.readFile(core.configFile, 'utf8'), 'invalid');
});
test('discovery offers a new folder without implicitly selecting a registered personal vault', async t => {
  const { core, home, input } = await fixture(t);
  const settings = path.join(home, 'AppData', 'Roaming', 'obsidian'); await fs.mkdir(settings, { recursive:true });
  await fs.mkdir(input.vault); await fs.mkdir(path.join(home,'.codex'));
  await fs.writeFile(path.join(settings,'obsidian.json'), JSON.stringify({vaults:{example:{path:input.vault}}}));
  const result = await core.discover();
  assert.equal(result.suggested.vault,path.join(home,'Documents','Claudian')); assert.equal(result.suggested.mode,'new');
  assert.deepEqual(result.vaults,[input.vault]);
  await fs.mkdir(result.suggested.vault,{recursive:true});
  assert.equal((await core.discover()).suggested.vault,path.join(home,'Documents','Claudian 2'));
  assert.deepEqual(result.suggested.hosts,['codex']); assert.equal((await core.snapshot()).profile,null);
  assert.deepEqual(await fs.readdir(input.vault),[]);
});
test('automatic startup preserves Codex instructions and backs up the original', async t => {
  const { core, home, input } = await fixture(t);
  const codexDir = path.join(home,'.codex'); await fs.mkdir(codexDir);
  const instructions = path.join(codexDir,'AGENTS.override.md');
  await fs.writeFile(instructions,'# Existing user instructions\nKeep my rules.\n');
  const plan = await core.prepare(input);
  assert.ok(plan.files.some(f=>f.path === instructions && f.operation === 'append'));
  assert.ok(plan.files.every(f=> !('previous' in f) && !('content' in f)));
  await core.install(plan.id,true);
  const text = await fs.readFile(instructions,'utf8');
  assert.ok(text.startsWith('# Existing user instructions\nKeep my rules.\n'));
  assert.ok(text.includes('Do not wait for a slash command'));
  const profile = (await core.snapshot()).profile;
  const changed = profile.files.find(f=>f.path === instructions);
  assert.equal(await fs.readFile(changed.backup,'utf8'),'# Existing user instructions\nKeep my rules.\n');
  assert.ok((await fs.readFile(path.join(home,'.claude','rules','claudian-memory.md'),'utf8')).includes('At the start of each new conversation'));
});
test('changed global instructions after preview are not overwritten', async t => {
  const { core, home, input } = await fixture(t);
  const dir=path.join(home,'.codex'); await fs.mkdir(dir);const file=path.join(dir,'AGENTS.md');
  await fs.writeFile(file,'old');const plan=await core.prepare(input);await fs.writeFile(file,'new user rule');
  await assert.rejects(core.install(plan.id,true),/talimat dosyası değişti/);
  assert.equal(await fs.readFile(file,'utf8'),'new user rule');
});
