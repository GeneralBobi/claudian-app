'use strict';
// What a conversation is actually handed at its first message, and what it is no longer
// handed twice. Measured 20.09.2026 on the reference profile: the payload carried the whole
// application protocol and then flagged the vault's byte-identical copy requiresFullRead, so
// every write turn paid 25 KB to read a file it had just been given.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const runtime = require('../memory-runtime.cjs');
const capture = require('../memory-capture.cjs');
const policy = require('../policy.cjs');
const review = require('../first-review.cjs');

async function fixture(t, notes) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-payload-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const vault = path.join(root, 'vault'), dataDir = path.join(root, 'data');
  await fs.mkdir(vault); await fs.mkdir(dataDir);
  for (const [name, body] of Object.entries(notes || {})) await fs.writeFile(path.join(vault, name), body);
  return {root, vault, dataDir};
}
const role = (r, title, body) =>
  `---\ntags: [claudian]\ntür: kavram\nclaudian_role: ${r}\ngüncellenme: 2026-09-20\n---\n\n# ${title}\n\n${body}`;
const ENTRY = role('entry', 'Giriş', 'Merkez not.\n');

test('a vault protocol copy identical to the carried one is not asked for a second time', async t => {
  const {vault} = await fixture(t, {'00 - Giris.md': ENTRY, 'Vault Protokolü.md': policy.protocol('tr')});
  const context = await runtime.context(vault, '', 'write', 'tr', null);
  assert.equal(context.vaultProtocol.identical, true);
  assert.equal(context.vaultProtocol.requiresFullRead, undefined, 'no read is demanded for a copy already in this payload');
  assert.equal(context.vaultProtocol.body, undefined, 'and it is not sent twice either');
  assert.match(context.vaultProtocol.reason, /Do not read it again/);
  assert.equal(context.protocol.body, policy.protocol('tr'), 'the application copy is what the payload carries');
});

test('a customized vault protocol keeps its override and its read', async t => {
  const mine = policy.protocol('tr') + '\n\n## Benim eklediğim kural\n\nBana maddeler hâlinde cevap verme.\n';
  const {vault} = await fixture(t, {'00 - Giris.md': ENTRY, 'Vault Protokolü.md': mine});
  const context = await runtime.context(vault, '', 'write', 'tr', null);
  assert.notEqual(context.vaultProtocol.identical, true, 'a different digest is a customization');
  // Under the size limit it is delivered in full; over it, a read is demanded. Either way the
  // user's own rule reaches the conversation.
  assert.ok(context.vaultProtocol.body || context.vaultProtocol.requiresFullRead);
  if (context.vaultProtocol.body) assert.match(context.vaultProtocol.body, /Benim eklediğim kural/);
});

test('active decisions are bounded by whole records, and what did not fit is counted', async t => {
  const many = Array.from({length: 60}, (_, i) =>
    `- **${i % 2 ? 'Gateway' : 'Onboarding'} kararı ${i}: bu kaydın gövdesi bilerek uzun tutuldu ki bütçe gerçekten dolsun ve kırpma davranışı ölçülebilsin.** · **19 Eylül 2026**\n  _kullanıcının sözü · kayıt: 2026-09-${String(1 + (i % 19)).padStart(2, '0')}_`).join('\n\n');
  const {vault} = await fixture(t, {'00 - Giris.md': ENTRY, 'Kararlar.md': role('decisions', 'Kararlar', `## Aktif\n\n${many}\n`)});

  const context = await runtime.context(vault, 'gateway', 'write', 'tr', null);
  const decisions = context.notes.find(n => n.note === 'Kararlar.md');
  assert.ok(decisions.body.length < 12000, `the payload is bounded: ${decisions.body.length}`);
  assert.match(decisions.body, /^## Aktif$/m, 'the heading survives the bound');

  // Nothing still in force disappears. A budget takes away detail, not existence: every record
  // is present, and the ones that did not fit arrive as the bold thesis line they open with.
  const kept = decisions.body.split('\n').filter(l => /^- \*\*/.test(l));
  assert.equal(kept.length, 60, 'no active decision is dropped to make room');
  const whole = decisions.body.split('\n').filter(l => /_kullanıcının sözü/.test(l)).length;
  assert.ok(whole > 0 && whole < 60, `some arrive whole, some shortened: ${whole}`);
  assert.equal(kept.filter(l => / …$/.test(l)).length, 60 - whole, 'a shortened record says so');
  assert.ok(kept.every(l => /^- \*\*[^*]+\*\*/.test(l)), 'no record is cut mid-sentence');

  // The topic decides which ones keep their detail, and the shortening is stated, not hidden.
  const detailed = kept.filter(l => !/ …$/.test(l));
  assert.ok(detailed.filter(l => /Gateway/.test(l)).length > detailed.filter(l => /Onboarding/.test(l)).length,
    'records matching the topic keep their detail');
  assert.match(decisions.body, /açık kayıt yalnız başlığıyla verildi/);
  assert.ok(context.retired.find(r => r.shortened > 0), 'the payload reports what it shortened');
});

test('an open commitment is never dropped, and a finished one may be', async t => {
  const long = n => `- [${n % 3 === 0 ? 'x' : ' '}] **Kalem ${n}: bu gövde bilerek uzun.** ${'ayrıntı '.repeat(40)}`;
  const items = Array.from({length: 45}, (_, i) => long(i)).join('\n');
  const {vault} = await fixture(t, {'00 - Giris.md': ENTRY,
    'Panel.md': role('panel', 'Panel', `## Açık döngüler\n\n${items}\n`)});
  const context = await runtime.context(vault, '', 'write', 'tr', null);
  const panel = context.notes.find(n => n.note === 'Panel.md');
  const open = panel.body.split('\n').filter(l => /^- \[ \]/.test(l)).length;
  assert.equal(open, 45 - 15, 'every open item survives; only the finished ones may go');
  assert.equal(panel.body.split('\n').filter(l => /^- \[x\]/.test(l)).length, 0, 'finished items made room');
  assert.match(panel.body, /tamamlanmış kayıt çıkarıldı/);
  const report = context.retired.find(r => r.role === 'panel');
  assert.equal(report.omittedFinished, 15);
  assert.ok(report.shortened > 0);
});

test('a small decisions note is delivered whole, unbounded', async t => {
  const body = role('decisions', 'Kararlar', '## Aktif\n\n- **Obsidian varsayılan.** · **19 Eylül 2026**\n');
  const {vault} = await fixture(t, {'00 - Giris.md': ENTRY, 'Kararlar.md': body});
  const context = await runtime.context(vault, 'obsidian', 'write', 'tr', null);
  assert.equal(context.notes.find(n => n.note === 'Kararlar.md').body, body);
  assert.deepEqual(context.retired, []);
});

test('external_source is accepted by the tool the protocol declares it for, and needs a reference', async t => {
  const {vault} = await fixture(t, {'00 - Giris.md': ENTRY, 'Öğrenilenler.md': role('lessons', 'Öğrenilenler', 'Dersler.\n')});
  assert.ok(capture.SOURCES.includes('external_source'), 'the protocol has declared four kinds since 2.5.0');
  for (const language of ['tr', 'en']) assert.match(policy.protocol(language), /external_source/);
  const schema = require('../memory-capabilities.cjs').capabilities(vault, null).find(c => c.name === 'capture');
  assert.deepEqual(schema.inputSchema.properties.source.enum, capture.SOURCES, 'the tool enum comes from the module that enforces it');
  assert.ok(schema.inputSchema.properties.reference, 'an external source can carry its reference');

  await assert.rejects(
    capture.capture(vault, {kind: 'lesson', text: 'Bir dış belgeden çıkan bulgu', source: 'external_source'}, 'test', 'tr'),
    /needs a reference/, 'an external finding nobody can find again is not a record');
  const written = await capture.capture(vault, {kind: 'lesson', text: 'Bir dış belgeden çıkan bulgu',
    source: 'external_source', reference: 'RFC 8252 §7.3'}, 'test', 'tr');
  assert.equal(written.status, 'written');
  const {body} = await require('../memory-store.cjs').read(vault, 'Öğrenilenler.md');
  assert.match(body, /_dış kaynak · kaynak: RFC 8252 §7\.3 · kayıt: \d{4}-\d{2}-\d{2}_/);
});

// The redundant second-conversation consent. Setup wrote "not offered" into the adapter note,
// the scan carried its own pointer text and never touched the state line, and every later
// conversation asked again. The application records the answer now, once, atomically.
async function adapterFixture(t, state) {
  const host = 'claude-desktop';
  const adapter = `---\ntags: [claudian, adaptör]\ntür: sistem\nclaudian_role: adapter:${host}\ngüncellenme: 2026-09-20\n---\n\n# Claude — Adaptör\n\nMetin.\n\n## Kalıcı hafıza\n\nAçıklama.\n\nDurum: ${state}\n\nDevam.\n`;
  const {vault, dataDir} = await fixture(t, {'00 - Giris.md': ENTRY, 'Claude.md': adapter});
  const p = {vault, access: 'write', protocolVersion: policy.VERSION, language: 'tr', hosts: [{id: host}]};
  await fs.writeFile(path.join(dataDir, 'profile.json'), JSON.stringify(p));
  return {p, vault, dataDir, host};
}
const complete = async (dataDir, vault, host, status = 'completed') => {
  const r = await review.read(dataDir, vault, host);
  return review.submit(dataDir, vault, host, {request_id: r.request_id, value: r.value, status, summary: 'Rapor.'});
};

test('a completed first review records the persistent-memory answer, once', async t => {
  const {p, vault, dataDir, host} = await adapterFixture(t, 'teklif edilmedi');
  assert.equal((await runtime.context(vault, '', 'write', 'tr', host)).providerMemory.state, 'not_offered');

  await review.begin(dataDir, p, host);
  const result = await complete(dataDir, vault, host);
  assert.equal(result.persistentMemory.initialized, true);
  assert.ok(result.persistentMemory.receipt, 'the write leaves a receipt like any other');

  const after = await runtime.context(vault, '', 'write', 'tr', host);
  assert.equal(after.providerMemory.state, 'accepted', 'the second conversation does not ask again');
  assert.equal(after.providerMemory.instruction, undefined);
  assert.equal(after.providerMemory.text, undefined);
  // Nothing but the state line moved.
  const body = (await require('../memory-store.cjs').read(vault, 'Claude.md')).body;
  assert.match(body, /^Durum: kabul edildi$/m);
  assert.match(body, /# Claude — Adaptör/);
  assert.match(body, /^Devam\.$/m);

  // Idempotent: a second review on the same surface changes nothing.
  await review.begin(dataDir, p, host);
  const again = await complete(dataDir, vault, host);
  assert.equal(again.persistentMemory.initialized, false);
  assert.equal(again.persistentMemory.reason, 'already recorded');
  assert.equal((await require('../memory-store.cjs').read(vault, 'Claude.md')).body, body);
});

test('an installation that completed its review before this existed is caught up', async t => {
  const {p, vault, dataDir, host} = await adapterFixture(t, 'teklif edilmedi');
  await review.begin(dataDir, p, host);
  await complete(dataDir, vault, host);
  // Put the note back the way such a profile would have left it: reviewed, never recorded.
  const store = require('../memory-store.cjs');
  const note = await store.read(vault, 'Claude.md');
  await store.mutate(vault, {note: 'Claude.md', operation: 'patch', expected_sha256: note.sha256,
    old_text: 'Durum: kabul edildi', new_text: 'Durum: teklif edilmedi', reason: 'test'}, 'test');
  assert.equal((await runtime.context(vault, '', 'write', 'tr', host)).providerMemory.state, 'not_offered');

  assert.equal((await review.status(dataDir, vault, host)).status, 'completed');
  assert.equal((await runtime.context(vault, '', 'write', 'tr', host)).providerMemory.state, 'accepted',
    'checking the status of a finished review is enough to record it');
});

test('a declined answer is never overwritten and a failed review records nothing', async t => {
  const declined = await adapterFixture(t, 'reddedildi');
  await review.begin(declined.dataDir, declined.p, declined.host);
  const kept = (await require('../memory-store.cjs').read(declined.vault, 'Claude.md')).body;
  const result = await complete(declined.dataDir, declined.vault, declined.host);
  assert.equal(result.persistentMemory.initialized, false);
  assert.equal((await require('../memory-store.cjs').read(declined.vault, 'Claude.md')).body, kept, 'a no stays a no');

  const failed = await adapterFixture(t, 'teklif edilmedi');
  await review.begin(failed.dataDir, failed.p, failed.host);
  const outcome = await complete(failed.dataDir, failed.vault, failed.host, 'failed');
  assert.equal(outcome.persistentMemory.initialized, false);
  assert.equal((await runtime.context(failed.vault, '', 'write', 'tr', failed.host)).providerMemory.state, 'not_offered',
    'consent is not recorded by a review that did not happen');
});

test('the scan prompt carries one seed, the canonical one', () => {
  const scan = require('../scan.cjs');
  for (const language of ['tr', 'en']) {
    const withMemory = scan.prompt({vault: 'C:/V', language, hosts: [{id: 'chatgpt'}]});
    assert.ok(withMemory.includes(policy.memoryTrigger(language, {vault: 'C:/V'})), `${language}: the canonical seed`);
    assert.ok(withMemory.length < 8000, `${language}: the launcher refuses anything longer`);
    const withoutMemory = scan.prompt({vault: 'C:/V', language, hosts: [{id: 'codex'}]});
    assert.doesNotMatch(withoutMemory, /— Claudian (ortak hafıza|shared memory) —/, `${language}: no seed where there is no account memory`);
  }
});
