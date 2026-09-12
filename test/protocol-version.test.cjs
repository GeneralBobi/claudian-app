'use strict';
// Measured on a real profile 11.09.2026: protocolVersion said 2.1.0 while all three
// protocol notes on disk still carried 2.0.0. Every later launch then believed the
// install was current and never tried again. These cases hold that door shut.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {MemorySetup} = require('../core.cjs');
const policy = require('../policy.cjs');

async function installed(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-protocol-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const core = new MemorySetup({home, dataDir: path.join(root, 'data')});
  const vault = path.join(root, 'Notes');
  await core.install((await core.prepare({name: 'Deniz', vault, mode: 'new', storage: 'markdown', hosts: ['claude-code'], language: 'en'})).id);
  return {core, vault, config: path.join(root, 'data', 'profile.json')};
}

const readProfile = async config => JSON.parse(await fs.readFile(config, 'utf8'));

test('a genuinely old install is brought up to date', async t => {
  const {core, vault, config} = await installed(t);
  const note = path.join(vault, 'Claudian Universal Protocol.md');
  const stale = '# Claudian Universal Memory Protocol\n\nVersion: 2.0.0\n\nAn older, shorter protocol.\n';
  await fs.writeFile(note, stale);
  const profile = await readProfile(config);
  profile.protocolVersion = '2.0.0';
  // The old build owned this content, so ownership has to reflect the stale bytes.
  profile.files.find(f => f.path === note).hash = require('../core.cjs').hash(stale);
  await fs.writeFile(config, JSON.stringify(profile, null, 2));

  const result = await core.upgrade();

  assert.ok(result.changed > 0, 'the upgrade has to actually write something');
  assert.equal(await fs.readFile(note, 'utf8'), policy.protocol('en'));
  assert.equal((await readProfile(config)).protocolVersion, policy.VERSION);
});

test('a protocol note left behind keeps the recorded version behind with it', async t => {
  const {core, vault, config} = await installed(t);
  const note = path.join(vault, 'Claudian Universal Protocol.md');
  // Edited by the user, so ownership no longer matches and the upgrade must not overwrite it.
  await fs.writeFile(note, '# My own protocol\n\nVersion: 2.0.0\n');
  const profile = await readProfile(config);
  profile.protocolVersion = '2.0.0';
  await fs.writeFile(config, JSON.stringify(profile, null, 2));

  const result = await core.upgrade();

  assert.ok(result.conflicts.includes(note), 'the skipped file is reported');
  assert.match(await fs.readFile(note, 'utf8'), /My own protocol/, 'the user edit survives');
  assert.equal((await readProfile(config)).protocolVersion, '2.0.0',
    'a version the disk does not have must never be recorded as installed');
});

test('the conflict can be resolved without losing the user version', async t => {
  const {core, vault, config} = await installed(t);
  const note = path.join(vault, 'Claudian Universal Protocol.md');
  await fs.writeFile(note, '# My own protocol\n\nVersion: 2.0.0\n');
  const profile = await readProfile(config);
  profile.protocolVersion = '2.0.0';
  await fs.writeFile(config, JSON.stringify(profile, null, 2));
  await core.upgrade();

  const result = await core.adoptProtocol();

  assert.equal(result.replaced, 1);
  assert.equal(await fs.readFile(note, 'utf8'), policy.protocol('en'));
  const kept = (await fs.readdir(vault)).find(name => name.includes('(yours'));
  assert.ok(kept, 'the user version is kept beside the note, not deleted');
  assert.match(await fs.readFile(path.join(vault, kept), 'utf8'), /My own protocol/);
  const after = await readProfile(config);
  assert.equal(after.protocolVersion, policy.VERSION);
  assert.deepEqual(after.migration.conflicts, []);
});

test('adopting never touches a protocol note Claudian did not install', async t => {
  const {core, vault, config} = await installed(t);
  const mine = path.join(vault, 'Vault Protokolü.md');
  await fs.writeFile(mine, 'Kendi protokolüm\n');
  const profile = await readProfile(config);
  profile.migration = {target: policy.VERSION, conflicts: [mine], backup: null};
  await fs.writeFile(config, JSON.stringify(profile, null, 2));

  await assert.rejects(core.adoptProtocol(), /no protocol file waiting/);
  assert.equal(await fs.readFile(mine, 'utf8'), 'Kendi protokolüm\n');
});

test('setup does not present itself as proven, and an explicit skip is recorded', async t => {
  const {core, config} = await installed(t);
  let health = await core.health();
  assert.equal(health.verifiedCount, 0);
  assert.equal(health.everVerified, false, 'a fresh install has proven nothing');
  assert.equal(health.skippedAt, null, 'and it has not been skipped either');

  assert.deepEqual(await core.skipVerification(), {skipped: true});
  health = await core.health();
  assert.ok(health.skippedAt, 'skipping is allowed but it is written down');
  assert.equal(health.everVerified, false);
  assert.ok((await readProfile(config)).verificationSkippedAt);
});

// Sürüm üç yerde ayrı ayrı yazılıydı: policy.cjs ve iki protokol dosyasının başlığı. Aynı
// sınıf tuzak bir kez yaşandı — kayıtlı sürüm 2.1.0 derken diskteki üç dosya 2.0.0
// taşıyordu ve her açılış kendini güncel sanıyordu. Artık metin sürümü çalışma anında
// alıyor; bu test o bağın koptuğunu yakalar.
test('the protocol text carries exactly the version policy.cjs declares', () => {
  const policy = require('../policy.cjs');
  for (const language of ['en', 'tr']) {
    const text = policy.protocol(language);
    assert.ok(!text.includes('{{VERSION}}'), `${language}: the placeholder must be substituted`);
    const stamped = /(?:version|sürüm):\s*([0-9]+\.[0-9]+\.[0-9]+)/i.exec(text);
    assert.ok(stamped, `${language}: the text must state a version`);
    assert.equal(stamped[1], policy.VERSION, `${language}: text says ${stamped[1]}, policy says ${policy.VERSION}`);
  }
});

// Bu kural ölçümden doğdu: altı oturumda kısıt notları hiç açılmadı ve yazılı bir çalışma
// anlaşması bu yüzden ihlal edildi. Metinden düşerse ölçüm de anlamını kaybeder.
test('both protocols say constraints are loaded rather than selected', () => {
  const policy = require('../policy.cjs');
  assert.match(policy.protocol('tr'), /Kısıtlar seçilmez, yüklenir/);
  assert.match(policy.protocol('en'), /Constraints are loaded, not chosen/);
  for (const language of ['en', 'tr']) {
    const text = policy.protocol(language);
    assert.match(text, /Claudian Decisions\.md/, `${language}: names the decisions note`);
    assert.match(text, /Claudian Working agreements\.md/, `${language}: names the agreements note`);
  }
});

test('the skill carries the current protocol version', () => {
  const policy = require('../policy.cjs');
  assert.ok(policy.skill('C:/Vault', ['Home.md'], 'tr').includes(policy.VERSION));
});
