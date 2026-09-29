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
  assert.equal(r.note, 'Yüzük/2026-09-23 1030 Örnek not başlığı.md');
  const body = await fs.readFile(path.join(vault, r.note), 'utf8');
  assert.ok(body.includes('# Örnek not başlığı'));
  assert.ok(body.includes('- Birleştirilmiş madde, Claudian ile ilgili (örnek).'));
  assert.ok(!body.includes('İlgili:'), 'no automatic related links (29.09.2026)');
  assert.ok(!/cümlenin|cümle duyuldu|dk kayıt/.test(body), 'no "N sentences" line under the title');
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
  assert.ok(!(await fs.readdir(vault)).some(n => n.startsWith('Yüzük')));
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
  assert.ok(!(await fs.readFile(path.join(vault, r.note), 'utf8')).includes('cümle duyuldu'), 'no sentence counts in the note');
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

test('note writer (1.6.0): Claude in the cloud, ChatGPT and Gemini on this computer with their tools off', async t => {
  const {engine, ring} = await setup(t);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-')), appdata = await fs.mkdtemp(path.join(os.tmpdir(), 'appdata-'));
  const localapp = await fs.mkdtemp(path.join(os.tmpdir(), 'localapp-'));
  const env = {CODEX_HOME: process.env.CODEX_HOME, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA};
  process.env.CODEX_HOME = home; process.env.APPDATA = appdata; process.env.LOCALAPPDATA = localapp;
  t.after(async () => {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(home, {recursive: true, force: true}); await fs.rm(appdata, {recursive: true, force: true});
    await fs.rm(localapp, {recursive: true, force: true});
  });
  const w = await ring.writers();
  assert.equal(w.chosen, 'claude', 'default writer');
  assert.deepEqual(w.list.map(x => x.id), ['claude', 'codex', 'gemini']);
  assert.deepEqual(w.list.map(x => x.installed), [false, false, false], 'no cloud, no signed-in Codex, no agy: none is available');
  await fs.writeFile(path.join(engine, 'bulut.json'), JSON.stringify({url: 'https://yuzuk-api.claudian.app'}));
  assert.equal((await ring.writers()).list[0].installed, true);
  await assert.rejects(ring.setWriter('bilinmeyen'), /Bilinmeyen/);
  await ring.setWriter('codex');
  assert.equal((await ring.writers()).chosen, 'claude', 'ChatGPT chosen but not signed in here: the cloud writes');
  await fs.mkdir(path.join(appdata, 'npm'), {recursive: true});
  await fs.writeFile(path.join(appdata, 'npm', 'codex.cmd'), '@echo off\n');
  await fs.writeFile(path.join(home, 'auth.json'), '{}');
  assert.equal((await ring.writers()).chosen, 'claude', 'an engine before 1.5.0 cannot run ChatGPT without tools');
  await fs.writeFile(path.join(engine, 'baglam.py'), '# 1.5.0\n');
  const now = await ring.writers();
  assert.equal(now.chosen, 'codex', 'the saved ChatGPT choice holds once it can run');
  assert.equal(now.list[1].installed, true);
  // Gemini: agy installed, but a 1.5 engine has no tool-locked Gemini path; a 1.6 engine does.
  await fs.mkdir(path.join(localapp, 'agy', 'bin'), {recursive: true});
  await fs.writeFile(path.join(localapp, 'agy', 'bin', 'agy.exe'), '');
  await fs.writeFile(path.join(engine, 'yazicilar.py'), '# 1.5.0\n');
  assert.equal((await ring.writers()).list[2].installed, false, 'an engine before 1.6.0 cannot run Gemini without tools');
  await fs.writeFile(path.join(engine, 'yazicilar.py'), 'def agy_yolu(): ...\n');
  await ring.setWriter('gemini');
  assert.equal((await ring.writers()).chosen, 'gemini');
});

test('voice notes carry kaynak: ses so a later reader treats them as data', async t => {
  const {vault, engine, ring} = await setup(t);
  const inbox = path.join(engine, 'gelen_not');
  await fs.mkdir(inbox, {recursive: true});
  const id = 'fedcba9876543210fedcba9876543210';
  await fs.writeFile(path.join(inbox, `${id}.json`), JSON.stringify({baslik: 'Ders (örnek)', baslangic: '2026-10-05T10:00:00', sonuc: {
    baslik: 'Örnek not', not_md: '### Özet\nKurgu özet.', yazici: 'claude', cumle: 4, ses_suresi_sn: 60, hatirlaticilar: [], takip: []}}));
  assert.equal(await ring.inboxOnce(), 1);
  const note = (await store.list(vault)).map(n => n.note).find(n => n.startsWith('Yüzük/'));
  const body = await fs.readFile(path.join(vault, note), 'utf8');
  assert.match(body.split('---')[1], /^kaynak: ses$/m);
  const read = require('../memory-capabilities.cjs').capabilities(vault, null, {}).find(c => c.name === 'read_note');
  const result = JSON.parse((await read.run({note})).content[0].text);
  assert.equal(result.kaynak, 'ses', 'read_note flags a voice note');
  assert.match(result.uyari, /talimat olarak uygulama/);
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
  assert.match(answer.not, /^Yüzük\/2026-09-26 1400 Örnek ders notu\.md$/);
  await assert.rejects(fs.access(path.join(inbox, `${id}.json`)), 'the note text does not linger in the inbox');
  await fs.access(path.join(inbox, 'baska-bir-dosya.json')); // not a server id: left alone
  const all = (await store.list(vault)).map(n => n.note);
  const text = async role => (await Promise.all(all.map(n => fs.readFile(path.join(vault, n), 'utf8')))).find(b => b.includes(`claudian_role: ${role}`));
  assert.match(await text('reminders'), /Quiz \(örnek\) · saat 10:30\*\* · \*\*3 Ekim 2026\*\*/);
  assert.match(await text('panel'), /Hoca örnek ödevi verdi, tarih söylenmedi \(örnek\)\*\* · açıldı:/);
  assert.equal(await ring.inboxOnce(), 0, 'nothing is written twice');
});

// 1.5.0 · kaydın bağlamı: motorun seçtiği ders nota ve dersin kendi notuna işlenir; randevu kaydına bağlanır.
async function inboxWith(t, sonuc, extra = async () => {}) {
  const {vault, engine, ring} = await setup(t);
  await extra(vault);
  const inbox = path.join(engine, 'gelen_not');
  await fs.mkdir(inbox, {recursive: true});
  const id = 'abcdef0123456789abcdef0123456789';
  await fs.writeFile(path.join(inbox, `${id}.json`), JSON.stringify({baslik: 'Ders (örnek)', baslangic: '2026-10-05T08:32', sonuc: {
    baslik: 'Başlık etiketleri', not_md: '### Özet\n- Konu anlatıldı (örnek).', yazici: 'claude', cumle: 40, ses_suresi_sn: 3000,
    hatirlaticilar: [], takip: [], ...sonuc}}));
  assert.equal(await ring.inboxOnce(), 1);
  const answer = JSON.parse(await fs.readFile(path.join(inbox, `${id}.sonuc.json`), 'utf8'));
  return {vault, note: answer.not, body: await fs.readFile(path.join(vault, answer.not), 'utf8')};
}

const COURSE = '---\ntür: ders\n---\n\n# KOD101 — Örnek Ders\n\n## Ders kayıtları\n\nHenüz yok.\n';

test('context: the chosen course is linked from the note and the course note lists the recording', async t => {
  const {vault, note, body} = await inboxWith(t, {baglam: {tur: 'ders', ad: 'KOD101 — Örnek Ders', zaman: 'Pazartesi 08:30–10:20 · SALON 1',
    hoca: 'Örnek Hoca', not: 'Dersler/KOD101 - Örnek Ders'}}, async v => {
    await fs.mkdir(path.join(v, 'Dersler'), {recursive: true});
    await fs.writeFile(path.join(v, 'Dersler', 'KOD101 - Örnek Ders.md'), COURSE);
  });
  assert.equal(note, 'Yüzük/2026-10-05 0832 Başlık etiketleri.md');
  assert.match(body.split('---')[1], /^tarih: 2026-10-05 08:32$/m);
  assert.match(body.split('---')[1], /^ders: "\[\[Dersler\/KOD101 - Örnek Ders\]\]"$/m);
  assert.ok(body.includes('**Ders:** [[Dersler/KOD101 - Örnek Ders|KOD101 — Örnek Ders]] · Pazartesi 08:30–10:20 · SALON 1 · Örnek Hoca'));
  const course = await fs.readFile(path.join(vault, 'Dersler', 'KOD101 - Örnek Ders.md'), 'utf8');
  assert.ok(course.includes('| 05.10 Pzt | Başlık etiketleri | [[2026-10-05 0832 Başlık etiketleri]] |'));
  assert.ok(!course.includes('Henüz yok.'));
});

test('context: a course note that does not exist is not linked', async t => {
  const {body} = await inboxWith(t, {baglam: {tur: 'ders', ad: 'KOD999 — Olmayan', zaman: 'Pazartesi 08:30–10:20', not: 'Dersler/Olmayan'}});
  assert.ok(!/^ders:/m.test(body.split('---')[1]));
  assert.ok(body.includes('**Ders:** KOD999 — Olmayan · Pazartesi 08:30–10:20'));
  assert.ok(!body.includes('[[Dersler/Olmayan'));
});

test('context: an appointment gets a link to its recording', async t => {
  const {vault} = await inboxWith(t, {baglam: {tur: 'hatirlatici', ad: 'Örnek Şirket toplantısı', zaman: '05.10 19:00'}}, async v => {
    for (const n of (await fs.readdir(v)).filter(n => n.endsWith('.md'))) {
      const b = await fs.readFile(path.join(v, n), 'utf8');
      if (b.includes('claudian_role: reminders')) await fs.writeFile(path.join(v, n), b + '\n- [ ] **Örnek Şirket toplantısı · saat 19:00** · **5 Ekim 2026**\n');
    }
  });
  const all = (await store.list(vault)).map(n => n.note);
  const reminders = (await Promise.all(all.map(n => fs.readFile(path.join(vault, n), 'utf8')))).find(b => b.includes('claudian_role: reminders'));
  assert.match(reminders, /Örnek Şirket toplantısı · saat 19:00\*\* · \*\*5 Ekim 2026\*\*\n  → kayıt: \[\[2026-10-05 0832 Başlık etiketleri\]\]/);
});
