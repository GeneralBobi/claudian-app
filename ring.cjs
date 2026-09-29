'use strict';
/*
  Yüzük — the note-taking ring's software side, run on this computer.

  The engine is a Python folder (Whisper speech-to-text, speaker embeddings, privacy rules) that runs
  on this computer. This module finds it, runs it, and turns its results into memory.

  Rules that hold below:
  - Audio stays on this computer and is discarded once transcribed. The transcript, minus what the
    engine's privacy rules remove, goes to the note writer the person chose (Claude, ChatGPT or Gemini);
    that is the only thing that leaves.
  - Phone recordings arrive as text through the cloud relay (27.09.2026: no audio file on the phone).
    There is no local-network receiver any more.
  - Every write to the vault goes through the receipt path.
*/
const fs = require('fs/promises');
const fss = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {spawn} = require('child_process');
const store = require('./memory-store.cjs');
const {capture} = require('./memory-capture.cjs');
const roles = require('./roles.cjs');
const {frontmatterLine, contextLine, addRecordRow, linkReminder, dayLabel} = require('./ring-context.cjs');
const {closeDue, applyAction} = require('./reminder-sweep.cjs');

const AUDIO = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'webm', 'aac', 'mp4'];
const DRAFT_ID = /^[\w.\-]{1,120}$/u;

// 1.1.0: the installer puts the engine in the user's own app-data folder. The folder an engine was set up in by hand
// before 1.1.0 (Boran's) is still found if it exists; no other computer is assumed to have it (Hanne's 0.30.0 showed
// C:\Users\Hanne\Desktop\Yuzuk\laya-kapi, a folder that never existed there).
const {defaultTarget} = require('./ring-install.cjs');
const LEGACY_ENGINE = path.join(os.homedir(), 'Desktop', 'Yuzuk', 'laya-kapi');
function defaultEngine() {
  const installed = defaultTarget();
  if (fss.existsSync(path.join(installed, 'sunucu.py'))) return installed;
  if (fss.existsSync(path.join(LEGACY_ENGINE, 'sunucu.py'))) return LEGACY_ENGINE;
  return installed;
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

function draftDir(engine, id) {
  if (typeof id !== 'string' || !DRAFT_ID.test(id) || id.includes('..')) throw Error('Geçersiz taslak.');
  return path.join(engine, 'taslaklar', id);
}

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();


function createRing({core, send, dialog, getWindow, notify, synth}) {
  let engine = null, job = null;
  const settingsFile = () => path.join(core.dataDir, 'ring.json');

  async function engineDir() {
    if (engine) return engine;
    try { engine = JSON.parse(await fs.readFile(settingsFile(), 'utf8')).engine || null; } catch {}
    return engine ||= defaultEngine();
  }

  /* ---- note writer (1.0.0, madde 10 ve 14) ----
     The transcript is untrusted: anyone near the ring can speak into it. So the note is no longer written by an agent CLI
     (Claude Code, Codex, Gemini: each carries shell, file, browser and MCP tools, and Codex and Gemini have no single
     documented switch that closes all of them). It is written by a tool-less API call that only the Claudian cloud makes,
     with Boran's key kept there; the engine validates the structured answer and writes the markdown itself.
     1.5.0: ChatGPT is back as a writer (Boran: "bu özelliği elimden alma"). Codex runs on this computer with the user's
     own ChatGPT sign-in and every tool switched off one by one (laya-kapi/yazicilar.py); it is as tool-less as the cloud
     writer.
     1.6.0: Gemini is a writer too, through the Antigravity CLI (agy) and the user's own Google sign-in (Google closed
     the Gemini CLI to personal accounts). agy runs in a throwaway home with a PreToolUse hook that denies every tool,
     web search included (laya-kapi/yazicilar.py). */
  const WRITERS = {claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini'};
  const RETIRED_WRITERS = {};

  async function settings() {
    try { return JSON.parse(await fs.readFile(settingsFile(), 'utf8')); } catch { return {}; }
  }

  // The cloud writer needs this computer to be a node of the Claudian cloud (bulut.json in the engine).
  async function writerInstalled(id) {
    if (id === 'claude') return exists(path.join(await engineDir(), 'bulut.json'));
    if (id === 'gemini') {
      // 1.6.0 engine and up: its writer module knows agy.
      const mod = await fs.readFile(path.join(await engineDir(), 'yazicilar.py'), 'utf8').catch(() => '');
      const agy = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe');
      return mod.includes('agy_yolu') && exists(agy);
    }
    if (id !== 'codex' || !await exists(path.join(await engineDir(), 'baglam.py'))) return false; // 1.5.0 engine and up
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const cli = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'codex.cmd');
    return await exists(path.join(home, 'auth.json')) && await exists(cli);
  }

  // Test phase: a newly installed computer waits for approval before the cloud writes notes for it (1.1.0).
  async function nodeApproval() {
    try { return JSON.parse(await fs.readFile(path.join(await engineDir(), 'bulut_hesap.json'), 'utf8')).onay || null; } catch { return null; }
  }

  async function writers() {
    const list = [];
    for (const [id, name] of Object.entries(WRITERS)) list.push({id, name, installed: await writerInstalled(id)});
    const saved = (await settings()).yazici;
    const chosen = list.find(w => w.id === saved && w.installed) ? saved : 'claude';
    return {chosen, list, approval: await nodeApproval()};
  }

  async function setWriter(id) {
    if (RETIRED_WRITERS[id]) throw Error(`${RETIRED_WRITERS[id]} not yazıcısı kapalı.`);
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
      writers: await writers()};
  }

  // An engine that is already on this computer (copied from another one, or set up by hand). Installing is the other
  // button: this one only points Yüzük at a folder and says plainly when the folder is not an engine.
  /* 1.5.0: a chosen folder is either a working engine (used as is) or a source to install from: the package written by
     "Kurulum paketini hazırla", a USB drive, or a hand-copied engine without its Python environment (Hanne's 0.30.0).
     In the second case the installer runs into the user's own folder and takes every verified file it finds there.
     The folder stays on this side: the panel only says "install from the chosen folder", never names a path. */
  let chosenSource = null;
  async function chooseEngine() {
    const r = await dialog.showOpenDialog(getWindow(), {properties: ['openDirectory'], title: 'Yüzük klasörü (kurulum paketi ya da motor)'});
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    if (await exists(path.join(dir, 'sunucu.py')) && await exists(path.join(dir, '.venv', 'Scripts', 'python.exe'))) {
      await setEngine(dir);
      return {engine: true, status: await status()};
    }
    chosenSource = dir;
    return {source: true, name: path.basename(dir)};
  }
  function takeSource() { const s = chosenSource; chosenSource = null; return s; }

  async function setEngine(dir) {
    engine = dir;
    await fs.mkdir(core.dataDir, {recursive: true});
    await fs.writeFile(settingsFile(), JSON.stringify({...await settings(), engine: dir}, null, 2));
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
    if (full) args.push(...await contextArgs(dir));
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
      // The engine names why a note could not be written (approval, quota, spending limit, malformed answer) in its own
      // 'hata' event; that sentence is shown once, not buried under a stack tail.
      const said = job?.events.find(e => e.olay === 'hata' && e.mesaj);
      if (!finished && !said) emit({olay: 'hata', kod: code, mesaj: code === null ? 'Durduruldu.' : (tail || `Motor ${code} koduyla kapandı.`)});
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
  /* Context (1.5.0): a recording made on this computer is its owner's, so the engine may match its time against the
     owner's own vault (courses, events, appointments). Engines before 1.5.0 do not know the flag. */
  async function contextArgs(dir) {
    if (!await exists(path.join(dir, 'baglam.py'))) return [];
    const vault = (await core.snapshot()).profile?.vault;
    return vault && await exists(vault) ? ['--baglam-vault', vault] : [];
  }

  async function synthesize(sessionFile, title) {
    if (synth) return synth(sessionFile, title);
    const dir = await engineDir();
    const full = await exists(path.join(dir, 'tamnot.py'));
    const args = full ? [path.join(dir, 'sentez.py'), sessionFile, '--tam', '--yazici', await writer()]
      : [path.join(dir, 'sentez.py'), sessionFile, '--etiket'];
    if (clean(title)) args.push('--baslik', clean(title).slice(0, 120));
    if (full) args.push(...await contextArgs(dir));
    return new Promise((resolve, reject) => {
      const child = spawn(path.join(dir, '.venv', 'Scripts', 'python.exe'), args, {cwd: dir, windowsHide: true,
        env: {...process.env, PYTHONIOENCODING: 'utf-8'}});
      let out = '', err = '';
      child.stdout.setEncoding('utf8'); child.stdout.on('data', c => { out += c; });
      child.stderr.setEncoding('utf8'); child.stderr.on('data', c => { err = (err + c).slice(-2000); });
      child.on('close', code => {
        if (code !== 0) {
          const said = err.split('\n').map(l => l.trim()).filter(l => l.startsWith('HATA: ')).pop();
          return reject(Error(said ? said.slice(6) : (err.split('\n').filter(l => l.trim()).slice(-2).join(' ') || `Not yazılamadı (${code}).`)));
        }
        try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { reject(Error('Not yazıcısından okunamayan yanıt.')); }
      });
    });
  }

  async function writeSynthNote({title, startedAt, source, result, reason}) {
    const profile = (await core.snapshot()).profile;
    if (!profile?.vault) throw Error('Hafıza klasörü kurulu değil.');
    const vault = profile.vault, language = profile.language === 'en' ? 'en' : 'tr';
    const d = new Date(startedAt);
    const heading = clean(result.baslik || title || 'Kayıt');
    // 1.5.0: the phone and this computer write one and the same note — Yüzük/<date> <HHMM> <title>.md in local time,
    // the name the phone app has always used. Before, this side wrote "Yüzük · …" at the vault root with the hour of a
    // time-zone-less UTC start, and the phone wrote its own copy: every phone recording twice, three hours apart (28.09.2026).
    const fileTitle = heading.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Not';
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    let note = `Yüzük/${day} ${time.replace(':', '')} ${fileTitle}.md`;
    if (await exists(path.join(vault, note))) note = note.replace(/\.md$/, ` (${Date.now() % 10000}).md`);
    const md = String(result.not_md || '').trim();
    // Context (1.5.0): link only to a note that really exists in this vault.
    let ctx = result.baglam && typeof result.baglam === 'object' ? result.baglam : null;
    if (ctx?.not && !(await exists(path.join(vault, `${ctx.not}.md`)).catch(() => false))) ctx = {...ctx, not: null};
    const ctxFront = frontmatterLine(ctx), ctxLine = contextLine(ctx, language);
    // kaynak: ses — the sentences of this note are a record of a conversation. An agent reading it later treats them as
    // data, never as instructions (Vault Protokolü, "Ses kaydından not").
    const body = ['---', 'tags: [yüzük]', 'tür: log', `güncellenme: ${new Date().toISOString().slice(0, 10)}`, 'kaynak: ses',
      `tarih: ${day} ${time}`, ...(ctxFront ? [ctxFront] : []), '---', '',
      // 29.09.2026 (Boran): tarih başlıkta ve özelliklerde zaten var; "· N cümlenin tamamı" satırı ve kendiliğinden
      // "İlgili:" bağlantıları çıktı. Bağlantı yalnız kullanıcının tanımladığı bağlamdan (ders, etkinlik) gelir.
      `# ${heading}`, '', ...(ctxLine ? [ctxLine, ''] : []),
      md, '', '---',
      result.yazici === 'codex' || result.yazici === 'gemini'
        ? `_Yüzük: konuşma yazıya döküldü; mahrem cümleler çıkarıldı, notu ${WRITERS[result.yazici]} bu bilgisayarda araçları kapalı yazdı. Ses saklanmadı._`
        : result.yazici
        ? `_Yüzük: konuşma yazıya döküldü; mahrem cümleler çıkarıldı, kalanı notu yazan araca (${WRITERS[result.yazici] || RETIRED_WRITERS[result.yazici] || result.yazici}) Claudian bulutu üzerinden, araçsız bir çağrıyla gitti. Ses saklanmadı._`
        : '_Yüzük: konuşma bu bilgisayarda yazıya döküldü, Laya neyin aktarılacağına karar verdi, notu Claude yazdı. Mahrem ve kapsam dışı cümleler gönderilmedi; ses saklanmadı._', ''].join('\n');
    const receipts = [(await store.mutate(vault, {note, operation: 'create', body, reason}, 'yuzuk')).id];
    // The course or event note lists its recordings; a reminder points to the recording of its meeting.
    const recorded = note.replace(/\.md$/, '').split('/').pop();
    try {
      if (ctx?.not && ['ders', 'etkinlik'].includes(ctx.tur)) {
        const cur = await store.read(vault, `${ctx.not}.md`);
        const after = addRecordRow(cur.body, {date: dayLabel(d), time, heading, link: recorded});
        if (after) receipts.push((await store.mutate(vault, {note: `${ctx.not}.md`, operation: 'patch', expected_sha256: cur.sha256,
          old_text: cur.body, new_text: after, reason: `Yüzük kaydı bu ${ctx.tur === 'ders' ? 'derse' : 'etkinliğe'} bağlandı`}, 'yuzuk')).id);
      } else if (ctx?.tur === 'hatirlatici') {
        const reminderNote = (await roles.resolve(vault)).roles.reminders;
        if (reminderNote) {
          const cur = await store.read(vault, reminderNote);
          const after = linkReminder(cur.body, ctx.ad, recorded);
          if (after) receipts.push((await store.mutate(vault, {note: reminderNote, operation: 'patch', expected_sha256: cur.sha256,
            old_text: cur.body, new_text: after, reason: 'Randevunun Yüzük kaydı bağlandı'}, 'yuzuk')).id);
        }
      }
    } catch {
      // Linking is a courtesy: a busy or changed note never costs the recording its note.
    }
    const reminders = [];
    for (const h of result.hatirlaticilar || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(h.tarih || '') || !clean(h.metin)) continue;
      // The hour rides in the text: the reminders note has no time field, and the phone and the
      // calendar feed read it back from " · saat SS:DD".
      const hour = /^\d{2}:\d{2}$/.test(h.saat || '') ? ` · saat ${h.saat}` : '';
      const c = await capture(vault, {kind: 'commitment', text: (clean(h.metin).slice(0, 360) + hour), date: h.tarih, source: 'user_statement',
        reference: note.replace(/\.md$/, '').slice(0, 200), reason: 'Yüzük notundaki tarihli iş'}, 'yuzuk', language);
      reminders.push({text: clean(h.metin), date: h.tarih, time: h.saat || null, status: c.status});
      if (c.receipt) receipts.push(c.receipt);
    }
    /* Undated obligations (an assignment with no date yet, a plan to make) go to the open-loop panel.
       Before 0.29 they stayed inside the note, where a reader skipping for tokens could miss them
       (Boran, 26.09.2026). The writer returns them as their own list; nothing here reads the prose. */
    const followUps = [];
    for (const t of result.takip || []) {
      if (!clean(t)) continue;
      const c = await capture(vault, {kind: 'open_loop', text: clean(t).slice(0, 380), source: 'user_statement',
        reference: note.replace(/\.md$/, '').slice(0, 200), reason: 'Yüzük notundaki tarihsiz iş'}, 'yuzuk', language);
      followUps.push({text: clean(t), status: c.status});
      if (c.receipt) receipts.push(c.receipt);
    }
    return {note, receipts, reminders, followUps};
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

  /* Wi-Fi receiver removed (legal & security scan 27.09.2026, P2): it had the phone browser record an audio file
     and carried it over the local network without encryption. The Yüzük app does the same with no audio file,
     over TLS through the cloud to this computer's node. */

  /* ---- package for another Windows computer ---- */
  // Only when this computer has a working engine (1.1.0): Hanne's 0.30.0 offered it without one, resolved the target
  // to the app's install folder (EPERM in Program Files) and left an empty Yuzuk-motor in Downloads.
  /* "Kurulum paketini hazırla" (1.5.0): a self-contained install folder for another computer (ring-package.cjs).
     Keys, voiceprints, the cloud link and the vault never enter it. */
  let packaging = null;
  async function packageFor({fetch, version} = {}) {
    if (packaging) throw Error('Paket zaten hazırlanıyor.');
    const r = await dialog.showOpenDialog(getWindow(), {properties: ['openDirectory', 'createDirectory'], title: 'Paketin yazılacağı klasör (USB bellek olabilir)',
      defaultPath: path.join(os.homedir(), 'Desktop')});
    if (r.canceled || !r.filePaths[0]) return null;
    const {forbiddenTarget} = require('./ring-install.cjs');
    const why = forbiddenTarget(r.filePaths[0]);
    if (why) throw Error(why);
    send('ring:event', {olay: 'paket', durum: 'basladi'});
    packaging = new AbortController();
    try {
      const here = (await status()).ready ? await engineDir() : null;
      return await require('./ring-package.cjs').writePackage({folder: r.filePaths[0], version, fetch, engineDir: here, send, signal: packaging.signal});
    } catch (e) {
      send('ring:event', {olay: 'paket', durum: 'hata', mesaj: e.code === 'EPERM' || e.code === 'EACCES' ? 'Bu klasöre yazma izni yok.' : e.message});
      throw e;
    } finally { packaging = null; }
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
      speakers: !!health?.konusmaci, voiceprint: !!health?.profil, approval: cloud ? await nodeApproval() : null};
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

  /* ---- phone inbox: notes the phone recorded reach this vault too (0.29) ----

    The phone server (sunucu.py) writes the note, but before 0.29 only the phone kept it: the
    computer's vault, the reminders note and the panel never saw a phone recording. The server now
    drops each finished result into `gelen_not/<id>.json`; this side writes it through the same path
    as a desktop recording (receipts, reminders, open loops) and answers with `<id>.sonuc.json`, so
    the server can tell the phone where the note lives. The input is deleted once written: the note
    text stays only in the vault. Ids come from the server's own uuid and are checked here. */
  const INBOX_ID = /^[a-f0-9]{32}$/;
  let inboxTimer = null, inboxBusy = false;

  async function inboxOnce() {
    if (inboxBusy) return 0;
    inboxBusy = true;
    let done = 0;
    try {
      const dir = path.join(await engineDir(), 'gelen_not');
      const names = await fs.readdir(dir).catch(() => []);
      for (const name of names) {
        const id = name.replace(/\.json$/, '');
        if (!name.endsWith('.json') || !INBOX_ID.test(id)) continue;
        const file = path.join(dir, name), answer = path.join(dir, `${id}.sonuc.json`);
        let item;
        try { item = JSON.parse(await fs.readFile(file, 'utf8')); } catch { continue; }
        try {
          const result = item.sonuc || {};
          if (!String(result.not_md || '').trim()) throw Error('Boş not.');
          const mins = Math.max(1, Math.round((result.ses_suresi_sn || 0) / 60));
          const written = await writeSynthNote({title: item.baslik || result.baslik, startedAt: item.baslangic || new Date().toISOString(), result,
            source: `${mins} dk telefon kaydı · ${result.cumle || 0} cümlenin tamamı${result.mahrem ? ` (${result.mahrem} mahrem çıkarıldı)` : ''}${people(result)}`,
            reason: `Telefondan gelen Yüzük kaydı: ${clean(item.baslik || result.baslik)}`});
          await fs.writeFile(answer, JSON.stringify({not: written.note, hatirlatici: written.reminders.length, takip: written.followUps.length}), 'utf8');
          notify?.('Yüzük', `Telefondan not yazıldı: ${written.note.replace(/\.md$/, '')}`);
          done++;
        } catch (e) {
          await fs.writeFile(answer, JSON.stringify({hata: e.message}), 'utf8').catch(() => {});
        }
        await fs.rm(file, {force: true});
      }
    } finally { inboxBusy = false; }
    return done;
  }

  /* Reminders whose time has passed are marked as reminded (1.5.0, reminder-sweep.cjs). Runs with the inbox, at most
     once a minute; writes only when something changed, through the same receipted store. */
  let sweptAt = 0;
  async function reminderSweep(now = new Date()) {
    const profile = (await core.snapshot()).profile;
    if (!profile?.vault) return [];
    const note = (await roles.resolve(profile.vault)).roles.reminders;
    if (!note) return [];
    const cur = await store.read(profile.vault, note);
    const {body, closed} = closeDue(cur.body, now, profile.language === 'en' ? 'en' : 'tr');
    if (!closed.length) return [];
    await store.mutate(profile.vault, {note, operation: 'patch', expected_sha256: cur.sha256, old_text: cur.body, new_text: body,
      reason: `Vakti geçen hatırlatıcı kapandı: ${closed.slice(0, 3).join(' · ').slice(0, 300)}`}, 'yuzuk');
    return closed;
  }

  /* Phone notification buttons (1.5.0): "Yaptım" closes the reminder, "Yarın tekrar" moves it to tomorrow. The server
     (sunucu.py) checks the owner and that the item is still open, drops the request into gelen_islem/, and waits for the
     answer; the line is written here, receipted like every other memory write. */
  let actionsBusy = false;
  async function actionsOnce(now = new Date()) {
    if (actionsBusy) return 0;
    actionsBusy = true;
    let done = 0;
    try {
      const dir = path.join(await engineDir(), 'gelen_islem');
      for (const name of await fs.readdir(dir).catch(() => [])) {
        const id = name.replace(/\.json$/, '');
        if (!name.endsWith('.json') || !INBOX_ID.test(id)) continue;
        const file = path.join(dir, name), answer = path.join(dir, `${id}.sonuc.json`);
        let item;
        try { item = JSON.parse(await fs.readFile(file, 'utf8')); } catch { continue; }
        try {
          const profile = (await core.snapshot()).profile;
          if (!profile?.vault) throw Error('Hafıza klasörü kurulu değil.');
          const note = (await roles.resolve(profile.vault)).roles.reminders;
          if (!note) throw Error('Hatırlatıcılar notu bulunamadı.');
          const cur = await store.read(profile.vault, note);
          const r = applyAction(cur.body, item.kimlik, item.islem, now);
          await store.mutate(profile.vault, {note, operation: 'patch', expected_sha256: cur.sha256, old_text: cur.body, new_text: r.body,
            reason: item.islem === 'yapildi' ? 'Telefon bildiriminden: yapıldı' : 'Telefon bildiriminden: yarın tekrar hatırlat'}, 'yuzuk');
          await fs.writeFile(answer, JSON.stringify({tamam: true, tarih: r.date}), 'utf8');
          done++;
        } catch (e) {
          await fs.writeFile(answer, JSON.stringify({hata: e.message}), 'utf8').catch(() => {});
        }
        await fs.rm(file, {force: true});
      }
    } finally { actionsBusy = false; }
    return done;
  }

  function inboxStart(ms = 15000) {
    if (inboxTimer) return;
    const tick = () => {
      inboxOnce().catch(() => {});
      actionsOnce().catch(() => {});
      if (Date.now() - sweptAt >= 60000) { sweptAt = Date.now(); reminderSweep().catch(() => {}); }
    };
    tick();
    inboxTimer = setInterval(tick, ms);
    inboxTimer.unref?.();
  }

  function shutdown() { cancel(); if (live) live.child.kill(); if (voiceJob) voiceJob.child.kill(); if (inboxTimer) clearInterval(inboxTimer); }

  return {status, chooseEngine, takeSource, setEngine, chooseAudio, run, cancel, drafts, draft, approve, discard, packageFor,
    devices, outputs, liveStart, liveStop, liveStatus, finishSession, shutdown, engineDir, phoneStatus, phoneStart, phonePair, writers, setWriter,
    voiceStatus, voiceEnroll, voiceDelete, phoneLive, inboxOnce, inboxStart, reminderSweep, actionsOnce};
}

module.exports = {createRing, draftDir};
