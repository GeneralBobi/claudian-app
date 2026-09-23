'use strict';
// Yüzük: a draft reaches memory only through approval, and approval writes exactly what the
// person kept. These tests hold that boundary and the path rules around the engine folder.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const welcome = require('../welcome.cjs');
const store = require('../memory-store.cjs');
const {createRing, sessionNote, noteName, draftDir} = require('../ring.cjs');

// Shape only — none of this is a real recording.
const DRAFT = {
  baslik: 'Örnek ders (örnek)', kaynak: 'ornek.mp3', baslangic: '2026-09-23T10:30', ses_suresi_sn: 1260,
  parca: 4, tutulan: 3, kapi_model: 'laya-yuzuk-v1', durum: 'taslak', denetim: true,
  kayitlar: [
    {no: 0, saat: '10:30', tut: false, tur: 'gurultu', metin: 'Kapıyı kapatır mısınız (örnek)'},
    {no: 1, saat: '10:31', tut: true, tur: 'tanim', metin: 'Tanım cümlesi (örnek)'},
    {no: 2, saat: '10:40', tut: true, tur: 'odev', metin: 'Ödev teslimi yedi Ekim (örnek)', tarihler: [{ifade: 'yedi Ekim', zaman: '2026-10-07T00:00'}]},
    {no: 3, saat: '10:45', tut: true, tur: 'gurultu', metin: 'Yanlışlıkla tutulan anekdot (örnek)'},
  ],
};

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-ring-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const vault = path.join(root, 'notes'), engine = path.join(root, 'engine'), data = path.join(root, 'data');
  await fs.mkdir(vault); await fs.mkdir(data);
  for (const [name, body] of Object.entries(welcome.skeleton('tr', 'Deniz', [], {}))) await fs.writeFile(path.join(vault, name), body);
  await fs.mkdir(path.join(engine, 'taslaklar', 'd1'), {recursive: true});
  await fs.writeFile(path.join(engine, 'taslaklar', 'd1', 'kararlar.json'), JSON.stringify(DRAFT));
  await fs.writeFile(path.join(data, 'ring.json'), JSON.stringify({engine}));
  const core = {dataDir: data, snapshot: async () => ({profile: {vault, language: 'tr'}})};
  const ring = createRing({core, send: () => {}, dialog: {}, getWindow: () => null});
  return {vault, engine, ring};
}

test('a draft id cannot leave the drafts folder', () => {
  for (const bad of ['..', '../x', 'a/b', 'a\\b', '', 'x'.repeat(200)]) assert.throws(() => draftDir('/e', bad));
  assert.equal(draftDir('/e', '2026-09-23_1030_Ders'), path.join('/e', 'taslaklar', '2026-09-23_1030_Ders'));
});

test('the session note carries only what the person kept, grouped by kind', () => {
  const body = sessionNote(DRAFT, new Set([1, 2]));
  assert.match(body, /^---\ntags: \[yüzük\]\ntür: log\n/);
  assert.match(body, /## Ödev ve teslimler\n\n- Ödev teslimi yedi Ekim \(örnek\) `10:40`/);
  assert.match(body, /## İçerik ve tanımlar\n\n- Tanım cümlesi \(örnek\) `10:31`/);
  assert.doesNotMatch(body, /anekdot|Kapıyı/, 'unticked and dropped sentences never reach the note');
  assert.equal(noteName({...DRAFT, baslik: 'a/b:c*?'}), 'Yüzük · 2026-09-23 a-b-c-.md');
});

test('approval writes one note, adds the ticked date to reminders, and keeps corrections for training', async t => {
  const {vault, engine, ring} = await setup(t);
  const r = await ring.approve('d1', {kept: [1, 2], reminders: [{no: 2, date: '2026-10-07'}]});
  assert.equal(r.note, 'Yüzük · 2026-09-23 Örnek ders (örnek).md');
  assert.match(await fs.readFile(path.join(vault, r.note), 'utf8'), /Tanım cümlesi/);
  assert.match(await fs.readFile(path.join(vault, 'Hatırlatıcılar.md'), 'utf8'), /Ödev teslimi yedi Ekim \(örnek\).*7 Ekim 2026/);
  const receipts = await store.history(vault);
  for (const id of r.receipts) assert.ok(receipts.some(x => x.id === id && x.status === 'committed'));
  const feedback = (await fs.readFile(path.join(engine, 'egitim', 'onay_geri_bildirim.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(feedback.length, 4, 'audit mode stored every sentence, so every sentence becomes a label');
  assert.deepEqual(feedback.filter(f => f.tut !== f.model_tut).map(f => f.metin), ['Yanlışlıkla tutulan anekdot (örnek)']);
  assert.equal(r.corrected, 1);
  await assert.rejects(ring.approve('d1', {kept: [1]}), /zaten onaylandı/, 'a draft is approved once');
});

test('approving nothing is refused instead of writing an empty note', async t => {
  const {ring} = await setup(t);
  await assert.rejects(ring.approve('d1', {kept: []}), /seçilmedi/);
});

test('every script the panel loads is served by the app protocol', async () => {
  // ring.js was first added to index.html but not to the protocol allowlist in main.cjs; the
  // tab would have loaded as a 404 in the packaged app while unit tests stayed green.
  const html = await fs.readFile(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  const main = await fs.readFile(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) assert.match(main, new RegExp(`'/${src.replace('.', '\.')}': '${src.replace('.', '\.')}'`), src);
});

test('live listening writes straight to one session note, links known notes and dates reminders', async t => {
  const {vault, ring} = await setup(t);
  await fs.writeFile(path.join(vault, 'Claudian.md'), '# Claudian (örnek)\n');
  ring._setLive({startedAt: Date.parse('2026-09-23T10:30:00'), note: null, receipts: [], written: 0, reminders: 0, model: 'laya-yuzuk-v3', last: []});
  await ring.liveWrite({metin: 'Claudian için sessiz saat özelliği eklenecek (örnek).', saat: '10:31', yeni_konu: true, tarihler: []});
  await ring.liveWrite({metin: 'Rapor teslimi 7 Ekim (örnek).', saat: '10:32', yeni_konu: false, tarihler: [{ifade: '7 Ekim', zaman: '2026-10-07T00:00'}]});
  const notes = (await fs.readdir(vault)).filter(n => n.startsWith('Yüzük · 2026-09-23'));
  assert.equal(notes.length, 1, 'one session, one note');
  const body = await fs.readFile(path.join(vault, notes[0]), 'utf8');
  assert.match(body, /## 10:31 · Claudian için sessiz saat özelliği eklenecek \(örnek\)\./);
  assert.match(body, /- Claudian için sessiz saat özelliği eklenecek \(örnek\)\. `10:31` · \[\[Claudian\]\]/);
  assert.match(body, /- Rapor teslimi 7 Ekim \(örnek\)\. `10:32`\n/);
  assert.match(await fs.readFile(path.join(vault, 'Hatırlatıcılar.md'), 'utf8'), /Rapor teslimi 7 Ekim \(örnek\)/);
});

test('a note title links only as a whole, same-case word', async t => {
  const {vault, ring} = await setup(t);
  for (const n of ['Sistem.md', 'Claudian.md']) await fs.writeFile(path.join(vault, n), '# x (örnek)\n');
  ring._setLive({startedAt: Date.parse('2026-09-23T11:00:00'), note: null, receipts: [], written: 0, reminders: 0, model: 'v3', last: []});
  await ring.liveWrite({metin: 'Bilgiyi işleyen sistemde darboğaz var (örnek).', saat: '11:00', yeni_konu: true, tarihler: []});
  await ring.liveWrite({metin: "Claudian'ın paneli yenilenecek (örnek).", saat: '11:01', yeni_konu: false, tarihler: []});
  const body = await fs.readFile(path.join(vault, (await fs.readdir(vault)).find(n => n.startsWith('Yüzük ·'))), 'utf8');
  assert.doesNotMatch(body, /\[\[Sistem\]\]/, '"sistemde" is not the note "Sistem"');
  assert.match(body, /paneli yenilenecek \(örnek\)\. `11:01` · \[\[Claudian\]\]$/m);
});
