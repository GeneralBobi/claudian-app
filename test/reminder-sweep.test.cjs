'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {closeDue, dueMoment} = require('../reminder-sweep.cjs');

const NOTE = [
  '---', 'claudian_role: reminders', '---', '', '# Hatırlatıcılar', '', '## Yaklaşan', '',
  '- [ ] **Yoklama (örnek) · saat 11:30** · **5 Ekim 2026**',
  '  _kaynak: örnek_',
  '- [ ] **Saatsiz iş (örnek)** · **5 Ekim 2026**',
  '- [ ] **Yarınki iş (örnek) · saat 09:00** · **6 Ekim 2026**',
  '- [ ] **Yaklaşık tarih (örnek)** · **~4 Ekim 2026**',
  '- [x] **Zaten kapalı (örnek)** · **1 Ekim 2026**',
  '- [ ] **Olmayan gün (örnek)** · **31 Eylül 2026**',
  '', '## Kapanan', '', '- [ ] **Arşivde kalmış açık kutu (örnek)** · **1 Ekim 2026**', '',
].join('\n');

test('a timed item closes when its hour comes, an all-day item when its day ends', () => {
  const at = h => new Date(2026, 9, 5, h, 0);
  assert.deepEqual(closeDue(NOTE, at(11)).closed, ['Yaklaşık tarih (örnek)']);
  const noon = closeDue(NOTE, at(12));
  assert.deepEqual(noon.closed, ['Yoklama (örnek)', 'Yaklaşık tarih (örnek)']);
  assert.ok(noon.body.includes('- [x] **Yoklama (örnek) · saat 11:30** · **5 Ekim 2026** — **vakti geçti, hatırlatıldı.**\n  _kaynak: örnek_'));
  assert.ok(noon.body.includes('- [ ] **Saatsiz iş (örnek)** · **5 Ekim 2026**\n'), 'an all-day item stays open during its day');
  const nextDay = closeDue(NOTE, new Date(2026, 9, 6, 0, 1));
  assert.ok(nextDay.closed.includes('Saatsiz iş (örnek)'));
  assert.ok(!nextDay.closed.includes('Yarınki iş (örnek)'));
});

test('the archive section, closed items and impossible dates are left alone', () => {
  const r = closeDue(NOTE, new Date(2027, 0, 1));
  assert.ok(!r.closed.includes('Arşivde kalmış açık kutu (örnek)'));
  assert.ok(!r.closed.includes('Olmayan gün (örnek)'));
  assert.ok(r.body.includes('- [ ] **Arşivde kalmış açık kutu (örnek)**'));
  assert.equal((r.body.match(/Zaten kapalı/g) || []).length, 1);
  assert.equal(dueMoment('- [ ] **x** · **31 Eylül 2026**'), null);
});

test('nothing due leaves the note byte-for-byte unchanged, and a second sweep changes nothing', () => {
  const early = closeDue(NOTE, new Date(2026, 9, 1));
  assert.equal(early.body, NOTE);
  assert.deepEqual(early.closed, []);
  const once = closeDue(NOTE, new Date(2027, 0, 1)).body;
  assert.equal(closeDue(once, new Date(2027, 0, 1)).body, once);
});

test('CRLF notes keep their line endings', () => {
  const crlf = NOTE.replace(/\n/g, '\r\n');
  const r = closeDue(crlf, new Date(2026, 9, 5, 12, 0));
  assert.ok(r.body.includes('— **vakti geçti, hatırlatıldı.**\r\n'));
  assert.ok(!/[^\r]\n/.test(r.body));
});

test('the ring sweep writes through the receipted store', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-sweep-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const vault = path.join(dir, 'vault');
  await fs.mkdir(vault);
  await fs.writeFile(path.join(vault, 'Hatırlatıcılar.md'), NOTE);
  const {createRing} = require('../ring.cjs');
  const core = {dataDir: dir, snapshot: async () => ({profile: {vault, language: 'tr'}})};
  const ring = createRing({core, send: () => {}, dialog: {}, getWindow: () => null});
  assert.deepEqual(await ring.reminderSweep(new Date(2026, 9, 5, 12, 0)), ['Yoklama (örnek)', 'Yaklaşık tarih (örnek)']);
  const body = await fs.readFile(path.join(vault, 'Hatırlatıcılar.md'), 'utf8');
  assert.ok(body.includes('- [x] **Yoklama (örnek) · saat 11:30**'));
  const receipts = await require('../memory-store.cjs').history(vault);
  assert.equal(receipts[0].status, 'committed');
  assert.match(receipts[0].reason, /Vakti geçen hatırlatıcı kapandı/);
  assert.deepEqual(await ring.reminderSweep(new Date(2026, 9, 5, 12, 0)), [], 'nothing to do the second time');
});

test('phone buttons: the item is found by the engine id; done closes it, tomorrow moves its date and keeps its hour', () => {
  const {reminderId, applyAction} = require('../reminder-sweep.cjs');
  // Aynı kimliği laya-kapi sunucu.py üretir: sha1("2026-10-05|Yoklama (örnek)")[:16]
  const id = reminderId('- [ ] **Yoklama (örnek) · saat 11:30** · **5 Ekim 2026**');
  assert.equal(id, require('crypto').createHash('sha1').update('2026-10-05|Yoklama (örnek)').digest('hex').slice(0, 16));
  const now = new Date(2026, 9, 5, 11, 0);
  const done = applyAction(NOTE, id, 'yapildi', now);
  assert.ok(done.body.includes('- [x] **Yoklama (örnek) · saat 11:30** · **5 Ekim 2026** — **yapıldı (telefondan, 05.10.2026).**'));
  const later = applyAction(NOTE, id, 'yarin', now);
  assert.equal(later.date, '2026-10-06');
  assert.ok(later.body.includes('- [ ] **Yoklama (örnek) · saat 11:30** · **6 Ekim 2026**'));
  const monthEnd = applyAction('- [ ] **x** · **31 Ekim 2026**\n', reminderId('- [ ] **x** · **31 Ekim 2026**'), 'yarin', new Date(2026, 9, 31, 9));
  assert.ok(monthEnd.body.includes('**1 Kasım 2026**'));
  assert.throws(() => applyAction(NOTE, '0000000000000000', 'yapildi', now), /artık açık değil/);
  assert.throws(() => applyAction(NOTE, id, 'sil', now), /geçersiz/);
  const archivedId = reminderId('- [ ] **Arşivde kalmış açık kutu (örnek)** · **1 Ekim 2026**');
  assert.throws(() => applyAction(NOTE, archivedId, 'yapildi', now), /artık açık değil/, 'the archive section is never edited');
});

test('phone buttons: the ring answers the engine and writes a receipt', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-islem-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const vault = path.join(dir, 'vault'), engine = path.join(dir, 'engine');
  await fs.mkdir(vault);
  await fs.mkdir(path.join(engine, 'gelen_islem'), {recursive: true});
  await fs.writeFile(path.join(vault, 'Hatırlatıcılar.md'), NOTE);
  await fs.writeFile(path.join(dir, 'ring.json'), JSON.stringify({engine}));
  const {reminderId} = require('../reminder-sweep.cjs');
  const id = reminderId('- [ ] **Saatsiz iş (örnek)** · **5 Ekim 2026**');
  const req = 'fedcba9876543210fedcba9876543210';
  await fs.writeFile(path.join(engine, 'gelen_islem', `${req}.json`), JSON.stringify({kimlik: id, islem: 'yapildi'}));
  const {createRing} = require('../ring.cjs');
  const core = {dataDir: dir, snapshot: async () => ({profile: {vault, language: 'tr'}})};
  const ring = createRing({core, send: () => {}, dialog: {}, getWindow: () => null});
  assert.equal(await ring.actionsOnce(new Date(2026, 9, 5, 10)), 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(engine, 'gelen_islem', `${req}.sonuc.json`), 'utf8')), {tamam: true, tarih: null});
  assert.match(await fs.readFile(path.join(vault, 'Hatırlatıcılar.md'), 'utf8'), /- \[x\] \*\*Saatsiz iş \(örnek\)\*\* · \*\*5 Ekim 2026\*\* — \*\*yapıldı/);
  await assert.rejects(fs.access(path.join(engine, 'gelen_islem', `${req}.json`)));
});
