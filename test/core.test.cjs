'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MemorySetup } = require('../core.cjs');
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
  assert.equal(plan.files.length, 7);
  await core.install(plan.id);
  const snapshot = await core.snapshot();
  assert.equal(snapshot.profile.hosts.length, 2);
  assert.equal(snapshot.profile.mode, 'memory');
  for (const dir of ['.claude', '.agents']) {
    const text = await fs.readFile(path.join(home, dir, 'skills', 'claudian-memory', 'SKILL.md'), 'utf8');
    assert.ok(text.includes(JSON.stringify(input.vault)));
  }
  assert.ok(events.some(e => e.stage === 'complete'));
  assert.equal((await core.activity()).length, 5);
  await assert.rejects(core.prepare(input), /zaten kurulu/);
});
test('existing Turkish vault is preserved byte for byte', async t => {
  const { core, input } = await fixture(t); input.mode = 'existing';
  await fs.mkdir(input.vault);
  const note = path.join(input.vault, 'Vault Protokolü.md');
  await fs.writeFile(note, 'Özgün protokol\n');
  const plan = await core.prepare(input);
  assert.equal(plan.files.length, 2);
  await core.install(plan.id);
  assert.equal(await fs.readFile(note, 'utf8'), 'Özgün protokol\n');
  assert.deepEqual((await fs.readdir(input.vault)), ['Vault Protokolü.md']);
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
  await fs.mkdir(input.vault); await fs.mkdir(path.join(home,'.agents'));
  await fs.writeFile(path.join(settings,'obsidian.json'), JSON.stringify({vaults:{example:{path:input.vault}}}));
  const result = await core.discover();
  assert.equal(result.suggested.vault,input.vault); assert.equal(result.suggested.mode,'existing');
  assert.deepEqual(result.suggested.hosts,['codex']); assert.equal((await core.snapshot()).profile,null);
  assert.deepEqual(await fs.readdir(input.vault),[]);
});
