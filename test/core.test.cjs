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
  await core.install(plan.id);
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
  await core.install(plan.id);
  assert.equal((await core.snapshot()).profile.hosts[0].id, host);
});

test('add hosts to installed memory, reusing owned shared skill without changing notes', async t => {
  const {core, input} = await fixture(t);
  await core.install((await core.prepare(input)).id);
  const note = path.join(input.vault, 'CLAUDIAN.md');
  await fs.appendFile(note, '\nUser decision.\n');
  const original = await fs.readFile(note, 'utf8');
  const plan = await core.prepare({...input, action:'extend', mode:'existing', hosts:allHosts.slice(2)});
  assert.equal(plan.files.filter(f => f.type === 'note').length, 0);
  assert.equal(plan.reused.length, 1);
  await core.install(plan.id);
  assert.equal((await core.snapshot()).profile.hosts.length, 6);
  assert.equal(await fs.readFile(note,'utf8'), original);
});

test('changed shared skill blocks adding another host', async t => {
  const {core, home, input} = await fixture(t);
  await core.install((await core.prepare(input)).id);
  await fs.appendFile(path.join(home,'.agents/skills/claudian-memory/SKILL.md'), '\nChanged');
  await assert.rejects(core.prepare({...input, action:'extend', mode:'existing', hosts:['cursor']}), /zaten var/);
});

test('Gemini custom context filename is respected without modifying settings', async t => {
  const {core,home,input} = await fixture(t);
  await fs.mkdir(path.join(home,'.gemini'));
  const settings = JSON.stringify({context:{fileName:['CONTEXT.md']}});
  await fs.writeFile(path.join(home,'.gemini/settings.json'), settings);
  const plan = await core.prepare({...input, hosts:['gemini-cli','antigravity']});
  assert.ok(plan.files.some(f => f.path === path.join(home,'.gemini/CONTEXT.md')));
  assert.ok(plan.files.some(f => f.path === path.join(home,'.gemini/GEMINI.md')));
  await core.install(plan.id);
  assert.equal(await fs.readFile(path.join(home,'.gemini/settings.json'),'utf8'), settings);
});

test('discovery does not infer Cursor or Antigravity from a shared skills directory', async t => {
  const {core,home} = await fixture(t);
  await fs.mkdir(path.join(home,'.agents'));
  await fs.mkdir(path.join(home,'.codex'));
  const state = await core.snapshot();
  assert.equal(state.hosts.find(h => h.id === 'codex').configurationFound,true);
  assert.equal(state.hosts.find(h => h.id === 'cursor').configurationFound,false);
  assert.equal(state.hosts.find(h => h.id === 'antigravity').configurationFound,false);
});
async function fixture(t, emit) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'); await fs.mkdir(home);
  const core = new MemorySetup({ home, dataDir: path.join(root, 'data'), emit });
  return { root, home, core, input: { name: 'Deniz', vault: path.join(root, 'Notlar Türkçe'), mode: 'new', storage: 'obsidian', hosts: ['claude-code', 'codex'] } };
}
test('new install uses exact custom path, both adapters, durable profile and live logs', async t => {
  const events = []; const { core, home, input } = await fixture(t, e => events.push(e));
  const plan = await core.prepare(input);
  assert.equal(await fs.readdir(home).then(x => x.length), 0, 'preview does not mutate host files');
  assert.equal(plan.files.length, 15);
  await core.install(plan.id);
  const snapshot = await core.snapshot();
  assert.equal(snapshot.profile.hosts.length, 2);
  assert.equal(snapshot.profile.mode, 'memory');
  for (const dir of ['.claude', '.agents']) {
    const text = await fs.readFile(path.join(home, dir, 'skills', 'claudian-memory', 'SKILL.md'), 'utf8');
    assert.ok(text.includes(JSON.stringify(input.vault)));
  }
  assert.ok(events.some(e => e.stage === 'complete'));
  assert.equal((await core.activity()).length, 10);
  await assert.rejects(core.prepare(input), /zaten kurulu/);
});
test('existing Turkish vault is preserved byte for byte', async t => {
  const { core, input } = await fixture(t); input.mode = 'existing';
  await fs.mkdir(input.vault);
  const note = path.join(input.vault, 'Vault Protokolü.md');
  await fs.writeFile(note, 'Özgün protokol\n');
  const plan = await core.prepare(input);
  assert.equal(plan.files.length, 10);
  await core.install(plan.id);
  assert.equal(await fs.readFile(note, 'utf8'), 'Özgün protokol\n');
  assert.ok((await fs.readdir(input.vault)).includes('Claudian Home.md'));
});
test('unknown existing Markdown vault gets separate protocol, preserves other notes', async t => {
  const { core, input } = await fixture(t); input.mode = 'existing';
  await fs.mkdir(input.vault); await fs.writeFile(path.join(input.vault, 'My note.md'), 'keep');
  const plan = await core.prepare(input); await core.install(plan.id);
  assert.equal(await fs.readFile(path.join(input.vault, 'My note.md'), 'utf8'), 'keep');
  assert.ok((await fs.readdir(input.vault)).includes('Claudian Memory Protocol.md'));
});
test('existing host skill blocks installation without overwrite', async t => {
  const { core, home, input } = await fixture(t);
  const folder = path.join(home, '.claude', 'skills', 'claudian-memory'); await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'SKILL.md'), 'user content');
  await assert.rejects(core.prepare(input), /zaten var/);
  assert.equal(await fs.readFile(path.join(folder, 'SKILL.md'), 'utf8'), 'user content');
});
test('preview-to-install race refuses to overwrite new content', async t => {
  const { core, input } = await fixture(t); const plan = await core.prepare(input);
  await fs.mkdir(input.vault); await fs.writeFile(path.join(input.vault, 'CLAUDIAN.md'), 'concurrent note');
  await assert.rejects(core.install(plan.id), /hedef dosya/);
  assert.equal(await fs.readFile(path.join(input.vault, 'CLAUDIAN.md'), 'utf8'), 'concurrent note');
  assert.equal((await core.snapshot()).profile, null);
});
test('cancel rolls back owned files, profile remains uncommitted', async t => {
  let core; const f = await fixture(t, e => { if (e.message === 'CLAUDIAN.md hazır.') core.cancel(); }); core = f.core;
  const plan = await core.prepare(f.input);
  await assert.rejects(core.install(plan.id), /iptal/);
  assert.deepEqual(await fs.readdir(f.input.vault), []);
  assert.equal((await core.snapshot()).profile, null);
});
test('read/write verification requires nonce from input, not merely skill installation', async t => {
  const { core, input } = await fixture(t); const plan = await core.prepare(input); await core.install(plan.id);
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
test('discovery reuses registered Obsidian vault and detects host settings without writing', async t => {
  const { core, home, input } = await fixture(t);
  const settings = path.join(home, 'AppData', 'Roaming', 'obsidian'); await fs.mkdir(settings, { recursive:true });
  await fs.mkdir(input.vault); await fs.mkdir(path.join(home,'.codex'));
  await fs.writeFile(path.join(settings,'obsidian.json'), JSON.stringify({vaults:{example:{path:input.vault}}}));
  const result = await core.discover();
  assert.equal(result.suggested.vault,input.vault); assert.equal(result.suggested.mode,'existing');
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
  await core.install(plan.id);
  const text = await fs.readFile(instructions,'utf8');
  assert.ok(text.startsWith('# Existing user instructions\nKeep my rules.\n'));
  assert.ok(text.includes('without waiting for a slash command'));
  const profile = (await core.snapshot()).profile;
  const changed = profile.files.find(f=>f.path === instructions);
  assert.equal(await fs.readFile(changed.backup,'utf8'),'# Existing user instructions\nKeep my rules.\n');
  assert.ok((await fs.readFile(path.join(home,'.claude','rules','claudian-memory.md'),'utf8')).includes('before substantive work'));
});
test('changed global instructions after preview are not overwritten', async t => {
  const { core, home, input } = await fixture(t);
  const dir=path.join(home,'.codex'); await fs.mkdir(dir);const file=path.join(dir,'AGENTS.md');
  await fs.writeFile(file,'old');const plan=await core.prepare(input);await fs.writeFile(file,'new user rule');
  await assert.rejects(core.install(plan.id),/talimat dosyası değişti/);
  assert.equal(await fs.readFile(file,'utf8'),'new user rule');
});
