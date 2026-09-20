'use strict';
// Acceptance cases for the 2.9.0 information lifecycle.
//
// These used to live in the protocol text as a "behaviour checks" list that every startup
// payload carried and nothing ever verified. A rule the runtime pays for on every conversation
// and no test ever exercises is a claim, not a contract. The contract is here; the protocol
// states the behaviour and says that installing a file proves none of it.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const store = require('../memory-store.cjs');
const runtime = require('../memory-runtime.cjs');
const lifecycle = require('../lifecycle.cjs');
const policy = require('../policy.cjs');

async function vaultWith(t, notes) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-lifecycle-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const vault = path.join(root, 'vault');
  await fs.mkdir(vault);
  for (const [name, body] of Object.entries(notes)) await fs.writeFile(path.join(vault, name), body);
  return {root, vault, data: path.join(root, 'data')};
}
const role = (role, title, body) =>
  `---\ntags: [claudian]\ntür: kavram\nclaudian_role: ${role}\ngüncellenme: 2026-09-20\n---\n\n# ${title}\n\n${body}`;

const DECISIONS = role('decisions', 'Kararlar', [
  '## Aktif',
  '',
  '- **Obsidian varsayılan not uygulamasıdır.** · **19 Eylül 2026**',
  '  _kullanıcının sözü · kayıt: 2026-09-19_',
  '',
  '## 0.13.x bağlantı mimarisi',
  '',
  lifecycle.marker('archived', {date: '31.08.2026', language: 'tr'}),
  '',
  '- [ ] Named tunnel kurulumunu tamamla',
  '- [ ] Eski relay kanalını kaldır',
  '',
  '## Next / 1.0.0 companion mimarisi',
  '',
  lifecycle.marker('superseded', {successor: '[[Kararlar]]', language: 'tr'}),
  '',
  '- **Companion süreç ayrı paket olarak dağıtılır.** · **11 Eylül 2026**',
  '',
  '## Tarihçe — bağlayıcı değil',
  '',
  '- **0.11 döneminde alınmış ve sonradan geri alınmış bir karar.**',
  '',
].join('\n'));

const ENTRY = role('entry', 'Giriş', 'Merkez not.\n');

// 1 · 2 · 3 · 6
test('startup context carries the active section only, and an archived plan produces no task', async t => {
  const {vault} = await vaultWith(t, {'00 - Giris.md': ENTRY, 'Kararlar.md': DECISIONS});
  const context = await runtime.context(vault, '', 'write', 'tr', null);
  const decisions = context.notes.find(n => n.note === 'Kararlar.md');
  assert.ok(decisions, 'the decisions note is still delivered');

  // 1: an archived decision does not enter startup context. The retired titles appear once
  // more, inside the notice that says they were left out -- as a pointer, never as content.
  assert.doesNotMatch(decisions.body, /^## 0\.13\.x bağlantı mimarisi/m, 'archived heading is out');
  assert.doesNotMatch(decisions.body, /^## Tarihçe/m, 'a history heading is out even without a marker');
  assert.doesNotMatch(decisions.body, /⚠ Arşiv|⚠ Yerine geçti/, 'the section markers go with their sections');
  // 2: an unchecked box inside an archived section is not an open loop.
  assert.doesNotMatch(decisions.body, /Named tunnel kurulumunu tamamla/, 'archived task is out');
  assert.doesNotMatch(decisions.body, /\[ \]/, 'no unchecked box survives from a retired section');
  // 3: a superseded decision is not returned as a current decision.
  assert.doesNotMatch(decisions.body, /Companion süreç ayrı paket/, 'superseded decision is out');
  // 6: the active part of the very same file loads untouched.
  assert.match(decisions.body, /Obsidian varsayılan not uygulamasıdır/, 'the active decision survives');
  assert.match(decisions.body, /## Aktif/, 'the active heading survives');

  // What was left out is counted out loud: "unreachable" must never read as "does not exist".
  assert.match(decisions.body, /3 bölümü yürürlükte değil/, 'the omission is stated, not hidden');
  const retired = context.retired.find(r => r.note === 'Kararlar.md');
  assert.equal(retired.sections.length, 3);
  assert.deepEqual(retired.sections.map(s => s.status).sort(), ['archived', 'archived', 'superseded']);
  assert.equal(retired.sections.find(s => s.status === 'superseded').successor, '[[Kararlar]]');
});

// 4 · 5
test('a history or rollback question can still find archived content', async t => {
  const {vault} = await vaultWith(t, {'00 - Giris.md': ENTRY, 'Kararlar.md': DECISIONS});
  // Search reads the notes, not the startup view: filtering a payload must never amount to
  // deleting evidence. Both a historical question and a rollback question reach it.
  assert.deepEqual((await store.search(vault, 'Named tunnel')).map(h => h.note), ['Kararlar.md']);
  assert.deepEqual((await store.search(vault, 'Companion süreç')).map(h => h.note), ['Kararlar.md']);
  const whole = await store.read(vault, 'Kararlar.md');
  assert.match(whole.body, /0\.13\.x bağlantı mimarisi/, 'read_note returns the note as it is on disk');
  assert.match(whole.body, /Tarihçe/);
});

// 9
test('an old version is not an archived version', async t => {
  const body = role('decisions', 'Kararlar', [
    '## Aktif', '',
    '- **0.11 döneminde alındı, hâlâ geçerli.** · **11 Ağustos 2026**', '',
    '## 0.16.x sürüm planı', '',
    '- **Bu sürümde yapılacaklar.**', '',
  ].join('\n'));
  const {vault} = await vaultWith(t, {'00 - Giris.md': ENTRY, 'Kararlar.md': body});
  const context = await runtime.context(vault, '', 'write', 'tr', null);
  const decisions = context.notes.find(n => n.note === 'Kararlar.md');
  // Neither heading carries a marker, so neither is archived -- a version number in a title is
  // not evidence, and a decision from 0.11 that still holds stays active.
  assert.match(decisions.body, /0\.11 döneminde alındı, hâlâ geçerli/);
  assert.match(decisions.body, /0\.16\.x sürüm planı/, 'a version number alone never archives a section');
  assert.deepEqual(context.retired, []);
});

// 10
test('the marker is human-readable, sits under the heading, and names only what is known', () => {
  const archived = lifecycle.marker('archived', {date: '31.08.2026', language: 'tr'});
  assert.match(archived, /^> \*\*⚠ Arşiv — yürürlükte değil \(31\.08\.2026\)\*\*$/m);
  assert.match(archived, /tarihsel kayıttır/);
  // Nothing is invented: no date given, no date shown.
  assert.doesNotMatch(lifecycle.marker('archived', {language: 'tr'}), /\(/);
  assert.doesNotMatch(lifecycle.marker('superseded', {language: 'tr'}), /Yerine geçen/);
  assert.match(lifecycle.marker('superseded', {successor: '[[X]]', language: 'en'}), /Replaced by: \[\[X\]\]/);
  // Both languages parse back to the state they display.
  for (const language of ['tr', 'en']) for (const status of ['archived', 'superseded']) {
    const note = `# T\n\n## Bir başlık\n\n${lifecycle.marker(status, {language})}\n\nİçerik\n`;
    assert.equal(lifecycle.sections(note).find(s => s.title === 'Bir başlık').status, status, `${language}/${status}`);
  }
});

test('one stale heading never archives the whole note, and a note-level state is honoured', t => {
  const partly = `---\nclaudian_role: panel\n---\n\n# P\n\n## Açık döngüler\n\n- [ ] Aktif iş\n\n## Eski plan\n\n${lifecycle.marker('archived', {language: 'tr'})}\n\n- [ ] Eski iş\n`;
  const view = lifecycle.activeOnly(partly, 'tr');
  assert.equal(view.status, 'active', 'the note itself is still active');
  assert.match(view.body, /Aktif iş/);
  assert.doesNotMatch(view.body, /Eski iş/);

  const whole = `---\nclaudian_role: panel\nclaudian_lifecycle: archived\n---\n\n# P\n\n## Açık döngüler\n\n- [ ] Eski iş\n`;
  assert.equal(lifecycle.noteStatus(whole), 'archived');
  assert.equal(lifecycle.activeOnly(whole, 'tr').status, 'archived');
});

test('a note with nothing retired is returned byte for byte', () => {
  const plain = '---\nclaudian_role: panel\n---\n\n# P\n\n## Açık döngüler\n\n- [ ] Aktif iş\n';
  const view = lifecycle.activeOnly(plain, 'tr');
  assert.equal(view.body, plain);
  assert.equal(view.changed, false);
  // CRLF notes keep their line endings through the filter.
  const crlf = plain.replace(/\n/g, '\r\n') + `\r\n## Eski\r\n\r\n${lifecycle.marker('archived', {language: 'tr'}).replace(/\n/g, '\r\n')}\r\n\r\n- [ ] Eski iş\r\n`;
  const filtered = lifecycle.activeOnly(crlf, 'tr');
  assert.ok(filtered.body.includes('\r\n'));
  assert.doesNotMatch(filtered.body, /Eski iş/);
});

// 7 · 8 — contract cases. The behaviour is the model's; what is tested is that the protocol
// states it, in both languages, because a rule that is only in one is a rule half the product
// does not have.
test('the protocol states that forgetting is not archiving and that propagation is bounded', () => {
  const tr = policy.protocol('tr'), en = policy.protocol('en');
  assert.match(tr, /Arşiv bir unutma biçimi değildir/);
  assert.match(tr, /arşive, tarihçeye veya değişiklik günlüğüne taşınmaz/);
  assert.match(en, /An archive is not a way of forgetting/);
  assert.match(en, /not moved into an archive, a history section or a change log/);

  assert.match(tr, /yalnız kanıtlanabilir biçimde ona bağlı/);
  assert.match(tr, /bütün klasörü taramak değildir/);
  assert.match(tr, /Bağı gösterilemeyen kayda dokunulmaz/);
  assert.match(en, /only what is provably tied to it/);
  assert.match(en, /not a sweep of the whole folder/);
  assert.match(en, /A record whose link cannot be shown is left alone/);
});

test('both protocols define the same three lifecycle states and the same default reach', () => {
  const tr = policy.protocol('tr'), en = policy.protocol('en');
  assert.match(tr, /## Bilgi yaşam döngüsü/);
  assert.match(en, /## Information lifecycle/);
  for (const state of ['`active`', '`superseded`', '`archived`']) {
    assert.match(tr, new RegExp(state.replace(/[`]/g, '`')), `tr: ${state}`);
    assert.match(en, new RegExp(state.replace(/[`]/g, '`')), `en: ${state}`);
  }
  assert.match(tr, /Silme bir durum değildir/);
  assert.match(en, /Deletion is not a state/);
  assert.match(tr, /işaretlenmemiş bir kutu aktif görev değildir/);
  assert.match(en, /unchecked box inside an archived section is not an active task/);
  assert.match(tr, /Eski olmak yürürlükten kalkmış olmak değildir/);
  assert.match(en, /Being old is not being out of force/);
  // The marker the protocol shows is the marker the code writes.
  for (const language of ['tr', 'en']) {
    const text = policy.protocol(language);
    assert.ok(text.includes(lifecycle.TOKEN.archived[language]), `${language}: archive token`);
    assert.ok(text.includes(lifecycle.TOKEN.superseded[language]), `${language}: superseded token`);
  }
});

test('the runtime QA list is gone from the payload and its behaviour survives as a rule', () => {
  for (const language of ['tr', 'en']) {
    const text = policy.protocol(language);
    assert.doesNotMatch(text, /## (Davranış kontrolleri|Behaviour checks)/, `${language}: the acceptance list left the runtime`);
  }
  assert.match(policy.protocol('tr'), /Reddedilmiş bir yaklaşım, red gerekçesi değişmedikçe yeniden önerilmez/);
  assert.match(policy.protocol('en'), /A rejected approach is not proposed again unless the reason for rejecting it changed/);
});
