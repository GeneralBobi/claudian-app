'use strict';
// Dürtme disiplini. Her kural [[Claudian Dispatcher]]'da bir kez ödenmiş bir bedelin
// karşılığı; testler o bedelin yeniden ödenmesini engelliyor.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {tick, worthInterrupting} = require('../watch.cjs');

const NOW = Date.parse('2026-09-11T12:00:00Z');
const DAY = 86400000, HOUR = 3600000;
const day = n => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const note = (kind, updated, body) => `---\ntags: [claudian]\ntür: ${kind}\ngüncellenme: ${updated}\n---\n\n${body}\n`;

async function place(t, notes) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-watch-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const vault = path.join(root, 'vault');
  await fs.mkdir(vault);
  for (const [name, body] of Object.entries(notes)) await fs.writeFile(path.join(vault, name), body);
  return {vault, ledgerFile: path.join(root, 'state', 'noticed.json')};
}

// ── Telefon tarih içindir ──────────────────────────────────────────────────
test('a hypothesis never buzzes the phone', () => {
  assert.equal(worthInterrupting({hypothesis: true, urgency: 0.95}), false,
    '"belki bakmalısın" bir bildirim değildir');
  assert.equal(worthInterrupting({hypothesis: false, urgency: 0.95}), true);
  assert.equal(worthInterrupting({hypothesis: false, urgency: 0.4}), false);
});

test('a due date interrupts, a stale project does not', async t => {
  const spot = await place(t, {
    'Reminders.md': note('ajanda', day(30), '- [ ] **Garanti başvurusu** · **13 Eylül 2026**'),
    'Sera.md': note('proje', day(99), 'Yarım.'),
    'Claudian Home.md': note('giriş', day(1), '[[Sera]] [[Sera]] [[Sera]]'),
  });
  const sent = [];
  const out = await tick({...spot, language: 'tr', now: NOW, notify: e => sent.push(e)});
  assert.equal(sent.length, 1, 'turda en fazla bir dürtme');
  assert.match(sent[0].title, /Garanti/, 'titreten şey tarih olmalı, durgunluk değil');
});

// Regression scenario using synthetic data.
test('the same topic is not raised twice', async t => {
  const spot = await place(t, {
    'Reminders.md': note('ajanda', day(30), '- [ ] **Garanti** · **13 Eylül 2026**'),
  });
  const sent = [];
  await tick({...spot, language: 'tr', now: NOW, notify: e => sent.push(e)});
  // Sessiz saatler geçti, aday hâlâ duruyor.
  await tick({...spot, language: 'tr', now: NOW + 9 * HOUR, notify: e => sent.push(e)});
  assert.equal(sent.length, 1, 'kıpırdamayan bir kalem ikinci kez açılmaz');
});

test('two notifications are not sent back to back', async t => {
  const spot = await place(t, {
    'Reminders.md': note('ajanda', day(30),
      '- [ ] **Bir** · **13 Eylül 2026**\n- [ ] **İki** · **12 Eylül 2026**'),
  });
  const sent = [];
  await tick({...spot, language: 'tr', now: NOW, notify: e => sent.push(e)});
  await tick({...spot, language: 'tr', now: NOW + HOUR, notify: e => sent.push(e)});
  assert.equal(sent.length, 1, 'sessiz saat dolmadan ikincisi gitmez');

  await tick({...spot, language: 'tr', now: NOW + 6 * HOUR, notify: e => sent.push(e)});
  assert.equal(sent.length, 2, 'sessiz saat dolunca sıradaki gider');
});

// ── Yazma ──────────────────────────────────────────────────────────────────
test('the tick writes the note and keeps the ledger outside the vault', async t => {
  const spot = await place(t, {
    'Reminders.md': note('ajanda', day(30), '- [ ] **Garanti** · **13 Eylül 2026**'),
  });
  const out = await tick({...spot, language: 'tr', now: NOW});
  assert.equal(out.wrote, true);
  assert.ok((await fs.readdir(spot.vault)).includes('Claudian Fark ettikleri.md'));
  assert.ok(!(await fs.readdir(spot.vault)).includes('noticed.json'), 'defter vault\'a girmez');
  assert.ok(await fs.readFile(spot.ledgerFile, 'utf8'), 'defter kendi klasöründe');
});

test('a missing folder ends the tick quietly', async t => {
  const spot = await place(t, {});
  await fs.rm(spot.vault, {recursive: true, force: true});
  const sent = [];
  const out = await tick({...spot, now: NOW, notify: e => sent.push(e)});
  assert.equal(out.missing, true);
  assert.equal(sent.length, 0, 'okunamayan bir klasör için dürtme uydurulmaz');
});

test('nothing to notice sends nothing', async t => {
  const spot = await place(t, {'Claudian Home.md': note('giriş', day(1), 'Boş.')});
  const sent = [];
  const out = await tick({...spot, language: 'tr', now: NOW, notify: e => sent.push(e)});
  assert.equal(sent.length, 0);
  assert.equal(out.candidates, 0);
});
