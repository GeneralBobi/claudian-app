'use strict';
// Measured 13.09.2026: in an empty memory a durable, dated fact found no note shaped for it and
// the protocol's "do not open a new note" turned it into NO_OP. These tests hold the fix in place:
// something worth keeping always has a place, and the place is decided by code, not by a guess.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const welcome = require('../welcome.cjs');
const {capture} = require('../memory-capture.cjs');
const {capabilities} = require('../memory-capabilities.cjs');
const store = require('../memory-store.cjs');
const policy = require('../policy.cjs');

async function vault(t, language = 'tr', hosts = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-capture-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const dir = path.join(root, 'notes');
  await fs.mkdir(dir);
  const labels = {chatgpt: 'ChatGPT', 'claude-desktop': 'Claude', 'claude-code': 'Claude Code'};
  for (const [name, body] of Object.entries(welcome.skeleton(language, 'Deniz', hosts, labels))) await fs.writeFile(path.join(dir, name), body);
  return dir;
}
const read = (dir, name) => fs.readFile(path.join(dir, name), 'utf8');

test('a dated fact in an empty memory is written where the notice layer can read its date', async t => {
  const dir = await vault(t);
  const result = await capture(dir, {kind: 'commitment', text: 'İş mülakatı', date: '2026-09-19', quote: 'cumartesi mülakatım var'}, 'claude-code', 'tr');
  assert.equal(result.status, 'written');
  assert.equal(result.note, 'Hatırlatıcılar.md');
  const body = await read(dir, 'Hatırlatıcılar.md');
  assert.match(body, /- \[ \] \*\*İş mülakatı\*\* · \*\*19 Eylül 2026\*\*/, 'the same declared-date shape notice.cjs parses');
  assert.match(body, /> "cumartesi mülakatım var"/, 'the user\'s own words are kept');
  assert.match(body, /kullanıcının sözü · kayıt: \d{4}-\d{2}-\d{2}/, 'provenance and recording date travel with the line');
  const receipts = await store.history(dir);
  assert.ok(receipts.some(r => r.id === result.receipt && r.status === 'committed'), 'a receipt memory_review can accept');
});

test('a preference goes under its heading, a rejection under its own, and an open loop declares when it opened', async t => {
  const dir = await vault(t);
  await capture(dir, {kind: 'preference', text: 'Baharatlı yemekleri seviyor', quote: 'şu baharatlı olanı sevdim'}, 'claude-code', 'tr');
  await capture(dir, {kind: 'rejection', text: 'Seçenek listesi verme; birini seç ve nedenini söyle'}, 'claude-code', 'tr');
  await capture(dir, {kind: 'decision', text: 'İlk sürüm Türkçe olacak'}, 'claude-code', 'tr');
  await capture(dir, {kind: 'open_loop', text: 'Hat kararını ver'}, 'claude-code', 'tr');
  const about = await read(dir, 'Hakkımda.md');
  assert.ok(about.indexOf('## Tercihler') < about.indexOf('Baharatlı yemekleri seviyor'));
  const decisions = await read(dir, 'Kararlar.md');
  const active = decisions.indexOf('## Aktif'), rejected = decisions.indexOf('## Reddedilen yaklaşımlar'), history = decisions.indexOf('## Tarihçe');
  const decision = decisions.indexOf('İlk sürüm Türkçe'), rejection = decisions.indexOf('Seçenek listesi verme');
  assert.ok(active < decision && decision < rejected, 'the decision sits in the active section');
  assert.ok(rejected < rejection && rejection < history, 'the rejection sits in its own section, above history');
  assert.match(await read(dir, 'Kontrol Paneli.md'), /- \[ \] \*\*Hat kararını ver\*\* · açıldı: \d{4}-\d{2}-\d{2}/);
  assert.match(about, /güncellenme: \d{4}-\d{2}-\d{2}/);
});

test('the same line is not written twice, a commitment without a date is refused, and nothing is invented', async t => {
  const dir = await vault(t, 'en');
  await capture(dir, {kind: 'lesson', text: 'Verify the installed build, not the source tree'}, 'codex', 'en');
  const again = await capture(dir, {kind: 'lesson', text: 'verify the installed build,  not the source tree'}, 'codex', 'en');
  assert.equal(again.status, 'duplicate');
  assert.equal((await read(dir, 'Lessons.md')).split('Verify the installed build').length, 2);
  await assert.rejects(capture(dir, {kind: 'commitment', text: 'Dentist'}, 'codex', 'en'), /open_loop/);
  await assert.rejects(capture(dir, {kind: 'commitment', text: 'Dentist', date: '2026-02-30'}, 'codex', 'en'), /real calendar day/);
  await assert.rejects(capture(dir, {kind: 'mood', text: 'Tired'}, 'codex', 'en'), /kind must be/);
});

test('different dates, negated substrings and completed tasks are not duplicate facts', async t => {
  const dir = await vault(t, 'en');
  const event = {kind: 'commitment', text: 'Dentist', date: '2026-09-19'};
  assert.equal((await capture(dir, event, 'codex', 'en')).status, 'written');
  assert.equal((await capture(dir, {...event, date: '2026-10-19'}, 'codex', 'en')).status, 'written');
  assert.equal((await capture(dir, event, 'codex', 'en')).status, 'duplicate');
  await assert.rejects(capture(dir, {...event, date: '2026-02-30'}, 'codex', 'en'), /real calendar day/);
  await capture(dir, {kind: 'preference', text: 'Does not like coffee'}, 'codex', 'en');
  assert.equal((await capture(dir, {kind: 'preference', text: 'Like coffee'}, 'codex', 'en')).status, 'written');
  const note = path.join(dir, 'Reminders.md');
  await fs.writeFile(note, (await fs.readFile(note, 'utf8')).replaceAll('- [ ]', '- [x]'));
  assert.equal((await capture(dir, event, 'codex', 'en')).status, 'written');
});

test('a renamed role note is still found, and a missing one is named instead of guessed', async t => {
  const dir = await vault(t, 'en');
  await fs.rename(path.join(dir, 'About Me.md'), path.join(dir, 'Who I Am.md'));
  const result = await capture(dir, {kind: 'preference', text: 'Prefers short answers'}, 'codex', 'en');
  assert.equal(result.note, 'Who I Am.md');
  await fs.rm(path.join(dir, 'Lessons.md'));
  await assert.rejects(capture(dir, {kind: 'lesson', text: 'Anything'}, 'codex', 'en'), /No note in this memory holds the "lessons" role/);
});

test('capture is offered only with write access', async t => {
  const dir = await vault(t, 'en');
  const all = capabilities(dir, async () => ({candidates: []}), {access: 'read', actor: 'codex'});
  assert.equal(all.find(c => c.name === 'capture').scope, 'write');
});

test('an account-memory surface gets its adapter and a single consent offer; a file host gets neither', async t => {
  const dir = await vault(t, 'tr', ['claude-desktop', 'claude-code']);
  const runtime = require('../memory-runtime.cjs');
  const claude = await runtime.context(dir, '', 'write', 'tr', 'claude-desktop');
  assert.equal(claude.adapter.note, 'Claude.md');
  assert.equal(claude.providerMemory.state, 'not_offered');
  assert.match(claude.providerMemory.text, /startup_context/);
  assert.doesNotMatch(claude.providerMemory.text, /[A-Z]:\\|\/Users\//, 'account memory travels to other devices; it carries no path');
  assert.equal(claude.providerMemory.appendSection, null, 'a new adapter note already has the section');
  const code = await runtime.context(dir, '', 'write', 'tr', 'claude-code');
  assert.equal(code.adapter.note, 'Claude Code.md');
  assert.equal(code.providerMemory, null, 'rule files carry the trigger there; nothing to offer');

  const note = await store.read(dir, 'Claude.md');
  await store.mutate(dir, {note: 'Claude.md', operation: 'patch', expected_sha256: note.sha256, old_text: 'Durum: teklif edilmedi', new_text: 'Durum: kabul edildi', reason: 'user accepted'}, 'claude-desktop');
  const after = await runtime.context(dir, '', 'write', 'tr', 'claude-desktop');
  assert.deepEqual(after.providerMemory, {host: 'claude-desktop', state: 'accepted'}, 'an answered offer is never repeated');
});

test('an adapter note written before the offer existed gets the section from the agent, not from a rewrite', async t => {
  const dir = await vault(t, 'en', []);
  await fs.writeFile(path.join(dir, 'ChatGPT.md'), '---\ntags: [claudian, adapter]\ntype: system\nclaudian_role: adapter:chatgpt\nupdated: 2026-09-12\n---\n\n# ChatGPT — Adapter\n');
  const context = await require('../memory-runtime.cjs').context(dir, '', 'write', 'en', 'chatgpt');
  assert.equal(context.providerMemory.state, 'not_offered');
  assert.match(context.providerMemory.appendSection, /## Persistent memory/);
  assert.match(context.providerMemory.appendSection, /State: not offered/);
  assert.equal(policy.memoryState('## Persistent memory\n\nState: `declined`\n').state, 'declined');
});

test('the protocol keeps admission and placement apart, and reads satisfaction in context', () => {
  for (const language of ['tr', 'en']) {
    const text = policy.protocol(language);
    assert.match(text, language === 'tr' ? /## Yer bulmak/ : /## Finding a place/);
    assert.match(text, language === 'tr' ? /bölmek içindir/ : /for splitting/);
    assert.match(text, /MOC/);
    assert.match(text, /capture/);
    assert.match(text, language === 'tr' ? /Hoşnutluk ve geri bildirim bağlamıyla/ : /Satisfaction and feedback are judged in context/);
    assert.match(text, language === 'tr' ? /nezaket cümlesidir, yazılmaz/ : /courtesy and is not written/, 'a silence case sits beside the write case');
  }
});
