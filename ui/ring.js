'use strict';
/*
  Yüzük view. Loaded after renderer.js and shares its script scope (api, t, esc, view, content).
  Every number on this screen comes from the engine's own events or files; there is no
  simulated progress, and nothing reaches the memory except through "Approve".
*/
const ring = {status: null, drafts: [], file: null, running: null, open: null, openId: null, result: null, bound: false};
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
      ring.running = null;
      ring.result = fail ? {error: fail.mesaj} : null;
      if (done) { ring.openId = done.taslak; ring.open = null; ring.file = null; }
    }
    if (view === 'ring') await renderRing();
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
    const reminders = [...document.querySelectorAll('[data-remind]:checked')].map(i => ({no: Number(i.dataset.remind),
      date: document.querySelector(`[data-remind-date="${i.dataset.remind}"]`).value}));
    const r = await api.ringApprove(ring.openId, {kept, reminders});
    ring.result = {approved: r}; ring.open = null;
  }
  else if (a === 'receiver-start') ring.status = await api.ringReceiverStart();
  else if (a === 'receiver-stop') ring.status = await api.ringReceiverStop();
  else if (a === 'copy-url') await api.copy?.(ring.status.receiver.url);
  else if (a === 'package') { const r = await api.ringPackage(); if (r) ring.result = {packaged: r.target}; }
  await renderRing();
}

function howItWorks() {
  const steps = [
    [t('Record', 'Kayıt'), t('Swipe the ring, send from your phone, or choose an audio file.', 'Yüzükte kaydır, telefondan gönder ya da bir ses dosyası seç.')],
    [t('Transcribe', 'Yazıya dökme'), t('Whisper turns the speech into text on this computer.', 'Whisper konuşmayı bu bilgisayarda metne çevirir.')],
    [t('Select', 'Ayıklama'), t('Laya decides for every sentence whether it is worth keeping.', 'Laya her cümle için tutmaya değer mi diye karar verir.')],
    [t('Approve', 'Onay'), t('You correct the draft. Only what you approve is written to memory.', 'Taslağı sen düzeltirsin. Hafızaya yalnız onayladığın yazılır.')],
  ];
  return `<details class="ring-how" open><summary>${t('How it works', 'Nasıl çalışır')}</summary><ol class="ring-steps">${steps.map(([h, p], i) => `<li><b>${i + 1}</b>${h}<span>${p}</span></li>`).join('')}</ol></details>`;
}

function engineLine(s) {
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
  <label class="check"><input type="checkbox" id="ring-audit"> ${t('Audit mode — also keep the text of dropped sentences, so you can rescue them and teach the model', 'Denetim modu — atılan cümlelerin metnini de sakla; yanlışlıkla atılanı kurtarıp modele öğretebilirsin')}</label>
  <div class="actions"><span class="subtle">${t('Nothing leaves this computer.', 'Hiçbir şey bu bilgisayardan çıkmaz.')}</span>${rbtn('Extract notes', 'Notu çıkar', 'run', true)}</div></section>`;
}

function runningView() {
  const r = ring.running, ev = r.events;
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
  const approved = d.durum === 'onaylandi';
  const kept = d.kayitlar.filter(k => k.tut && k.metin), dropped = d.kayitlar.filter(k => !k.tut && k.metin);
  const seg = (k, on) => `<label class="ring-seg${on ? '' : ' off'}"><input type="checkbox" data-keep="${k.no}" ${on ? 'checked' : ''} ${approved ? 'disabled' : ''}><time>${esc(k.saat)}</time><span>${esc(k.metin)}</span><small>${k.neden === 'devam' ? t('continuation', 'devamı') : esc(t(...(KIND_LABEL[k.tur] || KIND_LABEL.gurultu)).split(/[ ,]/)[0].toLowerCase())}</small></label>`;
  const groups = Object.keys(KIND_LABEL).map(kind => {
    const g = kept.filter(k => k.tur === kind); if (!g.length) return '';
    return `<div class="ring-group"><h2>${t(...KIND_LABEL[kind])}</h2>${g.map(k => seg(k, true)).join('')}</div>`;
  }).join('');
  const dated = kept.flatMap(k => (k.tarihler || []).slice(0, 1).map(tt => ({k, tt})));
  const reminders = dated.length ? `<div class="ring-group"><h2>${t('Reminders to add', 'Hatırlatıcılara gidecek')}</h2>${dated.map(({k, tt}) => `<div class="ring-remind"><input type="checkbox" data-remind="${k.no}" checked ${approved ? 'disabled' : ''}><input type="date" data-remind-date="${k.no}" value="${esc(tt.zaman.slice(0, 10))}" ${approved ? 'disabled' : ''}><span>${esc(k.metin)} <small class="subtle">“${esc(tt.ifade)}”</small></span></div>`).join('')}</div>` : '';
  const droppedBlock = dropped.length
    ? `<details><summary>${t('Dropped', 'Atılan')} ${dropped.length} ${t('sentences — tick one to keep it', 'cümle — tutmak istediğini işaretle')}</summary>${dropped.map(k => seg(k, false)).join('')}</details>`
    : `<p class="subtle">${t('Dropped', 'Atılan')} ${d.parca - d.tutulan} ${t('sentences: their text was not stored, only time and kind.', 'cümle: metinleri saklanmadı, yalnız zamanı ve türü.')}</p>`;
  const head = `<div class="toolbar"><h2>${esc(d.baslik)} · ${esc(d.baslangic.slice(8, 10) + '.' + d.baslangic.slice(5, 7) + ' ' + d.baslangic.slice(11, 16))}</h2><span class="subtle">${d.parca} ${t('sentences', 'cümle')} · ${d.tutulan} ${t('kept', 'tutuldu')} · ${esc(d.kapi_model || 'Laya')}</span>${rbtn('Back', 'Geri', 'close')}</div>`;
  if (approved) return `${head}<p>${t('Approved and written to memory as', 'Onaylandı ve hafızaya şu adla yazıldı:')} <span class="path">${esc(d.not)}</span></p>${groups}`;
  return `${head}${groups}${reminders}${droppedBlock}
  <div class="actions"><button data-ring="discard" class="link">${t('Delete draft', 'Taslağı sil')}</button>${rbtn('Approve and write to memory', 'Onayla ve hafızaya yaz', 'approve', true)}</div>
  <p class="subtle">${t('Approval opens one note for this recording and adds the ticked dates to reminders. Your corrections are saved as training data for the next model.', 'Onay bu kayıt için bir not açar ve işaretli tarihleri Hatırlatıcılar’a ekler. Düzeltmelerin bir sonraki modelin eğitim verisi olarak saklanır.')}</p>`;
}

function history() {
  if (!ring.drafts.length) return '';
  const label = s => s === 'onaylandi' ? t('approved', 'onaylandı') : t('draft', 'taslak');
  return `<section class="panel-section"><h2>${t('Recordings', 'Kayıtlar')}</h2>${ring.drafts.slice(0, 12).map(d => `<button class="ring-row" data-ring="open" data-id="${esc(d.id)}"><span>${esc(d.title)}</span><time>${esc(String(d.start).slice(8, 10) + '.' + String(d.start).slice(5, 7))} · ${d.kept} ${t('items', 'madde')} · ${label(d.status)}</time></button>`).join('')}</section>`;
}

function devices(s) {
  const rc = s.receiver;
  return `<section class="panel-section"><h2>${t('Other devices', 'Diğer cihazlar')}</h2><p>${t('Processing always happens on a computer. A phone only records and sends; another computer can run the engine itself.', 'İşlem hep bir bilgisayarda yapılır. Telefon yalnız kaydeder ve gönderir; başka bir bilgisayar ise motoru kendisi çalıştırabilir.')}</p>
  <div class="ring-two"><div class="card"><h2>${t('Send from your phone', 'Telefondan gönder')}</h2><p>${t('While the phone is on the same Wi-Fi, open this address on it and send a recording. The address works only on your local network and only with its code.', 'Telefon bu bilgisayarla aynı Wi-Fi’deyken bu adresi telefonda aç ve kaydı gönder. Adres yalnız yerel ağında ve içindeki kodla çalışır.')}</p>
  ${rc ? `<div class="ring-addr">${esc(rc.url)}</div><div class="row">${rbtn('Copy', 'Kopyala', 'copy-url')}${rbtn('Close receiver', 'Alıcıyı kapat', 'receiver-stop')}</div><p class="subtle">${t('Open', 'Açık')} · ${rc.received} ${t('received — each becomes a draft here.', 'dosya alındı — her biri burada taslağa dönüşür.')}</p>`
      : `${rbtn('Open receiver', 'Alıcıyı aç', 'receiver-start', true)}<p class="subtle">${t('Closed. Windows may ask once to allow the local network.', 'Kapalı. Windows bir kez yerel ağ izni isteyebilir.')}</p>`}</div>
  <div class="card"><h2>${t('Install on another computer', 'Başka bir bilgisayara kur')}</h2><p>${t('Windows 10/11 with Python 3.12. An NVIDIA GPU makes it fast; without one it runs on the processor.', 'Windows 10/11 ve Python 3.12. NVIDIA ekran kartı hızlandırır; yoksa işlemcide çalışır.')}</p>
  <ol class="ring-list"><li>${t('Prepare the package on a USB drive or network folder (engine + trained models, about 3 GB).', 'Paketi bir USB belleğe ya da ağ klasörüne hazırla (motor + eğitilmiş modeller, yaklaşık 3 GB).')}</li><li>${t('On the other computer run kur.bat inside Yuzuk-motor.', 'Diğer bilgisayarda Yuzuk-motor içindeki kur.bat’ı çalıştır.')}</li><li>${t('Install Claudian there and choose that folder in Yüzük.', 'Oraya Claudian’ı kur ve Yüzük’te o klasörü seç.')}</li></ol>
  ${rbtn('Prepare package', 'Kurulum paketini hazırla', 'package')}</div></div></section>`;
}

async function renderRing() {
  ringBind();
  ring.status = await api.ringStatus();
  if (ring.status.running && !ring.running) ring.running = {file: ring.status.running.file, events: ring.status.running.events, started: Date.now()};
  ring.drafts = ring.status.ready ? await api.ringDrafts() : [];
  if (ring.openId && !ring.open) ring.open = await api.ringDraft(ring.openId).catch(() => null);
  const s = ring.status;
  let body = `<h1>${t('Ring', 'Yüzük')}</h1><p class="ring-lead">${t('Turns a recording into a draft note: lectures, meetings or your own voice notes. Every step runs on this computer; audio and text never leave it. Nothing is written to memory until you approve it.', 'Bir kaydı taslak nota çevirir: ders, toplantı ya da kendi sesli notun. Her adım bu bilgisayarda çalışır; ses ve metin buradan çıkmaz. Sen onaylamadan hafızaya hiçbir şey yazılmaz.')}</p>${howItWorks()}`;
  if (!s.ready) { content.innerHTML = body + setupNeeded(s) + devices(s); return; }
  body += engineLine(s);
  if (ring.result?.error) body += `<div id="ring-error" class="health-row health-warn"><div><span>${t('Stopped', 'Durdu')}</span><p>${esc(ring.result.error)}</p></div></div>`;
  if (ring.result?.approved) body += `<div class="health-row"><div><span>${t('Written to memory', 'Hafızaya yazıldı')}</span><p class="path">${esc(ring.result.approved.note)}</p><p>${ring.result.approved.reminders.length} ${t('reminders added', 'hatırlatıcı eklendi')} · ${ring.result.approved.corrected} ${t('corrections saved for training', 'düzeltme eğitim için saklandı')}</p></div></div>`;
  if (ring.result?.packaged) body += `<div class="health-row"><div><span>${t('Package ready', 'Paket hazır')}</span><p class="path">${esc(ring.result.packaged)}</p></div></div>`;
  if (ring.running) body += `<section class="ring-block">${runningView()}</section>`;
  else if (ring.open) body += `<section class="ring-block">${reviewView(ring.open)}</section>`;
  else body += `<section class="ring-block">${newRecording()}</section>`;
  content.innerHTML = body + history() + devices(s);
}
window.renderRing = renderRing;
// Keep the running clock honest while a job is active; no animation, only the elapsed time.
setInterval(() => { if (view === 'ring' && ring.running) { const el = document.querySelector('.progress-title span:last-child'); if (el) el.textContent = clock((Date.now() - ring.running.started) / 1000); } }, 1000);
