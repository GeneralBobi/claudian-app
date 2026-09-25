'use strict';
/*
  Yüzük — the note-taking ring's software side, run on this computer.

  The engine is not bundled: it is a Python folder (Whisper + Laya, ~3 GB of models) that the
  person installs once. This module only finds it, runs it, and turns its drafts into memory.

  Rules that hold below:
  - A recorded FILE becomes a draft in the engine's `taslaklar/` folder and reaches memory only
    through approval. LIVE listening (0.23) writes straight to the vault, as asked; what must never
    be written is decided before that by the engine's privacy layer, and every write has a receipt.
  - Audio and text never leave this machine. The phone receiver listens on the local network
    only, requires a one-time token, and stores what it receives in the engine folder.
*/
const fs = require('fs/promises');
const fss = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {spawn} = require('child_process');
const store = require('./memory-store.cjs');
const {capture} = require('./memory-capture.cjs');

const AUDIO = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'webm', 'aac', 'mp4'];
const DRAFT_ID = /^[\w.\-]{1,120}$/u;
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GiB — about ten hours of phone audio
const RECEIVER_PORT = 3052;

function defaultEngine() { return path.join(os.homedir(), 'Desktop', 'Yuzuk', 'laya-kapi'); }

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

function draftDir(engine, id) {
  if (typeof id !== 'string' || !DRAFT_ID.test(id) || id.includes('..')) throw Error('Geçersiz taslak.');
  return path.join(engine, 'taslaklar', id);
}

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();


function createRing({core, send, dialog, getWindow, notify, synth}) {
  let engine = null, job = null, receiver = null;
  const settingsFile = () => path.join(core.dataDir, 'ring.json');

  async function engineDir() {
    if (engine) return engine;
    try { engine = JSON.parse(await fs.readFile(settingsFile(), 'utf8')).engine || null; } catch {}
    return engine ||= defaultEngine();
  }

  /* ---- note writer: the person picks which AI writes the note (Boran, 23.09.2026) ---- */
  const WRITERS = {claude: 'Claude', codex: 'ChatGPT (Codex)', gemini: 'Gemini'};

  async function settings() {
    try { return JSON.parse(await fs.readFile(settingsFile(), 'utf8')); } catch { return {}; }
  }

  async function writerInstalled(id) {
    const home = os.homedir(), npm = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm');
    const candidates = {claude: [path.join(home, '.local', 'bin', 'claude.exe'), path.join(npm, 'claude.cmd')],
      codex: [path.join(npm, 'codex.cmd')], gemini: [path.join(npm, 'gemini.cmd')]}[id] || [];
    for (const c of candidates) if (await exists(c)) return true;
    return false;
  }

  async function writers() {
    const chosen = (await settings()).yazici || 'claude';
    const list = [];
    for (const [id, name] of Object.entries(WRITERS)) list.push({id, name, installed: await writerInstalled(id)});
    return {chosen: WRITERS[chosen] ? chosen : 'claude', list};
  }

  async function setWriter(id) {
    if (!WRITERS[id]) throw Error('Bilinmeyen not yazıcısı.');
    const cur = await settings();
    await fs.writeFile(settingsFile(), JSON.stringify({...cur, engine: cur.engine || await engineDir(), yazici: id}, null, 1));
    return writers();
  }

  async function writer() { return (await writers()).chosen; }

  async function status() {
    const dir = await engineDir();
    const python = path.join(dir, '.venv', 'Scripts', 'python.exe');
    const checks = {
      engine: await exists(path.join(dir, 'notcikar.py')),
      python: await exists(python),
      whisper: await exists(path.join(dir, 'modeller', 'whisper-large-v3-turbo', 'model.bin')),
      tuned: false,
    };
    // The newest trained model wins, as in the engine's kapi.py (laya-yuzuk-v2 before v1).
    const versions = (await fs.readdir(path.join(dir, 'modeller')).catch(() => []))
      .filter(n => /^laya-yuzuk-v\d+$/.test(n)).sort((a, b) => Number(b.slice(12)) - Number(a.slice(12)));
    let training = null, model = null;
    for (const v of versions) {
      if (!await exists(path.join(dir, 'modeller', v, 'model.safetensors'))) continue;
      model = v; checks.tuned = true;
      try { training = JSON.parse(await fs.readFile(path.join(dir, 'modeller', v, 'rl_agent_config.json'), 'utf8')).yuzuk || null; } catch {}
      break;
    }
    return {dir, ready: checks.engine && checks.python && checks.whisper, checks, training, model,
      running: job ? {file: job.file, events: job.events.slice(-40)} : null,
      live: liveStatus(),
      liveCapable: await exists(path.join(dir, 'canli.py')),
      // Laya'sız yol (23.09.2026): tam döküm seçilen yazıcıya gider. Eski motorlarda yoksa Laya yolu kalır.
      full: await exists(path.join(dir, 'tamnot.py')),
      writers: await writers(),
      receiver: receiver ? {url: receiver.url, received: receiver.received} : null};
  }

  async function chooseEngine() {
    const r = await dialog.showOpenDialog(getWindow(), {properties: ['openDirectory'], title: 'Yüzük motor klasörü'});
    if (r.canceled || !r.filePaths[0]) return null;
    if (!await exists(path.join(r.filePaths[0], 'notcikar.py'))) throw Error('Bu klasörde notcikar.py yok; Yüzük motoru bu değil.');
    engine = r.filePaths[0];
    await fs.mkdir(core.dataDir, {recursive: true});
    await fs.writeFile(settingsFile(), JSON.stringify({engine}, null, 2));
    return status();
  }

  async function chooseAudio() {
    const r = await dialog.showOpenDialog(getWindow(), {properties: ['openFile'], title: 'Ses dosyası',
      filters: [{name: 'Ses', extensions: AUDIO}]});
    if (r.canceled || !r.filePaths[0]) return null;
    const stat = await fs.stat(r.filePaths[0]);
    return {file: r.filePaths[0], name: path.basename(r.filePaths[0]), size: stat.size, modified: stat.mtime.toISOString()};
  }

  async function run(input) {
    if (job) throw Error('Bir kayıt zaten işleniyor.');
    const dir = await engineDir();
    const file = String(input?.file || '');
    if (!AUDIO.includes(path.extname(file).slice(1).toLowerCase()) || !await exists(file)) throw Error('Ses dosyası bulunamadı.');
    const full = await exists(path.join(dir, 'tamnot.py'));
    const chosenWriter = await writer();
    const args = full ? [path.join(dir, 'tamnot.py'), file, '--json-ilerleme', '--yazici', chosenWriter]
      : [path.join(dir, 'notcikar.py'), file, '--json-ilerleme'];
    if (clean(input.title)) args.push('--baslik', clean(input.title).slice(0, 80));
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input.start || '')) args.push('--baslangic', input.start);
    if (input.language === 'tr' || input.language === 'en') args.push('--dil', input.language);
    if (input.audit === true && !full) args.push('--denetim');
    const startedAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input.start || '') ? input.start.replace(' ', 'T') : new Date().toISOString();
    const child = spawn(path.join(dir, '.venv', 'Scripts', 'python.exe'), args, {cwd: dir, windowsHide: true,
      env: {...process.env, USE_TF: '0', HF_HUB_OFFLINE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1'}});
    job = {child, file: path.basename(file), events: [], stderr: '', full, writer: WRITERS[chosenWriter]};
    const emit = event => { job?.events.push(event); send('ring:event', event); };
    emit({olay: 'basladi', dosya: path.basename(file)});
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
        if (!line.startsWith('@@')) continue;
        let ev; try { ev = JSON.parse(line.slice(2)); } catch { continue; }
        emit(ev);
        if (full && ev.olay === 'bitti') finishFull(ev.sonuc, {title: clean(input.title) || path.basename(file), startedAt, emit});
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', c => { if (job) job.stderr = (job.stderr + c).slice(-4000); });
    child.on('close', code => {
      const finished = job?.events.find(e => e.olay === 'bitti');
      const tail = job?.stderr.split('\n').filter(l => l.trim() && !/warn/i.test(l)).slice(-3).join('\n');
      if (!finished) emit({olay: 'hata', kod: code, mesaj: code === null ? 'Durduruldu.' : (tail || `Motor ${code} koduyla kapandı.`)});
      job = null;
      if (finished && !full) notify?.('Yüzük', `${finished.tutulan} madde çıkarıldı — taslak onay bekliyor.`);
      send('ring:event', {olay: 'kapandi'});
    });
    return true;
  }

  // Konuşmacı ayrımı (24.09.2026): ortamda kaç kişi konuştu; ses izi kayıtlıysa kullanıcının payı.
  function people(result) {
    const k = result?.konusmaci;
    if (!k || (k.sayi || 0) < 2) return '';
    const total = Object.values(k.sureler || {}).reduce((a, b) => a + b, 0);
    const mine = k.sen && total ? ` (sen %${Math.round(((k.sureler || {}).Sen || 0) / total * 100)})` : '';
    return ` · ${k.sayi} kişi${mine}`;
  }

  /* Laya'sız kayıt: not, onay adımı olmadan doğrudan hafızaya yazılır ve geçmişte bir kayıt olarak durur. */
  async function finishFull(result, {title, startedAt, emit}) {
    try {
      if (!String(result?.not_md || '').trim()) { emit({olay: 'yazildi', bos: true}); return; }
      const mins = Math.max(1, Math.round((result.ses_suresi_sn || 0) / 60));
      const written = await writeSynthNote({title, startedAt, result,
        source: `${mins} dk kayıt · ${result.cumle || 0} cümlenin tamamı${result.mahrem ? ` (${result.mahrem} mahrem çıkarıldı)` : ''}${people(result)}`,
        reason: `Yüzük kaydı işlendi: ${clean(title)}`});
      const id = `${String(startedAt).slice(0, 16).replace(/[:T]/g, '-')}_${clean(title).replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}`;
      const d = path.join(await engineDir(), 'taslaklar', id);
      await fs.mkdir(d, {recursive: true});
      await fs.writeFile(path.join(d, 'kararlar.json'), JSON.stringify({baslik: title, baslangic: String(startedAt).slice(0, 16),
        ses_suresi_sn: result.ses_suresi_sn, parca: result.cumle, tutulan: (result.cumle || 0) - (result.mahrem || 0), durum: 'yazildi',
        not: written.note, yazici: result.yazici, kayitlar: []}, null, 1));
      emit({olay: 'yazildi', not: written.note, hatirlatici: written.reminders.length, yazici: result.yazici});
      notify?.('Yüzük', `Not yazıldı: ${written.note.replace(/\.md$/, '')}`);
    } catch (e) {
      emit({olay: 'hata', mesaj: e.message});
    }
  }

  function cancel() { if (job) job.child.kill(); return true; }

  async function drafts() {
    const root = path.join(await engineDir(), 'taslaklar');
    const names = await fs.readdir(root).catch(() => []);
    const out = [];
    for (const id of names) {
      try {
        const d = JSON.parse(await fs.readFile(path.join(root, id, 'kararlar.json'), 'utf8'));
        out.push({id, title: d.baslik, start: d.baslangic, seconds: d.ses_suresi_sn, total: d.parca, kept: d.tutulan,
          status: d.durum, note: d.not || null, audit: !!d.denetim});
      } catch {}
    }
    return out.sort((a, b) => String(b.start).localeCompare(String(a.start)));
  }

  async function draft(id) {
    return JSON.parse(await fs.readFile(path.join(draftDir(await engineDir(), id), 'kararlar.json'), 'utf8'));
  }

  /*
    The note is written by the LLM, never by Laya (Boran, 23.09.2026: "modelin görevi yazı yazmak
    bile değil"). Laya decides what reaches the LLM; the engine's sentez.py hands those sentences to
    Claude Code on this computer and returns a structured note, reminders, and which passed sentences
    were noise (kept as Laya's next training labels). This side only writes the result, with receipts.
  */
  async function synthesize(sessionFile, title) {
    if (synth) return synth(sessionFile, title);
    const dir = await engineDir();
    const full = await exists(path.join(dir, 'tamnot.py'));
    const args = full ? [path.join(dir, 'sentez.py'), sessionFile, '--tam', '--yazici', await writer()]
      : [path.join(dir, 'sentez.py'), sessionFile, '--etiket'];
    if (clean(title)) args.push('--baslik', clean(title).slice(0, 120));
    return new Promise((resolve, reject) => {
      const child = spawn(path.join(dir, '.venv', 'Scripts', 'python.exe'), args, {cwd: dir, windowsHide: true,
        env: {...process.env, PYTHONIOENCODING: 'utf-8'}});
      let out = '', err = '';
      child.stdout.setEncoding('utf8'); child.stdout.on('data', c => { out += c; });
      child.stderr.setEncoding('utf8'); child.stderr.on('data', c => { err = (err + c).slice(-2000); });
      child.on('close', code => {
        if (code !== 0) return reject(Error(err.split('\n').filter(l => l.trim()).slice(-2).join(' ') || `Not yazılamadı (${code}).`));
        try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { reject(Error('Not yazıcısından okunamayan yanıt.')); }
      });
    });
  }

  async function writeSynthNote({title, startedAt, source, result, reason}) {
    const profile = (await core.snapshot()).profile;
    if (!profile?.vault) throw Error('Hafıza klasörü kurulu değil.');
    const vault = profile.vault, language = profile.language === 'en' ? 'en' : 'tr';
    const d = new Date(startedAt);
    const heading = clean(result.baslik || title || 'Kayıt').replace(/[\\/:*?"<>|#^[\]]+/g, '-').slice(0, 60);
    let note = `Yüzük · ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())} ${heading}.md`;
    if (await exists(path.join(vault, note))) note = note.replace(/\.md$/, ` (${Date.now() % 10000}).md`);
    const titles = [...new Set((await store.list(vault).catch(() => [])).map(n => n.note.replace(/\.md$/, '').split('/').pop())
      .filter(t => t && t.length >= 4 && !/^(00 -|Yüzük ·)/.test(t)))];
    const md = String(result.not_md || '').trim();
    const links = titles.filter(t => new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|['’]|[^\\p{L}])`, 'u').test(md)).slice(0, 6);
    const body = ['---', 'tags: [yüzük]', 'tür: log', `güncellenme: ${new Date().toISOString().slice(0, 10)}`, '---', '',
      `# ${clean(result.baslik || title || 'Kayıt')}`, '',
      `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${source}`, '',
      md, '', ...(links.length ? [`İlgili: ${links.map(t => `[[${t}]]`).join(' · ')}`, ''] : []), '---',
      result.yazici
        ? `_Yüzük: konuşma bu bilgisayarda yazıya döküldü; mahrem cümleler çıkarıldı, kalanın tamamı notu yazan araca (${WRITERS[result.yazici] || result.yazici}) gitti. Ses saklanmadı._`
        : '_Yüzük: konuşma bu bilgisayarda yazıya döküldü, Laya neyin aktarılacağına karar verdi, notu Claude yazdı. Mahrem ve kapsam dışı cümleler gönderilmedi; ses saklanmadı._', ''].join('\n');
    const receipts = [(await store.mutate(vault, {note, operation: 'create', body, reason}, 'yuzuk')).id];
    const reminders = [];
    for (const h of result.hatirlaticilar || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(h.tarih || '') || !clean(h.metin)) continue;
      const c = await capture(vault, {kind: 'commitment', text: clean(h.metin).slice(0, 380), date: h.tarih, source: 'user_statement',
        reference: note.replace(/\.md$/, '').slice(0, 200), reason: 'Yüzük notundaki tarihli iş'}, 'yuzuk', language);
      reminders.push({text: clean(h.metin), date: h.tarih, status: c.status});
      if (c.receipt) receipts.push(c.receipt);
    }
    return {note, receipts, reminders};
  }

  /*
    File approval: the sentences the person kept go to the LLM, which writes the note. The person's
    corrections of Laya's selection are kept as training data.
  */
  async function approve(id, choice) {
    const dir = await engineDir();
    const d = await draft(id);
    if (d.durum === 'onaylandi') throw Error('Bu taslak zaten onaylandı.');
    const kept = new Set((choice?.kept || []).filter(n => Number.isInteger(n)));
    if (!kept.size) throw Error('Onaylanacak madde seçilmedi.');
    const items = d.kayitlar.filter(k => kept.has(k.no) && k.metin);
    const session = path.join(dir, 'oturumlar', `onay_${id}.jsonl`);
    await fs.mkdir(path.dirname(session), {recursive: true});
    await fs.writeFile(session, [{tur: 'oturum', baslangic: d.baslangic, baslik: d.baslik},
      ...items.map(k => ({no: k.no, saat: k.saat, metin: k.metin, neden: 'onay'}))].map(x => JSON.stringify(x)).join('\n') + '\n');
    const result = await synthesize(session, d.baslik);
    const written = await writeSynthNote({title: d.baslik, startedAt: d.baslangic, result,
      source: `${Math.round((d.ses_suresi_sn || 0) / 60)} dk kayıt · ${items.length} onaylı cümleden`, reason: `Yüzük taslağı onaylandı: ${clean(d.baslik)}`});
    const feedback = d.kayitlar.filter(k => k.metin).map(k => ({metin: k.metin, tut: kept.has(k.no),
      tur: kept.has(k.no) ? (k.tur === 'gurultu' ? 'tanim' : k.tur) : 'gurultu', model_tut: k.tut,
      bolum: 'egitim', kaynak: `onay: ${clean(d.baslik)} (${String(d.baslangic).slice(0, 10)})`}));
    const changed = feedback.filter(f => f.tut !== f.model_tut).length;
    await fs.mkdir(path.join(dir, 'egitim'), {recursive: true});
    await fs.appendFile(path.join(dir, 'egitim', 'onay_geri_bildirim.jsonl'), feedback.map(f => JSON.stringify(f)).join('\n') + '\n', 'utf8');
    Object.assign(d, {durum: 'onaylandi', not: written.note, onay: {at: new Date().toISOString(), kept: [...kept], reminders: written.reminders, receipts: written.receipts, corrected: changed}});
    await fs.writeFile(path.join(draftDir(dir, id), 'kararlar.json'), JSON.stringify(d, null, 1), 'utf8');
    return {note: written.note, reminders: written.reminders, receipts: written.receipts, corrected: changed};
  }

  async function discard(id) {
    const d = draftDir(await engineDir(), id);
    await fs.rm(d, {recursive: true, force: true});
    return true;
  }

  /* ---- phone → this computer, local network only ---- */
  function lanAddress() {
    for (const list of Object.values(os.networkInterfaces()))
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
    return null;
  }

  const uploadPage = token => `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yüzük</title>
<style>body{font-family:system-ui,sans-serif;background:#0e0e10;color:#f2f0eb;margin:0;padding:28px 20px;max-width:520px}h1{font-size:22px}h1 span{color:#d97757}p{color:#b4b0a9;line-height:1.6}label,button{display:block;width:100%;box-sizing:border-box;margin:14px 0;padding:16px;border-radius:8px;font-size:16px}label{border:1px dashed #3a3a44;text-align:center}button{background:#d97757;border:0;color:#0e0e10;font-weight:600}#d{font-family:monospace;font-size:14px}</style>
<h1>claudian<span>.</span>app · Yüzük</h1><p>Kaydı seç ve gönder. Dosya yalnız yerel ağdaki bilgisayarına gider; orada nota dönüşür.</p>
<label>Ses dosyası seç<input id="f" type="file" accept="audio/*" capture hidden></label><button id="b">Gönder</button><p id="d"></p>
<script>const d=document.getElementById('d');document.getElementById('f').onchange=e=>d.textContent=e.target.files[0]?.name||'';
document.getElementById('b').onclick=async()=>{const f=document.getElementById('f').files[0];if(!f){d.textContent='Önce bir dosya seç.';return}
d.textContent='Gönderiliyor…';const r=await fetch('/yukle?t=${token}&ad='+encodeURIComponent(f.name),{method:'PUT',body:f}).catch(()=>null);
d.textContent=r&&r.ok?'Gönderildi. Bilgisayarında işleniyor.':'Gönderilemedi'+(r?': '+await r.text():'.');}</script></html>`;

  async function receiverStart() {
    if (receiver) return status();
    const ip = lanAddress();
    if (!ip) throw Error('Bu bilgisayar bir yerel ağa bağlı değil.');
    const token = crypto.randomBytes(12).toString('hex');
    const inbox = path.join(await engineDir(), 'gelen');
    await fs.mkdir(inbox, {recursive: true});
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.searchParams.get('t') !== token) { res.writeHead(403).end('Geçersiz bağlantı.'); return; }
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end(uploadPage(token)); return; }
      if (req.method !== 'PUT' || url.pathname !== '/yukle') { res.writeHead(404).end(); return; }
      const ext = path.extname(url.searchParams.get('ad') || '').slice(1).toLowerCase();
      if (!AUDIO.includes(ext)) { res.writeHead(415).end('Ses dosyası değil.'); return; }
      if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD) { res.writeHead(413).end('Dosya çok büyük.'); return; }
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const target = path.join(inbox, `telefon-${stamp}.${ext}`);
      let size = 0; const out = fss.createWriteStream(target, {flags: 'wx'});
      req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); fs.unlink(target).catch(() => {}); } });
      req.pipe(out);
      out.on('finish', async () => {
        res.writeHead(200).end('ok');
        receiver && (receiver.received += 1);
        send('ring:event', {olay: 'alindi', dosya: path.basename(target)});
        if (!job) run({file: target, title: 'Telefon kaydı', start: stamp.slice(0, 10) + ' ' + stamp.slice(11, 16).replace('-', ':')}).catch(e => send('ring:event', {olay: 'hata', mesaj: e.message}));
      });
      out.on('error', () => { if (!res.headersSent) res.writeHead(500).end('Kaydedilemedi.'); });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(RECEIVER_PORT, '0.0.0.0', resolve); });
    receiver = {server, url: `http://${ip}:${RECEIVER_PORT}/?t=${token}`, received: 0};
    return status();
  }

  async function receiverStop() { if (receiver) { receiver.server.close(); receiver = null; } return status(); }

  /* ---- package for another Windows computer ---- */
  async function packageFor() {
    const src = await engineDir();
    const r = await dialog.showOpenDialog(getWindow(), {properties: ['openDirectory', 'createDirectory'], title: 'Kurulum paketinin yazılacağı klasör (USB bellek olabilir)'});
    if (r.canceled || !r.filePaths[0]) return null;
    const target = path.join(r.filePaths[0], 'Yuzuk-motor');
    if (await exists(target)) throw Error('Hedefte zaten bir Yuzuk-motor klasörü var.');
    const skip = new Set(['.venv', 'taslaklar', 'gelen', '__pycache__']);
    send('ring:event', {olay: 'paket', durum: 'basladi'});
    await fs.cp(src, target, {recursive: true, filter: p => !skip.has(path.basename(p)) && !path.basename(p).startsWith('onay_')});
    send('ring:event', {olay: 'paket', durum: 'bitti', hedef: target});
    return {target};
  }

  /* ---- live listening: Laya decides what reaches the LLM; the LLM writes the note at the end ----

    Boran's instruction for 0.23: notes appear in Obsidian without an approval step. The engine
    passes sentences (with their neighbours as context) into a local session file; private and
    out-of-scope sentences never leave it. When listening stops, the session goes to the LLM,
    and its note and reminders are written here with receipts. */
  let live = null;
  const pad = n => String(n).padStart(2, '0');

  async function devices() {
    const dir = await engineDir();
    return new Promise((resolve, reject) => {
      const child = spawn(path.join(dir, '.venv', 'Scripts', 'python.exe'), [path.join(dir, 'canli.py'), '--cihazlar'],
        {cwd: dir, windowsHide: true, env: {...process.env, PYTHONIOENCODING: 'utf-8'}});
      let out = '';
      child.stdout.setEncoding('utf8'); child.stdout.on('data', c => { out += c; });
      child.on('close', code => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { reject(Error(`Mikrofonlar okunamadı (${code}).`)); } });
    });
  }

  // Output devices whose sound can be captured (a Zoom call, a video). Empty when the engine cannot do it.
  async function outputs() {
    const dir = await engineDir();
    return new Promise(resolve => {
      const child = spawn(path.join(dir, '.venv', 'Scripts', 'python.exe'), [path.join(dir, 'canli.py'), '--hoparlorler'],
        {cwd: dir, windowsHide: true, env: {...process.env, PYTHONIOENCODING: 'utf-8'}});
      let out = '';
      child.stdout.setEncoding('utf8'); child.stdout.on('data', c => { out += c; });
      child.on('error', () => resolve([]));
      child.on('close', () => { try { const list = JSON.parse(out.trim().split('\n').pop()); resolve(Array.isArray(list) ? list : []); } catch { resolve([]); } });
    });
  }

  async function finishSession(session, startedAt, counts, meeting = false) {
    if (!counts?.aktarilan) { send('ring:live', {olay: 'sentez', durum: 'bos'}); return null; }
    send('ring:live', {olay: 'sentez', durum: 'basladi', aktarilan: counts.aktarilan + (counts.baglam || 0)});
    try {
      const result = await synthesize(session, null);
      const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
      const written = await writeSynthNote({title: meeting ? 'Toplantı' : 'Canlı dinleme', startedAt, result,
        source: `${mins} dk ${meeting ? 'toplantı kaydı (bilgisayar sesi)' : 'canlı dinleme'} · ${counts.cumle} cümle duyuldu${counts.mahrem ? `, ${counts.mahrem} mahrem çıkarıldı` : ''}${people(result)}`,
        reason: 'Yüzük canlı dinleme oturumu notu'});
      send('ring:live', {olay: 'sentez', durum: 'bitti', not: written.note, hatirlatici: written.reminders.length,
        gereksiz: (result.gereksiz || []).length, maliyet: result.maliyet_usd});
      notify?.('Yüzük', `Not yazıldı: ${written.note.replace(/\.md$/, '')}`);
      return written;
    } catch (e) {
      send('ring:live', {olay: 'sentez', durum: 'hata', mesaj: e.message, oturum: session});
      return null;
    }
  }

  async function liveStart(options = {}) {
    if (live) throw Error('Canlı dinleme zaten açık.');
    if (job) throw Error('Önce işlenen kaydın bitmesini bekle.');
    const dir = await engineDir();
    if (!await exists(path.join(dir, 'canli.py')) || !await exists(path.join(dir, 'sentez.py'))) throw Error('Motor canlı dinlemeyi desteklemiyor; motoru güncelle.');
    const args = [path.join(dir, 'canli.py'), '--json-ilerleme'];
    if (await exists(path.join(dir, 'tamnot.py'))) args.push('--tam');
    const source = ['sistem', 'ikisi'].includes(options.source) ? options.source : 'mikrofon';
    if (source !== 'mikrofon') args.push('--kaynak', source);
    if (source !== 'mikrofon' && typeof options.output === 'string' && options.output && options.output.length < 300 && !/[\r\n\x00]/.test(options.output))
      args.push('--hoparlor', options.output);
    if (source !== 'sistem' && Number.isInteger(options.device)) args.push('--cihaz', String(options.device));
    // Acceptance runs have no microphone: a marked test profile may stream a file as if it were live.
    if (process.env.CLAUDIAN_ACCEPTANCE_ROOT && process.env.CLAUDIAN_RING_TEST_FILE) args.push('--dosya', process.env.CLAUDIAN_RING_TEST_FILE, '--hiz', '4');
    if (options.training === true) {
      await fs.mkdir(path.join(dir, 'egitim'), {recursive: true});
      args.push('--egitim', path.join(dir, 'egitim', `canli_${new Date().toISOString().slice(0, 10)}.jsonl`));
    }
    const child = spawn(path.join(dir, '.venv', 'Scripts', 'python.exe'), args, {cwd: dir, windowsHide: true,
      env: {...process.env, USE_TF: '0', HF_HUB_OFFLINE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1'}});
    live = {child, meeting: source !== 'mikrofon', startedAt: Date.now(), session: null, counts: null, passed: 0, model: null, stderr: '', last: []};
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
        if (!line.startsWith('@@')) continue;
        let ev; try { ev = JSON.parse(line.slice(2)); } catch { continue; }
        if (ev.olay === 'hazir') { live.model = ev.model; live.session = ev.oturum; }
        if (ev.olay === 'aktar') live.passed += 1;
        if (ev.olay === 'ozet') { live.counts = ev; live.session = ev.oturum || live.session; }
        if (ev.olay === 'karar') { live.last.push(ev); live.last = live.last.slice(-40); }
        send('ring:live', ev);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', c => { if (live) live.stderr = (live.stderr + c).slice(-4000); });
    child.on('close', async code => {
      const l = live; live = null;
      const tail = l?.stderr.split('\n').filter(x => x.trim() && !/warn/i.test(x)).slice(-3).join('\n');
      send('ring:live', {olay: 'kapandi', kod: code, aktarilan: l?.passed || 0,
        mesaj: code && code !== 0 ? (tail || `Motor ${code} koduyla kapandı.`) : null});
      if (l?.session) await finishSession(l.session, l.startedAt, l.counts || {aktarilan: l.passed, cumle: l.passed}, l.meeting);
    });
    return true;
  }

  async function liveStop() {
    if (!live) return false;
    const child = live.child;
    try { child.stdin.write('dur\n'); } catch {}
    setTimeout(() => { if (!child.killed && child.exitCode === null) child.kill(); }, 15000);
    return true;
  }

  function liveStatus() {
    return live ? {startedAt: live.startedAt, passed: live.passed, model: live.model, last: live.last.slice(-12)} : null;
  }


  /* ---- phone app (Yüzük for Android) ----
     The phone does not talk to this window. It talks to the engine's own server (sunucu.py), which the
     tunnel publishes at PHONE_ORIGIN; recordings are processed there and the note is written into the
     phone's Obsidian vault. This card only shows whether that server is up, starts it, and mints the
     one-time pairing code — the long server key never appears on screen. */
  const PHONE_ORIGIN = 'https://yuzuk.claudian.app';
  const PHONE_PORT = 3050;

  // Bulut katmanı (24.09.2026): motor klasöründe bulut.json varsa telefon buluta (yuzuk-api.claudian.app)
  // bağlanır; bu bilgisayar oradan iş alan bir "işlem düğümü" olur. Kod da buluttan gelir.
  async function phoneOrigin() {
    try {
      const b = JSON.parse(await fs.readFile(path.join(await engineDir(), 'bulut.json'), 'utf8'));
      if (/^https:\/\//.test(b.url || '')) return {origin: b.url.replace(/\/+$/, ''), cloud: true};
    } catch {}
    return {origin: PHONE_ORIGIN, cloud: false};
  }

  async function phoneKey() {
    try { return (await fs.readFile(path.join(await engineDir(), 'sunucu_anahtar.txt'), 'utf8')).trim() || null; } catch { return null; }
  }

  async function phoneStatus() {
    const dir = await engineDir();
    if (!await exists(path.join(dir, 'sunucu.py'))) return {capable: false};
    const key = await phoneKey();
    let health = null;
    if (key) {
      health = await fetch(`http://127.0.0.1:${PHONE_PORT}/v1/saglik`, {headers: {authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(3000)})
        .then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    const {origin, cloud} = await phoneOrigin();
    return {capable: true, running: !!health, model: health?.laya || null, queued: health?.sirada ?? 0, origin, cloud,
      speakers: !!health?.konusmaci, voiceprint: !!health?.profil};
  }

  async function phoneStart() {
    const dir = await engineDir();
    const script = path.join(dir, 'baslat.ps1');
    if (!await exists(script)) throw Error('Motor klasöründe baslat.ps1 yok; motoru güncelle.');
    // baslat.ps1 starts the server and the tunnel detached from this app, and skips whichever already runs.
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {cwd: dir, windowsHide: true, detached: true, stdio: 'ignore'}).unref();
    for (let i = 0; i < 40; i++) {
      const s = await phoneStatus();
      if (s.running) return s;
      await new Promise(r => setTimeout(r, 500));
    }
    return phoneStatus();
  }

  async function phonePair() {
    const dir = await engineDir();
    const python = path.join(dir, '.venv', 'Scripts', 'python.exe');
    const code = await new Promise((resolve, reject) => {
      const child = spawn(python, ['sunucu.py', '--eslestirme-kodu'], {cwd: dir, windowsHide: true, env: {...process.env, PYTHONIOENCODING: 'utf-8'}});
      let out = '';
      child.stdout.on('data', c => { out += c; });
      child.on('error', reject);
      child.on('close', c => (c === 0 ? resolve(out.trim().split(/\s+/).pop()) : reject(Error(`Eşleştirme kodu üretilemedi (${c}).`))));
    });
    if (!/^[A-Z0-9]{8}$/.test(code || '')) throw Error('Motor geçerli bir eşleştirme kodu döndürmedi.');
    const url = `${(await phoneOrigin()).origin}/kur#${code}`;
    const qr = await require('qrcode').toString(url, {type: 'svg', margin: 1, errorCorrectionLevel: 'M'});
    return {code: `${code.slice(0, 4)}-${code.slice(4)}`, url, qr};
  }

  /* ---- sesini tanıt (masaüstü) ----
     Kullanıcı 25 sn kadar sesli okur; motor mikrofondan okur, yalnız bellekte tutar, ses izini çıkarır
     (profiller/varsayilan.json). Telefonda tanıtılan ses de aynı dosyadır; ikisi de notlarda "Sen"i ayırır. */
  let voiceJob = null;

  async function voiceFile() { return path.join(await engineDir(), 'profiller', 'varsayilan.json'); }

  async function voiceStatus() {
    try {
      const p = JSON.parse(await fs.readFile(await voiceFile(), 'utf8'));
      return {enrolled: true, created: p.olusturuldu, seconds: p.konusma_sn, consistency: p.tutarlilik, running: !!voiceJob};
    } catch { return {enrolled: false, running: !!voiceJob}; }
  }

  async function voiceEnroll(options = {}) {
    if (voiceJob) throw Error('Ses tanıtma zaten sürüyor.');
    if (live) throw Error('Canlı dinleme sürerken ses tanıtılamaz; önce dinlemeyi durdur.');
    const dir = await engineDir();
    if (!await exists(path.join(dir, 'konusmaci.py'))) throw Error('Motor konuşmacı ayrımını içermiyor; motoru güncelle.');
    const target = await voiceFile();
    await fs.mkdir(path.dirname(target), {recursive: true});
    const seconds = Math.min(40, Math.max(15, Number(options.seconds) || 25));
    const args = [path.join(dir, 'konusmaci.py'), '--mikrofon', String(seconds), '--json-ilerleme', '--profil-cikar', target];
    if (Number.isInteger(options.device)) args.push('--cihaz', String(options.device));
    const python = path.join(dir, '.venv', 'Scripts', 'python.exe');
    const child = spawn(python, args, {cwd: dir, windowsHide: true, env: {...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1'}});
    voiceJob = {child};
    let buf = '';
    child.stdout.on('data', c => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('@@')) continue;
        try { send('ring:voice', JSON.parse(line.slice(2))); } catch {}
      }
    });
    child.on('close', code => { voiceJob = null; send('ring:voice', {olay: 'kapandi', kod: code}); });
    return {started: true, seconds};
  }

  async function voiceDelete() {
    await fs.rm(await voiceFile(), {force: true});
    return voiceStatus();
  }

  /* Bulut üzerinden canlı görünüm: bu bilgisayara bağlı telefonlar ve son işler (içerik değil). */
  async function phoneLive() {
    const {origin, cloud} = await phoneOrigin();
    const key = await phoneKey();
    if (!cloud || !key) return null;
    return fetch(`${origin}/v1/dugum/durum`, {headers: {authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(5000)})
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
  }

  function shutdown() { cancel(); if (live) live.child.kill(); if (voiceJob) voiceJob.child.kill(); if (receiver) receiver.server.close(); }

  return {status, chooseEngine, chooseAudio, run, cancel, drafts, draft, approve, discard, receiverStart, receiverStop, packageFor,
    devices, outputs, liveStart, liveStop, liveStatus, finishSession, shutdown, engineDir, phoneStatus, phoneStart, phonePair, writers, setWriter,
    voiceStatus, voiceEnroll, voiceDelete, phoneLive};
}

module.exports = {createRing, draftDir};
