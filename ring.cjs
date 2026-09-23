'use strict';
/*
  Yüzük — the note-taking ring's software side, run on this computer.

  The engine is not bundled: it is a Python folder (Whisper + Laya, ~3 GB of models) that the
  person installs once. This module only finds it, runs it, and turns its drafts into memory.

  Two rules hold everywhere below:
  - Nothing reaches the memory without an explicit approval. A draft is a file in the engine's
    `taslaklar/` folder until the person approves it; approval is the only writer.
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
const KINDS = {
  odev: ['Ödev ve teslimler', 'Assignments and deadlines'],
  sinav: ['Sınav vurguları', 'Exam emphasis'],
  hazirlik: ['Hazırlık', 'Preparation'],
  karar: ['Kararlar, planlar ve sözler', 'Decisions, plans and promises'],
  tanim: ['İçerik ve tanımlar', 'Content and definitions'],
  gurultu: ['Diğer', 'Other'],
};

function defaultEngine() { return path.join(os.homedir(), 'Desktop', 'Yuzuk', 'laya-kapi'); }

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

function draftDir(engine, id) {
  if (typeof id !== 'string' || !DRAFT_ID.test(id) || id.includes('..')) throw Error('Geçersiz taslak.');
  return path.join(engine, 'taslaklar', id);
}

// "2026-09-23T10:30" → "23.09.2026"
const dotted = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/* The session note: one per recording, built only from what the person kept. */
function sessionNote(draft, keptNos, language = 'tr') {
  const tr = language !== 'en';
  const kept = draft.kayitlar.filter(k => keptNos.has(k.no) && k.metin);
  const lines = ['---', 'tags: [yüzük]', tr ? 'tür: log' : 'type: log',
    `${tr ? 'güncellenme' : 'updated'}: ${new Date().toISOString().slice(0, 10)}`, '---', '',
    `# ${clean(draft.baslik)}`, '',
    `${dotted(draft.baslangic)} ${String(draft.baslangic).slice(11, 16)} · ${Math.round(draft.ses_suresi_sn / 60)} ${tr ? 'dk kayıt' : 'min recording'} · ${kept.length} ${tr ? 'madde' : 'items'}`, ''];
  for (const [kind, [trName, enName]] of Object.entries(KINDS)) {
    const group = kept.filter(k => k.tur === kind);
    if (!group.length) continue;
    lines.push(`## ${tr ? trName : enName}`, '');
    for (const k of group) lines.push(`- ${clean(k.metin)} \`${k.saat}\``);
    lines.push('');
  }
  lines.push('---', tr
    ? `_Yüzük ile bu bilgisayarda çıkarıldı (Whisper + ${draft.kapi_model || 'Laya'}), onaylanarak yazıldı. Kaynak: \`${clean(draft.kaynak)}\`._`
    : `_Extracted on this computer by Yüzük (Whisper + ${draft.kapi_model || 'Laya'}) and written on approval. Source: \`${clean(draft.kaynak)}\`._`, '');
  return lines.join('\n');
}

function noteName(draft) {
  const title = clean(draft.baslik).replace(/[\\/:*?"<>|#^[\]]+/g, '-').slice(0, 60) || 'Kayıt';
  return `Yüzük · ${String(draft.baslangic).slice(0, 10)} ${title}.md`;
}

function createRing({core, send, dialog, getWindow, notify}) {
  let engine = null, job = null, receiver = null;
  const settingsFile = () => path.join(core.dataDir, 'ring.json');

  async function engineDir() {
    if (engine) return engine;
    try { engine = JSON.parse(await fs.readFile(settingsFile(), 'utf8')).engine || null; } catch {}
    return engine ||= defaultEngine();
  }

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
    const args = [path.join(dir, 'notcikar.py'), file, '--json-ilerleme'];
    if (clean(input.title)) args.push('--baslik', clean(input.title).slice(0, 80));
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input.start || '')) args.push('--baslangic', input.start);
    if (input.language === 'tr' || input.language === 'en') args.push('--dil', input.language);
    if (input.audit === true) args.push('--denetim');
    const child = spawn(path.join(dir, '.venv', 'Scripts', 'python.exe'), args, {cwd: dir, windowsHide: true,
      env: {...process.env, USE_TF: '0', HF_HUB_OFFLINE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1'}});
    job = {child, file: path.basename(file), events: [], stderr: ''};
    const emit = event => { job?.events.push(event); send('ring:event', event); };
    emit({olay: 'basladi', dosya: path.basename(file)});
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
        if (line.startsWith('@@')) { try { emit(JSON.parse(line.slice(2))); } catch {} }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', c => { if (job) job.stderr = (job.stderr + c).slice(-4000); });
    child.on('close', code => {
      const finished = job?.events.find(e => e.olay === 'bitti');
      const tail = job?.stderr.split('\n').filter(l => l.trim() && !/warn/i.test(l)).slice(-3).join('\n');
      if (!finished) emit({olay: 'hata', kod: code, mesaj: code === null ? 'Durduruldu.' : (tail || `Motor ${code} koduyla kapandı.`)});
      job = null;
      if (finished) notify?.('Yüzük', `${finished.tutulan} madde çıkarıldı — taslak onay bekliyor.`);
      send('ring:event', {olay: 'kapandi'});
    });
    return true;
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
    Approval is the only writer. It creates one session note from the sentences the person kept,
    adds each confirmed date to reminders through the same guarded capture every AI uses, and
    records the person's corrections as training data for the next Laya fine-tune.
  */
  async function approve(id, choice) {
    const dir = await engineDir();
    const d = await draft(id);
    if (d.durum === 'onaylandi') throw Error('Bu taslak zaten onaylandı.');
    const profile = (await core.snapshot()).profile;
    if (!profile?.vault) throw Error('Hafıza klasörü kurulu değil.');
    const kept = new Set((choice?.kept || []).filter(n => Number.isInteger(n)));
    if (!kept.size) throw Error('Onaylanacak madde seçilmedi.');
    const language = profile.language === 'en' ? 'en' : 'tr';
    const note = noteName(d);
    const receipts = [];
    const created = await store.mutate(profile.vault, {note, operation: 'create', body: sessionNote(d, kept, language),
      reason: `Yüzük taslağı onaylandı: ${clean(d.baslik)}`}, 'yuzuk');
    receipts.push(created.id);
    const reminders = [];
    for (const r of choice?.reminders || []) {
      const k = d.kayitlar.find(x => x.no === r.no);
      if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) continue;
      const text = clean(r.text || k.metin).slice(0, 380);
      const res = await capture(profile.vault, {kind: 'commitment', text, date: r.date, source: 'user_statement',
        reference: note.replace(/\.md$/, '').slice(0, 200), reason: 'Yüzük taslağından onaylanan tarih'}, 'yuzuk', language);
      reminders.push({text, date: r.date, status: res.status});
      if (res.receipt) receipts.push(res.receipt);
    }
    // Corrections become training data. Only sentences whose text exists are usable: without
    // audit mode the dropped sentences were never stored, so only false keeps can be taught.
    const feedback = d.kayitlar.filter(k => k.metin).map(k => ({metin: k.metin, tut: kept.has(k.no),
      tur: kept.has(k.no) ? (k.tur === 'gurultu' ? 'tanim' : k.tur) : 'gurultu', model_tut: k.tut,
      bolum: 'egitim', kaynak: `onay: ${clean(d.baslik)} (${String(d.baslangic).slice(0, 10)})`}));
    const changed = feedback.filter(f => f.tut !== f.model_tut).length;
    await fs.mkdir(path.join(dir, 'egitim'), {recursive: true});
    await fs.appendFile(path.join(dir, 'egitim', 'onay_geri_bildirim.jsonl'),
      feedback.map(f => JSON.stringify(f)).join('\n') + '\n', 'utf8');
    Object.assign(d, {durum: 'onaylandi', not: note, onay: {at: new Date().toISOString(), kept: [...kept], reminders, receipts, corrected: changed}});
    await fs.writeFile(path.join(draftDir(dir, id), 'kararlar.json'), JSON.stringify(d, null, 1), 'utf8');
    return {note, reminders, receipts, corrected: changed};
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

  function shutdown() { cancel(); if (receiver) receiver.server.close(); }

  return {status, chooseEngine, chooseAudio, run, cancel, drafts, draft, approve, discard, receiverStart, receiverStop, packageFor, shutdown, engineDir};
}

module.exports = {createRing, sessionNote, noteName, draftDir};
