'use strict';
// Yüzük: Laya decides what reaches the note writer; the note writer (an LLM) writes the note.
// Laya never writes. These tests hold that division and the path rules around the engine folder.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const welcome = require('../welcome.cjs');
const store = require('../memory-store.cjs');
const {createRing, draftDir} = require('../ring.cjs');

// Shape only — none of this is a real recording.
const DRAFT = {
  baslik: 'Örnek ders (örnek)', kaynak: 'ornek.mp3', baslangic: '2026-09-23T10:30', ses_suresi_sn: 1260,
  parca: 4, tutulan: 3, kapi_model: 'laya-yuzuk-v2', durum: 'taslak', denetim: true,
  kayitlar: [
    {no: 0, saat: '10:30', tut: false, tur: 'gurultu', metin: 'Kapıyı kapatır mısınız (örnek)'},
    {no: 1, saat: '10:31', tut: true, tur: 'tanim', metin: 'Tanım cümlesi (örnek)'},
    {no: 2, saat: '10:40', tut: true, tur: 'odev', metin: 'Ödev teslimi yedi Ekim (örnek)'},
    {no: 3, saat: '10:45', tut: true, tur: 'gurultu', metin: 'Yanlışlıkla tutulan anekdot (örnek)'},
  ],
};

async function setup(t, opts = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-ring-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const vault = path.join(root, 'notes'), engine = path.join(root, 'engine'), data = path.join(root, 'data');
  await fs.mkdir(vault); await fs.mkdir(data);
  for (const [name, body] of Object.entries(welcome.skeleton('tr', 'Deniz', [], {}))) await fs.writeFile(path.join(vault, name), body);
  await fs.mkdir(path.join(engine, 'taslaklar', 'd1'), {recursive: true});
  await fs.writeFile(path.join(engine, 'taslaklar', 'd1', 'kararlar.json'), JSON.stringify(DRAFT));
  await fs.writeFile(path.join(data, 'ring.json'), JSON.stringify({engine}));
  const core = {dataDir: data, snapshot: async () => ({profile: {vault, language: 'tr'}})};
  const calls = [];
  // The note writer is Claude Code in production; this stand-in records what reached it.
  const synth = async session => {
    const lines = (await fs.readFile(session, 'utf8')).trim().split('\n').map(l => JSON.parse(l)).filter(x => x.tur !== 'oturum');
    calls.push(lines.map(l => l.metin));
    if (opts.fail) throw Error('Claude Code 1 koduyla kapandı (örnek)');
    return {baslik: 'Örnek not başlığı', not_md: '### Konu (örnek)\n- Birleştirilmiş madde, Claudian ile ilgili (örnek).',
      hatirlaticilar: [{tarih: '2026-10-07', metin: 'Ödev teslimi (örnek)'}], gereksiz: [3], maliyet_usd: 0.01};
  };
  const ring = createRing({core, send: () => {}, dialog: {}, getWindow: () => null, synth});
  return {vault, engine, ring, calls};
}

test('a draft id cannot leave the drafts folder', () => {
  for (const bad of ['..', '../x', 'a/b', 'a\\b', '', 'x'.repeat(200)]) assert.throws(() => draftDir('/e', bad));
  assert.equal(draftDir('/e', '2026-09-23_1030_Ders'), path.join('/e', 'taslaklar', '2026-09-23_1030_Ders'));
});

test("approval sends only the ticked sentences to the note writer and writes its note, not Laya's", async t => {
  const {vault, engine, ring, calls} = await setup(t);
  await fs.writeFile(path.join(vault, 'Claudian.md'), '# x (örnek)\n');
  const r = await ring.approve('d1', {kept: [1, 2]});
  assert.deepEqual(calls[0], ['Tanım cümlesi (örnek)', 'Ödev teslimi yedi Ekim (örnek)'], 'unticked and dropped sentences never reach the LLM');
  assert.equal(r.note, 'Yüzük · 2026-09-23 10.30 Örnek not başlığı.md');
  const body = await fs.readFile(path.join(vault, r.note), 'utf8');
  assert.ok(body.includes('# Örnek not başlığı'));
  assert.ok(body.includes('- Birleştirilmiş madde, Claudian ile ilgili (örnek).'));
  assert.ok(body.includes('İlgili: [[Claudian]]'));
  assert.ok(!body.includes('Tanım cümlesi (örnek)'), "Laya's selected sentences are not pasted into the note");
  assert.match(await fs.readFile(path.join(vault, 'Hatırlatıcılar.md'), 'utf8'), /Ödev teslimi \(örnek\).*7 Ekim 2026/);
  const receipts = await store.history(vault);
  for (const id of r.receipts) assert.ok(receipts.some(x => x.id === id && x.status === 'committed'));
  const feedback = (await fs.readFile(path.join(engine, 'egitim', 'onay_geri_bildirim.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(feedback.filter(f => f.tut !== f.model_tut).map(f => f.metin), ['Yanlışlıkla tutulan anekdot (örnek)']);
  await assert.rejects(ring.approve('d1', {kept: [1]}), /zaten onaylandı/, 'a draft is approved once');
});

test('if the note writer fails, nothing is written and the draft stays open', async t => {
  const {vault, engine, ring} = await setup(t, {fail: true});
  await assert.rejects(ring.approve('d1', {kept: [1]}), /Claude Code 1/);
  assert.ok(!(await fs.readdir(vault)).some(n => n.startsWith('Yüzük ·')));
  assert.equal(JSON.parse(await fs.readFile(path.join(engine, 'taslaklar', 'd1', 'kararlar.json'), 'utf8')).durum, 'taslak');
});

test('approving nothing is refused instead of writing an empty note', async t => {
  const {ring} = await setup(t);
  await assert.rejects(ring.approve('d1', {kept: []}), /seçilmedi/);
});

test('a live session is written by the note writer when listening stops', async t => {
  const {vault, engine, ring, calls} = await setup(t);
  const session = path.join(engine, 'oturumlar', 's.jsonl');
  await fs.mkdir(path.dirname(session), {recursive: true});
  await fs.writeFile(session, [{tur: 'oturum', baslangic: '2026-09-23T11:00'}, {no: 1, saat: '11:00', metin: 'Aktarılan cümle (örnek)', neden: 'laya'}]
    .map(x => JSON.stringify(x)).join('\n') + '\n');
  const r = await ring.finishSession(session, Date.parse('2026-09-23T11:00:00'), {cumle: 5, aktarilan: 1, baglam: 0, mahrem: 1});
  assert.deepEqual(calls[0], ['Aktarılan cümle (örnek)']);
  assert.ok((await fs.readFile(path.join(vault, r.note), 'utf8')).includes('5 cümle duyuldu, 1 mahrem çıkarıldı'));
  assert.equal(await ring.finishSession(session, Date.now(), {cumle: 3, aktarilan: 0}), null, 'nothing passed, no note');
});

test('every script the panel loads is served by the app protocol', async () => {
  // ring.js was first added to index.html but not to the protocol allowlist in main.cjs; the
  // tab would have loaded as a 404 in the packaged app while unit tests stayed green.
  const html = await fs.readFile(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  const main = await fs.readFile(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(main.includes(`'/${src}': '${src}'`), src);
});

test('phone card: an engine without sunucu.py is reported as not capable, and no key is ever returned', async t => {
  const {engine, ring} = await setup(t);
  assert.deepEqual(await ring.phoneStatus(), {capable: false});
  await fs.writeFile(path.join(engine, 'sunucu.py'), '# (örnek)\n');
  await fs.writeFile(path.join(engine, 'sunucu_anahtar.txt'), 'gizli-anahtar-ornek');
  const s = await ring.phoneStatus();
  assert.equal(s.capable, true);
  assert.equal(typeof s.running, 'boolean');
  assert.equal(s.origin, 'https://yuzuk.claudian.app');
  assert.ok(!JSON.stringify(s).includes('gizli-anahtar-ornek'), 'the server key stays in the engine folder');
});

test('note writer: the choice is stored per computer and only known writers are accepted', async t => {
  const {ring} = await setup(t);
  const w = await ring.writers();
  assert.equal(w.chosen, 'claude', 'default writer');
  assert.deepEqual(w.list.map(x => x.id), ['claude', 'codex', 'gemini']);
  assert.equal((await ring.setWriter('codex')).chosen, 'codex');
  assert.equal((await ring.writers()).chosen, 'codex', 'the choice survives');
  await assert.rejects(ring.setWriter('bilinmeyen'), /Bilinmeyen/);
});

test('phone inbox: a phone recording reaches this vault, its dated work the reminders and its undated work the panel', async t => {
  const {vault, engine, ring} = await setup(t);
  const inbox = path.join(engine, 'gelen_not');
  await fs.mkdir(inbox, {recursive: true});
  const id = '0123456789abcdef0123456789abcdef';
  await fs.writeFile(path.join(inbox, `${id}.json`), JSON.stringify({baslik: 'Ders (örnek)', baslangic: '2026-09-26T14:00:00', sonuc: {
    baslik: 'Örnek ders notu', not_md: '### Özet\n- Konu anlatıldı (örnek).', yazici: 'claude', cumle: 40, ses_suresi_sn: 600,
    hatirlaticilar: [{tarih: '2026-10-03', saat: '10:30', metin: 'Quiz (örnek)'}],
    takip: ['Hoca örnek ödevi verdi, tarih söylenmedi (örnek)']}}));
  await fs.writeFile(path.join(inbox, 'baska-bir-dosya.json'), '{}');
  assert.equal(await ring.inboxOnce(), 1);
  const answer = JSON.parse(await fs.readFile(path.join(inbox, `${id}.sonuc.json`), 'utf8'));
  assert.equal(answer.hatirlatici, 1);
  assert.equal(answer.takip, 1);
  assert.match(answer.not, /^Yüzük · 2026-09-26 14\.00 Örnek ders notu\.md$/);
  await assert.rejects(fs.access(path.join(inbox, `${id}.json`)), 'the note text does not linger in the inbox');
  await fs.access(path.join(inbox, 'baska-bir-dosya.json')); // not a server id: left alone
  const all = (await store.list(vault)).map(n => n.note);
  const text = async role => (await Promise.all(all.map(n => fs.readFile(path.join(vault, n), 'utf8')))).find(b => b.includes(`claudian_role: ${role}`));
  assert.match(await text('reminders'), /Quiz \(örnek\) · saat 10:30\*\* · \*\*3 Ekim 2026\*\*/);
  assert.match(await text('panel'), /Hoca örnek ödevi verdi, tarih söylenmedi \(örnek\)\*\* · açıldı:/);
  assert.equal(await ring.inboxOnce(), 0, 'nothing is written twice');
});
