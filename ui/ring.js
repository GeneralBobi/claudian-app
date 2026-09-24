'use strict';
/*
  Yüzük view. Loaded after renderer.js and shares its script scope (api, t, esc, view, content).
  Every number on this screen comes from the engine's own events or files; there is no
  simulated progress, and nothing reaches the memory except through "Approve".
*/
const ring = {status: null, drafts: [], file: null, running: null, open: null, openId: null, result: null, bound: false,
  live: {devices: null, device: null, training: false, on: false, level: 0, speaking: false, ara: '', decisions: [], written: [], note: null, error: null, summary: null}};
const KIND_LABEL = {
  odev: ['Assignments and deadlines', 'Ödev ve teslimler'], sinav: ['Exam emphasis', 'Sınav vurguları'],
  hazirlik: ['Preparation', 'Hazırlık'], karar: ['Decisions, plans and promises', 'Kararlar, planlar ve sözler'],
  tanim: ['Content and definitions', 'İçerik ve tanımlar'], gurultu: ['Other kept sentences', 'Diğer tutulanlar'],
};
const clock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const rbtn = (en, tr, action, primary = false, extra = '') => `<button data-ring="${action}" class="${primary ? 'primary' : ''}" ${extra}>${t(en, tr)}</button>`;
const localStamp = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

function ringBind() {
  if (ring.bound) return; ring.bound = true;
  api.onRingEvent(async ev => {
    if (ev.olay === 'basladi') ring.running = {file: ev.dosya, events: [], started: Date.now()};
    if (ring.running) ring.running.events.push(ev);
    if (ev.olay === 'kapandi') {
      const done = ring.running?.events.find(e => e.olay === 'bitti');
      const fail = ring.running?.events.find(e => e.olay === 'hata');
      const wrote = ring.running?.events.find(e => e.olay === 'yazildi');
      ring.running = null;
      ring.result = fail ? {error: fail.mesaj} : wrote ? {written: wrote} : null;
      if (wrote) ring.file = null;
      else if (done) { ring.openId = done.taslak; ring.open = null; ring.file = null; }
    }
    if (view === 'ring') await renderRing();
  });
  api.onRingLive(ev => {
    const L = ring.live;
    if (ev.olay === 'seviye') { L.level = ev.rms; L.speaking = ev.konusuyor; liveMeter(); return; }
    if (ev.olay === 'ara') { L.ara = ev.metin; const el = document.querySelector('#ring-ara'); if (el) el.textContent = ev.metin; return; }
    if (ev.olay === 'soylendi' || ev.olay === 'yukleniyor') return;
    if (ev.olay === 'hazir') { L.on = true; L.model = ev.model; }
    if (ev.olay === 'karar') { L.decisions.push(ev); L.decisions = L.decisions.slice(-8); L.ara = ''; }
    if (ev.olay === 'aktar') { L.written.push(ev); L.written = L.written.slice(-8); L.passed = (L.passed || 0) + 1; }
    if (ev.olay === 'kapandi') { L.on = false; L.error = ev.mesaj || null; }
    if (ev.olay === 'sentez') { L.synth = ev; }
    if (view === 'ring' && !ring.open) renderRing();
  });
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-ring]');
    if (!el || view !== 'ring') return;
    el.disabled = true; errorBox.hidden = true;
    try { await ringAction(el.dataset.ring, el); }
    catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    finally { el.disabled = false; }
  });
}

async function ringAction(a, el) {
  if (a === 'choose-audio') { const f = await api.ringChooseAudio(); if (f) ring.file = f; }
  else if (a === 'choose-engine') { const s = await api.ringChooseEngine(); if (s) ring.status = s; }
  else if (a === 'writer') { await api.ringSetWriter(el.dataset.id); }
  else if (a === 'run') {
    const start = document.querySelector('#ring-start').value.replace('T', ' ');
    await api.ringRun({file: ring.file.file, title: document.querySelector('#ring-title').value, start,
      language: document.querySelector('#ring-lang').value, audit: document.querySelector('#ring-audit').checked});
    ring.result = null;
  }
  else if (a === 'cancel') await api.ringCancel();
  else if (a === 'clear-file') ring.file = null;
  else if (a === 'open') { ring.openId = el.dataset.id; ring.open = null; }
  else if (a === 'close') { ring.openId = null; ring.open = null; }
  else if (a === 'discard') {
    if (!confirm(t('Delete this draft? Nothing was written to memory from it.', 'Bu taslak silinsin mi? Ondan hafızaya hiçbir şey yazılmadı.'))) return;
    await api.ringDiscard(ring.openId); ring.openId = null; ring.open = null;
  }
  else if (a === 'approve') {
    const kept = [...document.querySelectorAll('[data-keep]:checked')].map(i => Number(i.dataset.keep));
    ring.approving = true; await renderRing();
    let r; try { r = await api.ringApprove(ring.openId, {kept}); } finally { ring.approving = false; }
    ring.result = {approved: r}; ring.open = null;
  }
  else if (a === 'receiver-start') ring.status = await api.ringReceiverStart();
  else if (a === 'receiver-stop') ring.status = await api.ringReceiverStop();
  else if (a === 'copy-url') await api.copy?.(ring.status.receiver.url);
  else if (a === 'phone-start') { ring.phoneBusy = true; await renderRing(); try { ring.phone = await api.ringPhoneStart(); } finally { ring.phoneBusy = false; } }
  else if (a === 'phone-pair') { ring.pair = null; ring.pairError = null; try { ring.pair = await api.ringPhonePair(); } catch (e) { ring.pairError = e.message; } }
  else if (a === 'copy-pair') await api.copy?.(ring.pair.url);
  else if (a === 'live-start') {
    const L = ring.live, mic = document.querySelector('#ring-mic');
    L.device = mic && mic.value !== '' ? Number(mic.value) : null;
    L.training = !!document.querySelector('#ring-train')?.checked;
    Object.assign(L, {decisions: [], written: [], passed: 0, synth: null, error: null, ara: '', on: true});
    await api.ringLiveStart({device: L.device, training: L.training});
  }
  else if (a === 'live-stop') await api.ringLiveStop();
  else if (a === 'package') { const r = await api.ringPackage(); if (r) ring.result = {packaged: r.target}; }
  await renderRing();
}

function howItWorks() {
  const steps = [
    [t('Listen', 'Dinleme'), t('Start live listening, send from your phone, or choose a recording.', 'Canlı dinlemeyi başlat, telefondan gönder ya da bir kayıt seç.')],
    [t('Transcribe', 'Yazıya dökme'), t('Whisper turns the speech into text on this computer.', 'Whisper konuşmayı bu bilgisayarda metne çevirir.')],
    [t('Filter', 'Ayıklama'), t('Only private sentences are removed (someone else’s health or family, numbers, a request not to be recorded); everything else stays.', 'Yalnız mahrem cümleler çıkarılır (başkasının sağlığı ya da ailesi, numaralar, kaydedilmeme isteği); gerisi kalır.')],
    [t('Write', 'Yazma'), t('The AI you pick reads the whole conversation and writes a note with a summary, headings and reminders into Obsidian.', 'Seçtiğin AI konuşmanın tamamını okur; özetli, başlıklı bir notu ve hatırlatıcıları Obsidian’a yazar.')],
  ];
  return `<details class="ring-how" open><summary>${t('How it works', 'Nasıl çalışır')}</summary><ol class="ring-steps">${steps.map(([h, p], i) => `<li><b>${i + 1}</b>${h}<span>${p}</span></li>`).join('')}</ol></details>`;
}

function liveMeter() {
  const bar = document.querySelector('#ring-level');
  if (!bar) return;
  bar.style.width = `${Math.min(100, Math.round(Math.sqrt(ring.live.level) * 260))}%`;
  bar.dataset.speaking = String(ring.live.speaking);
  const st = document.querySelector('#ring-live-state');
  if (st) st.textContent = ring.live.speaking ? t('Hearing speech', 'Konuşma duyuluyor') : t('Listening', 'Dinliyor');
}

function liveCard(s) {
  const L = ring.live;
  if (!s.liveCapable) return '';
  const label = d => ({aktar: t('passed to the note writer', 'not yazıcısına aktarıldı'), baglam: t('passed as context', 'bağlam olarak aktarıldı'),
    disarida: t('out of scope', 'kapsam dışı'), mahrem: t('private, never sent', 'mahrem, hiç gönderilmedi'),
    susuldu: t('paused after an objection', 'itirazdan sonra susuldu')}[d.karar] || d.karar);
  const mark = d => d.karar === 'aktar' ? '●' : d.karar === 'baglam' ? '○' : d.karar === 'mahrem' || d.karar === 'susuldu' ? '■' : '·';
  const decisions = L.decisions.slice().reverse().map(d => `<li class="ring-dec" data-k="${esc(d.karar)}"><time>${esc(d.saat || '')}</time><b>${mark(d)}</b><span>${d.metin && d.karar !== 'mahrem' ? esc(d.metin) : `<i>${label(d)}</i>`}</span><small>${label(d)}</small></li>`).join('');
  if (!L.on) {
    const opts = (L.devices || []).map(d => `<option value="${d.no}" ${d.varsayilan ? 'selected' : ''}>${esc(d.ad)}</option>`).join('');
    const sy = L.synth;
    const sum = !sy ? '' : sy.durum === 'basladi' ? `<div class="health-row"><div><span>${t('Writing the note', 'Not yazılıyor')}</span><p>${sy.aktarilan} ${t('sentences went to the note writer. This takes up to a couple of minutes.', 'cümle not yazıcısına gitti. Bir iki dakika sürebilir.')}</p></div></div>`
      : sy.durum === 'bitti' ? `<div class="health-row"><div><span>${t('Written to memory', 'Hafızaya yazıldı')}</span><p class="path">${esc(sy.not)}</p><p>${sy.hatirlatici} ${t('reminders', 'hatırlatıcı')}${sy.gereksiz ? ` · ${sy.gereksiz} ${t('passed sentences judged noise', 'aktarılan cümle gereksiz bulundu')}` : ''}</p></div></div>`
      : sy.durum === 'hata' ? `<div class="health-row health-warn"><div><span>${t('The note could not be written', 'Not yazılamadı')}</span><p>${esc(sy.mesaj)}</p><p class="path">${esc(sy.oturum || '')}</p></div></div>`
      : `<p class="subtle">${t('Nothing worth a note was heard.', 'Not değerinde bir şey duyulmadı.')}</p>`;
    return `<section class="ring-live card"><div class="toolbar"><h2>${t('Listen live', 'Canlı dinle')}</h2><span class="subtle">${t('The note goes straight to Obsidian', 'Not doğrudan Obsidian’a yazılır')}</span></div>
    <p>${t('Speech is transcribed on this computer. Laya reads each sentence with what came before it and decides only what reaches the note writer; it writes nothing itself. When you stop, Claude writes the note from what was passed. Private things (someone else’s health or family, numbers, passwords, a request not to be recorded) are never sent. Audio is not kept.', (s.full ? 'Konuşma bu bilgisayarda yazıya dökülür. Durdurduğunda konuşmanın tamamı seçtiğin AI’a gider ve notu o yazar. Mahrem olanlar (başkasının sağlığı ya da ailesi, numaralar, şifreler, kaydedilmeme isteği) önce çıkarılır, hiç gönderilmez. Ses saklanmaz.' : 'Konuşma bu bilgisayarda yazıya dökülür. Laya her cümleyi öncesiyle birlikte okur ve yalnız neyin not yazıcısına gideceğine karar verir; kendisi hiçbir şey yazmaz. Durdurduğunda notu, aktarılanlardan Claude yazar. Mahrem olanlar (başkasının sağlığı ya da ailesi, numaralar, şifreler, kaydedilmeme isteği) hiç gönderilmez. Ses saklanmaz.'))}</p>
    <div class="ring-fields ring-live-fields"><div><label for="ring-mic">${t('Microphone', 'Mikrofon')}</label><select id="ring-mic">${opts || `<option value="">${t('Default', 'Varsayılan')}</option>`}</select></div></div>
    <label class="check" ${s.full ? 'hidden' : ''}><input type="checkbox" id="ring-train" ${L.training ? 'checked' : ''}> ${t('Keep the text of non-private sentences on this computer to train the next model', 'Mahrem olmayan cümlelerin metnini sonraki modeli eğitmek için bu bilgisayarda sakla')}</label>
    ${L.error ? `<div class="health-row health-warn"><div><span>${t('Stopped', 'Durdu')}</span><p>${esc(L.error)}</p></div></div>` : ''}${sum}
    <div class="actions"><span class="subtle">${t('Tell the people around you that you are taking notes.', 'Çevrendekilere not aldığını söyle.')}</span>${rbtn('Start listening', 'Dinlemeye başla', 'live-start', true)}</div></section>`;
  }
  const written = L.written.slice().reverse().map(w => `<li><time>${esc(w.saat)}</time><span>${esc(w.metin)}</span><small>${w.neden === 'komsu' ? t('context', 'bağlam') : ''}</small></li>`).join('');
  return `<section class="ring-live card" data-on="true"><div class="toolbar"><h2>${t('Listening', 'Dinleniyor')} <span class="ring-rec">● ${t('REC', 'KAYIT')}</span></h2><span class="subtle" id="ring-live-state">${t('Listening', 'Dinliyor')}</span>${rbtn('Stop', 'Durdur', 'live-stop', true)}</div>
  <div class="ring-level-track"><div id="ring-level"></div></div>
  <p class="ring-ara" id="ring-ara">${esc(L.ara || '')}</p>
  ${L.error ? `<div class="health-row health-warn"><div><span>${t('Error', 'Hata')}</span><p>${esc(L.error)}</p></div></div>` : ''}
  <div class="ring-two"><div><h2>${t('Heard', 'Duyulan')}</h2><ul class="ring-decs">${decisions || `<li class="subtle">${t('Loading models, then waiting for speech…', 'Modeller yükleniyor, sonra konuşma bekleniyor…')}</li>`}</ul></div>
  <div><h2>${t('Going to the note writer', 'Not yazıcısına gidecek')} <span class="subtle">${L.passed || 0}</span></h2><ul class="ring-written">${written || `<li class="subtle">${t('Nothing yet.', 'Henüz yok.')}</li>`}</ul><p class="subtle">${t('The note is written when you stop.', 'Not, durdurduğunda yazılır.')}</p></div></div></section>`;
}

function writerPicker(s) {
  const w = s.writers;
  if (!s.full || !w) return '';
  const chips = w.list.map(x => `<button data-ring="writer" data-id="${esc(x.id)}" class="${x.id === w.chosen ? 'primary' : ''}" ${x.installed ? '' : 'disabled'} title="${x.installed ? '' : esc(t('Not installed on this computer', 'Bu bilgisayarda kurulu değil'))}">${esc(x.name)}</button>`).join('');
  return `<div class="ring-writer"><span>${t('Note written by', 'Notu yazan')}</span><div class="row">${chips}</div><p class="subtle">${t('The whole transcript goes to the tool you pick, through your own account on this computer. Private sentences are removed first.', 'Konuşmanın tamamı, bu bilgisayardaki kendi hesabınla seçtiğin araca gider. Mahrem cümleler önce çıkarılır.')}</p></div>`;
}

function engineLine(s) {
  if (s.full) return `<div class="ring-engine"><div><i>●</i><em>Whisper large-v3-turbo</em></div><div><i>●</i><em>${t('Whole transcript · Laya off', 'Tam döküm · Laya kapalı')}</em></div><div><span>${t('Transcription on this computer', 'Yazıya dökme bu bilgisayarda')}</span></div></div>${writerPicker(s)}`;
  const tr = s.training;
  const model = s.checks.tuned ? `${esc(s.model)}${tr?.tarih ? ` · ${t('trained', 'eğitildi')} ${esc(tr.tarih.slice(0, 10))}` : ''}` : 'Laya multilingual';
  return `<div class="ring-engine"><div><i>●</i><em>Whisper large-v3-turbo</em></div><div><i>●</i><em>${model}</em></div><div><span>${t('Offline · models on this computer', 'Çevrimdışı · modeller bu bilgisayarda')}</span></div></div>`;
}

function setupNeeded(s) {
  const row = (ok, label) => `<li>${ok ? '✓' : '○'} ${label}</li>`;
  return `<section class="card"><h2>${t('The engine is not installed on this computer', 'Motor bu bilgisayarda kurulu değil')}</h2>
  <p>${t('Yüzük runs a local Python engine (about 3 GB of models). Copy the engine folder here, run kur.bat inside it once, then choose the folder.', 'Yüzük yerel bir Python motoru çalıştırır (yaklaşık 3 GB model). Motor klasörünü bu bilgisayara kopyala, içindeki kur.bat dosyasını bir kez çalıştır, sonra klasörü seç.')}</p>
  <p class="path">${esc(s.dir)}</p><ul class="file-list">${row(s.checks.engine, t('Engine code', 'Motor kodu'))}${row(s.checks.python, t('Python environment (kur.bat)', 'Python ortamı (kur.bat)'))}${row(s.checks.whisper, t('Whisper model', 'Whisper modeli'))}${row(s.checks.tuned, t('Trained Laya model (optional)', 'Eğitilmiş Laya modeli (isteğe bağlı)'))}</ul>
  <div class="row">${rbtn('Choose engine folder', 'Motor klasörünü seç', 'choose-engine', true)}</div></section>`;
}

function newRecording() {
  if (!ring.file) return `<div class="ring-drop"><p>${t('Choose a recording of a lecture, a meeting or your own voice note.', 'Bir dersin, toplantının ya da kendi sesli notunun kaydını seç.')}<br><span class="subtle">mp3 · m4a · wav · ogg · flac</span></p>${rbtn('Choose audio file', 'Ses dosyası seç', 'choose-audio', true)}</div>`;
  const f = ring.file, title = f.name.replace(/\.[^.]+$/, '');
  return `<section class="ring-form"><div class="toolbar"><h2>${esc(f.name)}</h2><span class="subtle">${(f.size / 1048576).toFixed(1)} MB</span>${rbtn('Change', 'Değiştir', 'clear-file')}</div>
  <div class="ring-fields"><div><label for="ring-title">${t('Title', 'Başlık')}</label><input id="ring-title" maxlength="80" value="${esc(title)}"></div>
  <div><label for="ring-start">${t('Recording started', 'Kaydın başladığı an')}</label><input id="ring-start" type="datetime-local" value="${localStamp(f.modified).replace(' ', 'T')}"></div>
  <div><label for="ring-lang">${t('Language', 'Dil')}</label><select id="ring-lang"><option value="">${t('Detect', 'Otomatik')}</option><option value="tr">Türkçe</option><option value="en">English</option></select></div></div>
  <p class="subtle">${t('The start time turns “tomorrow” or “next Friday” into dates.', 'Başlangıç anı “yarın”, “gelecek cuma” gibi ifadeleri tarihe çevirmek için kullanılır.')}</p>
  <label class="check" ${ring.status?.full ? 'hidden' : ''}><input type="checkbox" id="ring-audit"> ${t('Audit mode — also keep the text of dropped sentences, so you can rescue them and teach the model', 'Denetim modu — atılan cümlelerin metnini de sakla; yanlışlıkla atılanı kurtarıp modele öğretebilirsin')}</label>
  <div class="actions"><span class="subtle">${ring.status?.full ? t('Audio stays on this computer; the transcript goes to the note writer you picked.', 'Ses bu bilgisayarda kalır; döküm seçtiğin not yazıcısına gider.') : t('Nothing leaves this computer.', 'Hiçbir şey bu bilgisayardan çıkmaz.')}</span>${rbtn('Extract notes', 'Notu çıkar', 'run', true)}</div></section>`;
}

function runningView() {
  const r = ring.running, ev = r.events;
  if (ev.some(e => e.olay === 'asama')) {
    const stage = (state, label, detail) => `<div class="stage ${state}"><b>${state === 'done' ? '✓' : state === 'running' ? '●' : '○'}</b>${label}${detail ? ` · ${detail}` : ''}</div>`;
    const prog = [...ev].reverse().find(e => e.olay === 'ilerleme');
    const w = ev.find(e => e.asama === 'yazici'), fin = ev.find(e => e.olay === 'bitti'), wrote = ev.find(e => e.olay === 'yazildi');
    return `<div class="progress-title"><span>${esc(r.file)}</span><span>${clock((Date.now() - r.started) / 1000)}</span></div>
    ${stage(w ? 'done' : 'running', t('Transcribing', 'Yazıya dökme'), w ? `${w.cumle} ${t('sentences', 'cümle')}${w.mahrem ? ` · ${w.mahrem} ${t('private removed', 'mahrem çıkarıldı')}` : ''}` : prog ? `%${Math.round(prog.oran * 100)}` : t('loading model', 'model yükleniyor'))}
    ${stage(fin ? 'done' : w ? 'running' : '', w ? `${esc(w.yazici)} ${t('writes the note', 'notu yazıyor')}` : t('Writing the note', 'Not yazımı'), '')}
    ${stage(wrote ? 'done' : fin ? 'running' : '', t('Obsidian', 'Obsidian'), '')}
    <div class="actions"><span class="subtle">${t('You can close the window; a notification arrives when the note is written.', 'Pencereyi kapatabilirsin; not yazılınca bildirim gelir.')}</span>${rbtn('Stop', 'Durdur', 'cancel')}</div>`;
  }
  const last = (asama, olay) => [...ev].reverse().find(e => e.asama === asama && (!olay || e.olay === olay));
  const sttDone = ev.find(e => e.asama === 'yazi' && e.durum === 'bitti');
  const gateDone = ev.find(e => e.asama === 'kapi' && e.durum === 'bitti');
  const sttProg = last('yazi', 'ilerleme'), gateProg = last('kapi', 'ilerleme');
  const stage = (state, label, detail) => `<div class="stage ${state}"><b>${state === 'done' ? '✓' : state === 'running' ? '●' : '○'}</b>${label}${detail ? ` · ${detail}` : ''}</div>`;
  return `<div class="progress-title"><span>${esc(r.file)}</span><span>${clock((Date.now() - r.started) / 1000)}</span></div>
  ${stage(sttDone ? 'done' : 'running', t('Transcribing', 'Yazıya dökme'), sttDone ? `${sttDone.cumle} ${t('sentences', 'cümle')} · ${clock(sttDone.ses_sn)} ${t('audio', 'ses')} · ${Math.round(sttDone.sure_sn)} sn · ${esc(sttDone.cihaz === 'cuda' ? 'GPU' : 'CPU')}` : sttProg ? `%${Math.round(sttProg.oran * 100)}` : t('loading model', 'model yükleniyor'))}
  ${stage(gateDone ? 'done' : sttDone ? 'running' : '', t('Selecting', 'Ayıklama'), gateDone ? `${gateDone.tutulan} ${t('kept', 'tutuldu')} · ${Math.round(gateDone.sure_sn)} sn` : gateProg ? `${gateProg.i} / ${gateProg.toplam}` : '')}
  ${stage(gateDone ? 'running' : '', t('Draft', 'Taslak'), '')}
  <div class="actions"><span class="subtle">${t('You can close the window; a notification arrives when the draft is ready.', 'Pencereyi kapatabilirsin; taslak hazır olunca bildirim gelir.')}</span>${rbtn('Stop', 'Durdur', 'cancel')}</div>`;
}

function reviewView(d) {
  if (d.durum === 'yazildi') return `<div class="toolbar"><h2>${esc(d.baslik)}</h2>${rbtn('Back', 'Geri', 'close')}</div><p>${t('Written to memory as', 'Hafızaya şu adla yazıldı:')} <span class="path">${esc(d.not)}</span></p><p class="subtle">${d.parca || 0} ${t('sentences', 'cümle')}${d.yazici ? ` · ${t('note by', 'notu yazan')} ${esc(d.yazici)}` : ''}</p>`;
  const approved = d.durum === 'onaylandi';
  const kept = d.kayitlar.filter(k => k.tut && k.metin), dropped = d.kayitlar.filter(k => !k.tut && k.metin);
  const seg = (k, on) => `<label class="ring-seg${on ? '' : ' off'}"><input type="checkbox" data-keep="${k.no}" ${on ? 'checked' : ''} ${approved ? 'disabled' : ''}><time>${esc(k.saat)}</time><span>${esc(k.metin)}</span><small>${k.neden === 'devam' ? t('continuation', 'devamı') : esc(t(...(KIND_LABEL[k.tur] || KIND_LABEL.gurultu)).split(/[ ,]/)[0].toLowerCase())}</small></label>`;
  const groups = Object.keys(KIND_LABEL).map(kind => {
    const g = kept.filter(k => k.tur === kind); if (!g.length) return '';
    return `<div class="ring-group"><h2>${t(...KIND_LABEL[kind])}</h2>${g.map(k => seg(k, true)).join('')}</div>`;
  }).join('');
  const droppedBlock = dropped.length
    ? `<details><summary>${t('Dropped', 'Atılan')} ${dropped.length} ${t('sentences — tick one to keep it', 'cümle — tutmak istediğini işaretle')}</summary>${dropped.map(k => seg(k, false)).join('')}</details>`
    : `<p class="subtle">${t('Dropped', 'Atılan')} ${d.parca - d.tutulan} ${t('sentences: their text was not stored, only time and kind.', 'cümle: metinleri saklanmadı, yalnız zamanı ve türü.')}</p>`;
  const head = `<div class="toolbar"><h2>${esc(d.baslik)} · ${esc(d.baslangic.slice(8, 10) + '.' + d.baslangic.slice(5, 7) + ' ' + d.baslangic.slice(11, 16))}</h2><span class="subtle">${d.parca} ${t('sentences', 'cümle')} · ${d.tutulan} ${t('kept', 'tutuldu')} · ${esc(d.kapi_model || 'Laya')}</span>${rbtn('Back', 'Geri', 'close')}</div>`;
  if (approved) return `${head}<p>${t('Approved and written to memory as', 'Onaylandı ve hafızaya şu adla yazıldı:')} <span class="path">${esc(d.not)}</span></p>${groups}`;
  return `${head}${groups}${droppedBlock}
  <div class="actions"><button data-ring="discard" class="link">${t('Delete draft', 'Taslağı sil')}</button>${ring.approving ? `<span class="subtle">${t('Claude is writing the note…', 'Claude notu yazıyor…')}</span>` : rbtn('Approve: Claude writes the note', 'Onayla: notu Claude yazsın', 'approve', true)}</div>
  <p class="subtle">${t('On approval the ticked sentences go to Claude, which writes the note and its reminders. Your corrections are saved as training data for Laya.', 'Onayda işaretli cümleler Claude’a gider; notu ve hatırlatıcıları o yazar. Düzeltmelerin Laya için eğitim verisi olarak saklanır.')}</p>`;
}

function history() {
  if (!ring.drafts.length) return '';
  const label = s => s === 'yazildi' ? t('in Obsidian', 'Obsidian’da') : s === 'onaylandi' ? t('approved', 'onaylandı') : t('draft', 'taslak');
  return `<section class="panel-section"><h2>${t('Recordings', 'Kayıtlar')}</h2>${ring.drafts.slice(0, 12).map(d => `<button class="ring-row" data-ring="open" data-id="${esc(d.id)}"><span>${esc(d.title)}</span><time>${esc(String(d.start).slice(8, 10) + '.' + String(d.start).slice(5, 7))} · ${d.kept} ${t('items', 'madde')} · ${label(d.status)}</time></button>`).join('')}</section>`;
}

function phoneCard() {
  const p = ring.phone;
  const via = p?.cloud
    ? t('The phone talks to the Yüzük cloud (yuzuk-api.claudian.app); the cloud hands the work to this computer. Audio passes through and is never stored there.', 'Telefon Yüzük bulutuyla konuşur (yuzuk-api.claudian.app); bulut işi bu bilgisayara verir. Ses oradan akarak geçer, saklanmaz.')
    : t('Processing happens on this computer through yuzuk.claudian.app.', 'İşlem yuzuk.claudian.app üzerinden bu bilgisayarda yapılır.');
  const head = `<h2>${t('Phone app', 'Telefon uygulaması')}</h2><p>${t('The Yüzük app records on the phone, even with the screen locked, and the note lands in the phone’s Obsidian vault.', 'Yüzük uygulaması telefonda kaydeder (ekran kilitliyken de); not telefondaki Obsidian vault’una düşer.')} ${via}</p>`;
  if (!p?.capable) return `<div class="card">${head}<p class="subtle">${t('This engine folder has no phone server yet (sunucu.py). Update the engine.', 'Bu motor klasöründe telefon sunucusu (sunucu.py) yok. Motoru güncelle.')}</p></div>`;
  const state = p.running
    ? `<p class="subtle">${t('Server running', 'Sunucu açık')} · ${esc(p.origin.replace('https://', ''))}${p.speakers ? ` · ${t('speakers told apart', 'konuşmacılar ayrılıyor')}` : ''}${p.voiceprint ? ` · ${t('your voice enrolled', 'sesin tanıtıldı')}` : ''}${p.queued ? ` · ${p.queued} ${t('in queue', 'sırada')}` : ''}</p>`
    : `<p class="subtle">${t('Server closed: the phone’s recordings wait on the phone until it opens.', 'Sunucu kapalı: telefondaki kayıtlar sunucu açılana kadar telefonda bekler.')}</p>${ring.phoneBusy ? `<p class="subtle">${t('Starting…', 'Başlatılıyor…')}</p>` : rbtn('Start server', 'Sunucuyu başlat', 'phone-start', true)}`;
  const pair = ring.pair
    ? `<div class="ring-pair"><div class="ring-qr" aria-label="${t('Pairing QR code', 'Eşleştirme QR kodu')}">${ring.pair.qr}</div><div><p>${t('Scan with the phone camera, or open the address. It installs the app and pairs it with a one-time code.', 'Telefon kamerasıyla okut ya da adresi aç. Uygulamayı kurar ve tek kullanımlık kodla eşleştirir.')}</p><div class="ring-addr">${esc(ring.pair.url)}</div><p class="subtle">${t('Code', 'Kod')}: <b>${esc(ring.pair.code)}</b> · ${t('valid 24 hours, once', '24 saat, bir kez geçerli')}</p><div class="row">${rbtn('Copy address', 'Adresi kopyala', 'copy-pair')}</div></div></div>`
    : (p.running ? rbtn('Pair a phone', 'Telefonu bağla', 'phone-pair', true) : '');
  const err = ring.pairError ? `<p class="subtle">${esc(ring.pairError)}</p>` : '';
  return `<div class="card ring-phone">${head}${state}${pair}${err}</div>`;
}

function devices(s) {
  const rc = s.receiver;
  return `<section class="panel-section"><h2>${t('Other devices', 'Diğer cihazlar')}</h2><p>${t('Processing always happens on a computer. A phone only records and sends; another computer can run the engine itself.', 'İşlem hep bir bilgisayarda yapılır. Telefon yalnız kaydeder ve gönderir; başka bir bilgisayar ise motoru kendisi çalıştırabilir.')}</p>
  ${phoneCard()}<div class="ring-two"><div class="card"><details><summary><h2>${t("Without the app: send over Wi-Fi", "Uygulama olmadan: Wi-Fi üzerinden gönder")}</h2></summary><p>${t('While the phone is on the same Wi-Fi, open this address on it and send a recording. The address works only on your local network and only with its code.', 'Telefon bu bilgisayarla aynı Wi-Fi’deyken bu adresi telefonda aç ve kaydı gönder. Adres yalnız yerel ağında ve içindeki kodla çalışır.')}</p>
  ${rc ? `<div class="ring-addr">${esc(rc.url)}</div><div class="row">${rbtn('Copy', 'Kopyala', 'copy-url')}${rbtn('Close receiver', 'Alıcıyı kapat', 'receiver-stop')}</div><p class="subtle">${t('Open', 'Açık')} · ${rc.received} ${t('received — each becomes a draft here.', 'dosya alındı — her biri burada taslağa dönüşür.')}</p>`
      : `${rbtn('Open receiver', 'Alıcıyı aç', 'receiver-start')}<p class="subtle">${t('Closed. Windows may ask once to allow the local network.', 'Kapalı. Windows bir kez yerel ağ izni isteyebilir.')}</p>`}</details></div>
  <div class="card"><h2>${t('Install on another computer', 'Başka bir bilgisayara kur')}</h2><p>${t('Windows 10/11 with Python 3.12. An NVIDIA GPU makes it fast; without one it runs on the processor.', 'Windows 10/11 ve Python 3.12. NVIDIA ekran kartı hızlandırır; yoksa işlemcide çalışır.')}</p>
  <ol class="ring-list"><li>${t('Prepare the package on a USB drive or network folder (engine + trained models, about 3 GB).', 'Paketi bir USB belleğe ya da ağ klasörüne hazırla (motor + eğitilmiş modeller, yaklaşık 3 GB).')}</li><li>${t('On the other computer run kur.bat inside Yuzuk-motor.', 'Diğer bilgisayarda Yuzuk-motor içindeki kur.bat’ı çalıştır.')}</li><li>${t('Install Claudian there and choose that folder in Yüzük.', 'Oraya Claudian’ı kur ve Yüzük’te o klasörü seç.')}</li></ol>
  ${rbtn('Prepare package', 'Kurulum paketini hazırla', 'package')}</div></div></section>`;
}

async function renderRing() {
  ringBind();
  ring.status = await api.ringStatus();
  ring.phone = await api.ringPhoneStatus?.().catch(() => null) ?? null;
  if (ring.status.running && !ring.running) ring.running = {file: ring.status.running.file, events: ring.status.running.events, started: Date.now()};
  ring.drafts = ring.status.ready ? await api.ringDrafts() : [];
  if (ring.openId && !ring.open) ring.open = await api.ringDraft(ring.openId).catch(() => null);
  const s = ring.status;
  let body = `<h1>${t('Ring', 'Yüzük')}</h1><p class="ring-lead">${t('Takes notes from what is said around you: lectures, meetings or your own voice. Transcription and Laya’s decisions run on this computer; Claude writes the note from the passed sentences only. In live listening the note is written when you stop; for a recording, after your approval.', 'Çevrende konuşulandan not alır: ders, toplantı ya da kendi sesin. Yazıya dökme ve Laya’nın kararı bu bilgisayarda çalışır; notu, yalnız aktarılan cümlelerden Claude yazar. Canlı dinlemede not durdurunca yazılır; işlenen bir kayıtta senin onayından sonra.')}</p>${howItWorks()}`;
  if (!s.ready) { content.innerHTML = body + setupNeeded(s) + devices(s); return; }
  body += engineLine(s);
  if (s.liveCapable && ring.live.devices === null) ring.live.devices = await api.ringDevices().catch(() => []);
  if (s.live && !ring.live.on) Object.assign(ring.live, {on: true, passed: s.live.passed, decisions: s.live.last || []});
  body += liveCard(s);
  if (ring.result?.error) body += `<div id="ring-error" class="health-row health-warn"><div><span>${t('Stopped', 'Durdu')}</span><p>${esc(ring.result.error)}</p></div></div>`;
  if (ring.result?.approved) body += `<div class="health-row"><div><span>${t('Written to memory', 'Hafızaya yazıldı')}</span><p class="path">${esc(ring.result.approved.note)}</p><p>${ring.result.approved.reminders.length} ${t('reminders added', 'hatırlatıcı eklendi')} · ${ring.result.approved.corrected} ${t('corrections saved for training', 'düzeltme eğitim için saklandı')}</p></div></div>`;
  if (ring.result?.written) body += ring.result.written.bos
    ? `<div class="health-row"><div><span>${t('No note', 'Not yok')}</span><p>${t('No speech worth a note was found in the recording.', 'Kayıtta not değerinde konuşma bulunamadı.')}</p></div></div>`
    : `<div class="health-row"><div><span>${t('Written to memory', 'Hafızaya yazıldı')}</span><p class="path">${esc(ring.result.written.not)}</p><p>${ring.result.written.hatirlatici || 0} ${t('reminders added', 'hatırlatıcı eklendi')}</p></div></div>`;
  if (ring.result?.packaged) body += `<div class="health-row"><div><span>${t('Package ready', 'Paket hazır')}</span><p class="path">${esc(ring.result.packaged)}</p></div></div>`;
  if (ring.running) body += `<section class="ring-block">${runningView()}</section>`;
  else if (ring.open) body += `<section class="ring-block">${reviewView(ring.open)}</section>`;
  else body += `<section class="ring-block"><h2>${t('Or process a recording', 'Ya da bir kaydı işle')}</h2>${newRecording()}</section>`;
  content.innerHTML = body + history() + devices(s);
}
window.renderRing = renderRing;
// Keep the running clock honest while a job is active; no animation, only the elapsed time.
setInterval(() => { if (view === 'ring' && ring.running) { const el = document.querySelector('.progress-title span:last-child'); if (el) el.textContent = clock((Date.now() - ring.running.started) / 1000); } }, 1000);
