'use strict';
/*
  Yüzük view. Loaded after renderer.js and shares its script scope (api, t, esc, view, content).
  Every number on this screen comes from the engine's own events or files; there is no
  simulated progress, and nothing reaches the memory except through "Approve".
*/
const ring = {status: null, drafts: [], file: null, running: null, open: null, openId: null, result: null, bound: false,
  live: {devices: null, outputs: null, source: 'mikrofon', output: '', device: null, training: false, on: false, level: 0, speaking: false, ara: '', decisions: [], written: [], note: null, error: null, summary: null},
  voice: {status: null, running: false, seconds: 25, elapsed: 0, level: 0, error: null, result: null}, phoneLive: null,
  install: {plan: null, ev: null, running: false, error: null, result: null}};
const KIND_LABEL = {
  odev: ['Assignments and deadlines', 'Ödev ve teslimler'], sinav: ['Exam emphasis', 'Sınav vurguları'],
  hazirlik: ['Preparation', 'Hazırlık'], karar: ['Decisions, plans and promises', 'Kararlar, planlar ve sözler'],
  tanim: ['Content and definitions', 'İçerik ve tanımlar'], gurultu: ['Other kept sentences', 'Diğer tutulanlar'],
};
const clock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const rbtn = (en, tr, action, primary = false, extra = '', icon = '') => `<button data-ring="${action}" class="${primary ? 'primary' : ''}${icon ? ' with-icon' : ''}" ${extra}>${icon}${t(en, tr)}</button>`;
// Same glyphs as the phone app (lucide Mic and Square), so the two surfaces read as one product.
const MIC_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>';
// Windows varsayılan girişi sanal bir aygıt olabilir (SteelSeries Sonar 24.09'da neredeyse ses vermedi): varsayılan
// sanal aygıtsa ilk gerçek mikrofon seçilir.
const SANAL_MIK = /sonar|voicemeeter|stereo mix|virtual|cable output|vb-audio/i;
function micOptions(devices, chosen = null) {
  const list = devices || [];
  const def = list.find(d => d.varsayilan);
  const pick = (chosen !== null && list.find(d => d.no === chosen)) || (def && !SANAL_MIK.test(def.ad) ? def : list.find(d => !SANAL_MIK.test(d.ad)) || def);
  return list.map(d => `<option value="${d.no}" ${d === pick ? 'selected' : ''}>${esc(d.ad)}</option>`).join('');
}
const dayStamp = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const localStamp = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

function ringBind() {
  if (ring.bound) return; ring.bound = true;
  api.onRingWriterSetup?.(ev => {
    const W = ring.writerSetup ||= {};
    W.progress = ev.adim === 'indiriliyor' ? ev : null;
    if (view === 'ring' && (ev.adim !== 'indiriliyor' || !W.drawn || Date.now() - W.drawn > 500)) { W.drawn = Date.now(); renderRing(); }
  });
  api.onRingEvent(async ev => {
    if (ev.olay === 'paket') return; // package progress has its own listener below
    if (ev.olay === 'alici') { ring.status = await api.ringStatus(); if (view === 'ring') await renderRing(); return; }
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
  api.onRingEvent?.(ev => {
    if (ev.olay !== 'paket') return;
    ring.pkg = ev.durum === 'bitti' ? null : {...(ring.pkg || {}), ...ev};
    if (ev.durum === 'bitti') ring.result = {packaged: ev.hedef, size: ev.boyut};
    if (ev.durum === 'hata') ring.pkg = {durum: 'hata', mesaj: ev.mesaj};
    const box = document.querySelector('#ring-pkg');
    if (box && ev.durum === 'suruyor') { box.innerHTML = pkgProgress(); return; }
    if (view === 'ring' && !ring.open) renderRing();
  });
  api.onRingInstall?.(ev => {
    const I = ring.install;
    I.ev = ev;
    if (ev.adim === 'bitti') { I.result = ev; I.running = false; }
    // Byte progress arrives many times a second: only the progress block is redrawn, not the whole view.
    const box = document.querySelector('#ring-install-progress');
    if (box && ev.adim !== 'bitti') { box.innerHTML = installProgress(); return; }
    if (view === 'ring' && !ring.open) renderRing();
  });
  api.onRingVoice?.(ev => {
    const V = ring.voice;
    if (ev.olay === 'ilerleme') {
      V.elapsed = ev.gecen_sn; V.level = ev.seviye;
      const bar = document.querySelector('#ring-voice-bar'), sec = document.querySelector('#ring-voice-sec');
      if (bar) bar.style.width = `${Math.min(100, Math.round(V.elapsed / V.seconds * 100))}%`;
      if (sec) sec.textContent = `${clock(V.elapsed)} / ${clock(V.seconds)}`;
      const lv = document.querySelector('#ring-voice-level');
      if (lv) lv.style.width = `${Math.min(100, Math.round(Math.sqrt(V.level) * 260))}%`;
      return;
    }
    if (ev.olay === 'hata') V.error = ev.mesaj;
    if (ev.olay === 'bitti') V.result = ev;
    if (ev.olay === 'kapandi') { V.running = false; if (ev.kod && !V.error) V.error = t('Voice enrollment stopped.', 'Ses tanıtma durdu.'); }
    if (view === 'ring' && !ring.open) renderRing();
  });
  // Choosing a sound source changes which fields apply, so the card is redrawn with the choice kept.
  document.addEventListener('change', e => {
    if (view !== 'ring' || e.target.dataset?.ringChange !== 'source') return;
    const L = ring.live, mic = document.querySelector('#ring-mic'), out = document.querySelector('#ring-output');
    L.source = e.target.value;
    if (mic && mic.value !== '') L.device = Number(mic.value);
    if (out) L.output = out.value;
    renderRing();
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
  else if (a === 'choose-engine' || a === 'install') {
    // 1.5.0: a chosen folder is either a working engine or a source to install from (package, USB, old copy).
    let fromFolder = false;
    if (a === 'choose-engine') {
      const r = await api.ringChooseEngine();
      if (!r) return;
      if (r.engine) { ring.status = r.status; await renderRing(); return; }
      fromFolder = true;
    }
    const I = ring.install;
    Object.assign(I, {running: true, error: null, result: null, ev: null});
    await renderRing();
    try { I.result = await api.ringInstall({fromFolder}); }
    catch (e) { I.error = e.message; }
    finally { I.running = false; I.plan = null; }
  }
  else if (a === 'install-cancel') await api.ringInstallCancel();
  else if (a === 'privacy') { await api.ringPrivacy(); return; }
  else if (a === 'writer') { await api.ringSetWriter(el.dataset.id); }
  else if (a === 'writer-install' || a === 'writer-signin') {
    const W = ring.writerSetup ||= {};
    W.busy = el.dataset.id; W.error = null; W.progress = null;
    await renderRing();
    try { await (a === 'writer-install' ? api.ringWriterInstall(el.dataset.id) : api.ringWriterSignIn(el.dataset.id)); }
    catch (e) { W.error = e.message; }
    finally { W.busy = null; }
  }
  else if (a === 'voice-start') {
    const V = ring.voice;
    const mic = document.querySelector('#ring-voice-mic');
    Object.assign(V, {running: true, elapsed: 0, level: 0, error: null, result: null});
    await renderRing();
    try { await api.ringVoiceEnroll({device: mic?.value ? Number(mic.value) : undefined, seconds: V.seconds}); }
    catch (err) { V.running = false; V.error = err.message; }
  }
  else if (a === 'voice-delete') { ring.voice.status = await api.ringVoiceDelete(); ring.voice.result = null; }
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
  else if (a === 'phone-start') { ring.phoneBusy = true; await renderRing(); try { ring.phone = await api.ringPhoneStart(); } finally { ring.phoneBusy = false; } }
  else if (a === 'phone-pair') { ring.pair = null; ring.pairError = null; try { ring.pair = await api.ringPhonePair(); } catch (e) { ring.pairError = e.message; } }
  else if (a === 'copy-pair') await api.copy?.(ring.pair.url);
  else if (a === 'live-start') {
    const L = ring.live, mic = document.querySelector('#ring-mic');
    L.device = mic && mic.value !== '' ? Number(mic.value) : null;
    L.source = document.querySelector('#ring-source')?.value || 'mikrofon';
    L.output = document.querySelector('#ring-output')?.value || '';
    L.training = !!document.querySelector('#ring-train')?.checked;
    Object.assign(L, {decisions: [], written: [], passed: 0, synth: null, error: null, ara: '', on: true});
    await api.ringLiveStart({device: L.device, training: L.training, source: L.source, output: L.output});
  }
  else if (a === 'live-stop') await api.ringLiveStop();
  else if (a === 'package') {
    ring.pkg = {durum: 'basladi'}; await renderRing();
    try { const r = await api.ringPackage(); if (r) ring.result = {packaged: r.target, size: r.size}; }
    finally { if (ring.pkg?.durum !== 'hata') ring.pkg = null; }
  }
  await renderRing();
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
    const opts = micOptions(L.devices, L.device);
    const sy = L.synth;
    const sum = !sy ? '' : sy.durum === 'basladi' ? `<div class="health-row"><div><span>${t('Writing the note', 'Not yazılıyor')}</span><p>${sy.aktarilan} ${t('sentences', 'cümle')}</p></div></div>`
      : sy.durum === 'bitti' ? `<div class="health-row"><div><span>${t('Written to memory', 'Hafızaya yazıldı')}</span><p class="path">${esc(sy.not)}</p><p>${sy.hatirlatici} ${t('reminders', 'hatırlatıcı')}${sy.gereksiz ? ` · ${sy.gereksiz} ${t('passed sentences judged noise', 'aktarılan cümle gereksiz bulundu')}` : ''}</p></div></div>`
      : sy.durum === 'hata' ? `<div class="health-row health-warn"><div><span>${t('The note could not be written', 'Not yazılamadı')}</span><p>${esc(sy.mesaj)}</p><p class="path">${esc(sy.oturum || '')}</p></div></div>`
      : `<p class="subtle">${t('Nothing worth a note was heard.', 'Not değerinde bir şey duyulmadı.')}</p>`;
    return `<section class="ring-live card"><div class="toolbar"><h2>${t('Listen live', 'Canlı dinle')}</h2></div>
    ${sourceFields(L, opts)}
    <label class="check" ${s.full ? 'hidden' : ''}><input type="checkbox" id="ring-train" ${L.training ? 'checked' : ''}> ${t('Keep the text of non-private sentences on this computer to train the next model', 'Mahrem olmayan cümlelerin metnini sonraki modeli eğitmek için bu bilgisayarda sakla')}</label>
    ${L.error ? `<div class="health-row health-warn"><div><span>${t('Stopped', 'Durdu')}</span><p>${esc(L.error)}</p></div></div>` : ''}${sum}
    <div class="actions"><span class="subtle">${t('Let people know you are taking notes.', 'Not aldığını söyle.')}</span>${rbtn('Start listening', 'Dinlemeye başla', 'live-start', true, '', MIC_ICON)}</div></section>`;
  }
  const written = L.written.slice().reverse().map(w => `<li><time>${esc(w.saat)}</time><span>${esc(w.metin)}</span><small>${w.neden === 'komsu' ? t('context', 'bağlam') : ''}</small></li>`).join('');
  return `<section class="ring-live card" data-on="true"><div class="toolbar"><h2>${t('Listening', 'Dinleniyor')} <span class="ring-rec">● ${t('REC', 'KAYIT')}</span></h2><span class="subtle" id="ring-live-state">${t('Listening', 'Dinliyor')}</span>${rbtn('Stop', 'Durdur', 'live-stop', true, '', STOP_ICON)}</div>
  <div class="ring-level-track"><div id="ring-level"></div></div>
  <p class="ring-ara" id="ring-ara">${esc(L.ara || '')}</p>
  ${L.error ? `<div class="health-row health-warn"><div><span>${t('Error', 'Hata')}</span><p>${esc(L.error)}</p></div></div>` : ''}
  <div class="ring-two"><div><h2>${t('Heard', 'Duyulan')}</h2><ul class="ring-decs">${decisions || `<li class="subtle">${t('Loading models, then waiting for speech…', 'Modeller yükleniyor, sonra konuşma bekleniyor…')}</li>`}</ul></div>
  <div><h2>${t('Going to the note writer', 'Not yazıcısına gidecek')} <span class="subtle">${L.passed || 0}</span></h2><ul class="ring-written">${written || `<li class="subtle">${t('Nothing yet.', 'Henüz yok.')}</li>`}</ul></div></div></section>`;
}

// Where the sound comes from. "Computer audio" is what the speakers play (a Zoom or Meet call, a video),
// captured on this machine; "Meeting" adds your microphone so both sides are in the note.
function sourceFields(L, micOpts) {
  const outs = L.outputs || [];
  const src = outs.length ? L.source : 'mikrofon';
  const srcOpt = (v, en, tr) => `<option value="${v}" ${src === v ? 'selected' : ''}>${t(en, tr)}</option>`;
  const outOpts = outs.map(o => `<option value="${esc(o.ad)}" ${(L.output ? L.output === o.ad : o.onerilen) ? 'selected' : ''}>${esc(o.ad)}${o.onerilen ? ' · ' + t('recommended', 'önerilen') : ''}</option>`).join('');
  const source = outs.length ? `<div><label for="ring-source">${t('Sound source', 'Ses kaynağı')}</label><select id="ring-source" data-ring-change="source">
      ${srcOpt('mikrofon', 'Microphone (people around you)', 'Mikrofon (çevrendeki konuşma)')}
      ${srcOpt('ikisi', 'Meeting: computer audio + microphone', 'Toplantı: bilgisayar sesi + mikrofon')}
      ${srcOpt('sistem', 'Computer audio only (Zoom, Meet, video)', 'Yalnız bilgisayar sesi (Zoom, Meet, video)')}</select></div>` : '';
  const mic = src === 'sistem' ? '' : `<div><label for="ring-mic">${t('Microphone', 'Mikrofon')}</label><select id="ring-mic">${micOpts || `<option value="">${t('Default', 'Varsayılan')}</option>`}</select></div>`;
  const out = src === 'mikrofon' ? '' : `<div><label for="ring-output">${t('Computer audio from', 'Bilgisayar sesi')}</label><select id="ring-output">${outOpts}</select></div>`;
  const hint = src === 'ikisi' ? `<p class="subtle">${t('Use headphones.', 'Kulaklık kullan.')}</p>` : '';
  return `<div class="ring-fields ring-live-fields">${source}${mic}${out}</div>${hint}`;
}

const OKUMA_METNI = ['Sabah derse biraz geç kaldım; hoca konuyu anlatmaya başlamıştı bile. Arka sıraya oturup defterimi açtım ve tahtadaki şekli hızlıca çizdim.',
  'Öğle arasında Deniz\'le kantinde buluştuk, hafta sonu için küçük bir plan yaptık. Akşam eve dönerken hem ödevimi hem de yarınki sunumu düşündüm.',
  'Unutmamak için kendime not aldım: perşembe saat üçte proje toplantısı var.'];

function voiceCard(s) {
  if (!s.full) return '';
  const V = ring.voice, st = V.status;
  const head = `<div class="toolbar"><h2>${t('Your voice', 'Sesin')}</h2><span class="subtle">${st?.enrolled ? `${t('enrolled', 'tanıtıldı')} · ${esc(String(st.created || '').slice(0, 10))} · ${st.seconds} ${t('s of speech', 'sn konuşma')}` : t('not enrolled', 'tanıtılmadı')}</span></div>`;
  if (V.running) {
    return `<section class="ring-voice card">${head}<blockquote class="ring-okuma">${OKUMA_METNI.map(p => `<p>${esc(p)}</p>`).join('')}</blockquote>
    <div class="progress-title"><span>${t('Read aloud', 'Sesli oku')}</span><span id="ring-voice-sec">${clock(V.elapsed)} / ${clock(V.seconds)}</span></div>
    <div class="ring-level-track"><div id="ring-voice-bar" style="width:${Math.round(V.elapsed / V.seconds * 100)}%"></div></div>
    <div class="ring-level-track ring-voice-level"><div id="ring-voice-level"></div></div>
    </section>`;
  }
  const opts = micOptions(ring.live.devices);
  const res = V.result ? `<div class="health-row"><div><span>${t('Voice enrolled', 'Sesin tanındı')}</span><p>${V.result.konusma_sn} ${t('s of speech', 'sn konuşma')} · ${t('consistency', 'tutarlılık')} ${Math.round((V.result.tutarlilik || 0) * 100)}</p></div></div>` : '';
  const err = V.error ? `<div class="health-row health-warn"><div><span>${t('Not enrolled', 'Tanıtılamadı')}</span><p>${esc(V.error)}</p></div></div>` : '';
  return `<section class="ring-voice card">${head}${res}${err}
  <div class="ring-fields ring-live-fields"><div><label for="ring-voice-mic">${t('Microphone', 'Mikrofon')}</label><select id="ring-voice-mic">${opts || `<option value="">${t('Default', 'Varsayılan')}</option>`}</select></div></div>
  <div class="actions"><span class="subtle">~25 ${t('s', 'sn')}</span>
  <div class="row">${st?.enrolled ? rbtn('Delete voiceprint', 'Ses izini sil', 'voice-delete') : ''}${rbtn(st?.enrolled ? 'Enroll again' : 'Enroll my voice', st?.enrolled ? 'Yeniden tanıt' : 'Sesimi tanıt', 'voice-start', true)}</div></div></section>`;
}

function writerPicker(s) {
  const w = s.writers;
  if (!s.full || !w) return '';
  const chips = w.list.map(x => `<button data-ring="writer" data-id="${esc(x.id)}" class="${x.id === w.chosen ? 'primary' : ''}" ${x.installed ? '' : 'disabled'} title="${x.installed ? '' : esc(t('Not installed on this computer', 'Bu bilgisayarda kurulu değil'))}">${esc(x.name)}</button>`).join('');
  const waiting = w.approval === 'bekliyor' ? `<p class="subtle">${t('Waiting for approval', 'Onay bekliyor')}</p>` : '';
  const none = !w.list.some(x => x.installed) ? `<p class="subtle">${t('Not connected to the cloud', 'Buluta bağlı değil')}</p>` : '';
  // 1.7.0: a writer that is not ready gets its next step as one button: install, then sign in.
  const W = ring.writerSetup || {}, st = W.status || {};
  const setup = w.list.filter(x => !x.installed && st[x.id]).map(x => {
    const need = st[x.id].installed ? 'writer-signin' : 'writer-install';
    const label = need === 'writer-install' ? t(`Install ${x.name}`, `${x.name}'yi kur`) : t(`Sign in to ${x.name}`, `${x.name} girişi`);
    const pct = W.progress?.id === x.id && W.progress.toplam ? ` · %${Math.round(100 * W.progress.indirilen / W.progress.toplam)}` : '';
    return `<button data-ring="${need}" data-id="${esc(x.id)}" ${W.busy ? 'disabled' : ''}>${esc(label)}${W.busy === x.id ? esc(pct || ' …') : ''}</button>`;
  }).join('');
  const setupRow = setup ? `<div class="row">${setup}</div>` : '';
  const err = W.error ? `<p class="subtle">${esc(W.error)}</p>` : '';
  return `<div class="ring-writer"><span>${t('Note written by', 'Notu yazan')}</span><div class="row">${chips}</div>${setupRow}${err}${waiting}${none}</div>`;
}

function engineLine(s) {
  if (s.full) return `<div class="ring-engine"><div><i>●</i><em>Whisper large-v3-turbo</em></div></div>${writerPicker(s)}`;
  const tr = s.training;
  const model = s.checks.tuned ? `${esc(s.model)}${tr?.tarih ? ` · ${t('trained', 'eğitildi')} ${esc(tr.tarih.slice(0, 10))}` : ''}` : 'Laya multilingual';
  return `<div class="ring-engine"><div><i>●</i><em>Whisper large-v3-turbo</em></div><div><i>●</i><em>${model}</em></div><div><span>${t('Offline · models on this computer', 'Çevrimdışı · modeller bu bilgisayarda')}</span></div></div>`;
}

const INSTALL_STEPS = {
  motor: ['Engine package, signature checked', 'Motor paketi, imzası denetlenerek'], uv: ['Installer (uv)', 'Kurucu (uv)'], python: ['Python 3.12', 'Python 3.12'],
  kutuphane: ['Libraries', 'Kütüphaneler'], whisper: ['Whisper model (1.6 GB)', 'Whisper modeli (1,6 GB)'], konusmaci: ['Speaker model (28 MB)', 'Konuşmacı modeli (28 MB)'],
  tunel: ['Connection tool (cloudflared)', 'Bağlantı aracı (cloudflared)'], dogrulama: ['Loading the model once', 'Modeli bir kez yükleme'],
  kayit: ['Registering with the Claudian cloud', 'Claudian bulutuna kayıt'], servis: ['Starting the engine', 'Motoru başlatma'],
};
const gb = n => `${(n / 1073741824).toFixed(1).replace('.', t('.', ','))} GB`;
const mb = n => `${Math.round(n / 1048576)} MB`;

function installProgress() {
  const ev = ring.install.ev || {};
  const order = ev.adimlar || Object.keys(INSTALL_STEPS);
  const at = order.indexOf(ev.adim);
  return order.map((k, i) => {
    const state = ev.adim === 'bitti' || i < at ? 'done' : i === at ? 'running' : '';
    let detail = '';
    if (i === at && ev.indirilen && ev.toplam) detail = `%${Math.floor(ev.indirilen / ev.toplam * 100)} · ${mb(ev.indirilen)} / ${mb(ev.toplam)}`;
    else if (i === at && ev.indirilen) detail = mb(ev.indirilen);
    else if (i === at && ev.satir) detail = esc(ev.satir);
    return `<div class="stage ${state}"><b>${state === 'done' ? '✓' : state === 'running' ? '●' : '○'}</b>${t(...INSTALL_STEPS[k] || [k, k])}${detail ? ` · ${detail}` : ''}</div>`;
  }).join('');
}

// Hanne's 0.30.0 showed a path that only exists on Boran's computer and a button that only looked for an engine.
// 1.1.0: one button installs it where this user can write; the old button stays for an engine that is already here.
function setupNeeded(s) {
  const I = ring.install, p = I.plan;
  const head = `<h2>${t('Install the engine', 'Motoru kur')}</h2>`;
  if (I.running) {
    return `<section class="card">${head}<div id="ring-install-progress">${installProgress()}</div>
    <div class="actions">${rbtn('Pause', 'Duraklat', 'install-cancel')}</div></section>`;
  }
  const facts = p ? [p.gpu ? esc(p.gpu) : t('No NVIDIA card · slower', 'NVIDIA kartı yok · daha yavaş'), p.free !== null ? `${gb(p.free)} ${t('free', 'boş')} · ${gb(p.need)} ${t('needed', 'gerekli')}` : ''].filter(Boolean) : [];
  const blocked = p?.forbidden || (p && !p.enough);
  const warn = p?.forbidden ? `<div class="health-row health-warn"><div><span>${t('Cannot install here', 'Buraya kurulamaz')}</span><p>${esc(p.forbidden)}</p></div></div>`
    : p && !p.enough ? `<div class="health-row health-warn"><div><span>${t('Not enough space', 'Yer yetmiyor')}</span></div></div>` : '';
  const err = I.error ? `<div class="health-row health-warn"><div><span>${t('Installation stopped', 'Kurulum durdu')}</span><p>${esc(I.error)}</p></div></div>` : '';
  const label = p?.resumable ? ['Continue', 'Sürdür'] : ['Install', 'Kur'];
  return `<section class="card">${head}${facts.length ? `<p class="subtle">${facts.join(' · ')}</p>` : ''}${warn}${err}
  <div class="row">${rbtn(label[0], label[1], 'install', true, blocked ? 'disabled' : '')}${rbtn('Install from a folder', 'Klasörden kur', 'choose-engine')}</div></section>`;
}

function installDone() {
  const r = ring.install.result;
  if (!r) return '';
  const device = r.device === 'cuda' ? 'GPU' : 'CPU';
  const approval = r.approval === 'onayli' ? t('approved', 'onaylı') : t('waiting for approval', 'onay bekliyor');
  return `<div class="health-row"><div><span>${t('Engine installed', 'Motor kuruldu')}</span><p>${device} · ${approval}</p></div></div>`;
}

function newRecording() {
  if (!ring.file) return `<div class="ring-drop"><p><span class="subtle">mp3 · m4a · wav · ogg · flac</span></p>${rbtn('Choose audio file', 'Ses dosyası seç', 'choose-audio', true)}</div>`;
  const f = ring.file, title = f.name.replace(/\.[^.]+$/, '');
  return `<section class="ring-form"><div class="toolbar"><h2>${esc(f.name)}</h2><span class="subtle">${(f.size / 1048576).toFixed(1)} MB</span>${rbtn('Change', 'Değiştir', 'clear-file')}</div>
  <div class="ring-fields"><div><label for="ring-title">${t('Title', 'Başlık')}</label><input id="ring-title" maxlength="80" value="${esc(title)}"></div>
  <div><label for="ring-start">${t('Recording started', 'Kaydın başladığı an')}</label><input id="ring-start" type="datetime-local" value="${localStamp(f.modified).replace(' ', 'T')}"></div>
  <div><label for="ring-lang">${t('Language', 'Dil')}</label><select id="ring-lang"><option value="">${t('Detect', 'Otomatik')}</option><option value="tr">Türkçe</option><option value="en">English</option></select></div></div>
  <label class="check" ${ring.status?.full ? 'hidden' : ''}><input type="checkbox" id="ring-audit"> ${t('Audit mode — also keep the text of dropped sentences, so you can rescue them and teach the model', 'Denetim modu — atılan cümlelerin metnini de sakla; yanlışlıkla atılanı kurtarıp modele öğretebilirsin')}</label>
  <div class="actions">${rbtn('Extract notes', 'Notu çıkar', 'run', true)}</div></section>`;
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
    <div class="actions">${rbtn('Stop', 'Durdur', 'cancel')}</div>`;
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
  <div class="actions">${rbtn('Stop', 'Durdur', 'cancel')}</div>`;
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
  `;
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
  void via;
  const head = `<h2>${t('Phone', 'Telefon')}</h2>`;
  if (!ring.status?.ready) return `<div class="card">${head}<p class="subtle">${t('Install the engine first', 'Önce motoru kur')}</p></div>`;
  if (!p?.capable) return `<div class="card">${head}<p class="subtle">${t('Update the engine', 'Motoru güncelle')}</p></div>`;
  const state = p.running
    ? `<p class="subtle">${t('Server running', 'Sunucu açık')} · ${esc(p.origin.replace('https://', ''))}${p.speakers ? ` · ${t('speakers told apart', 'konuşmacılar ayrılıyor')}` : ''}${p.voiceprint ? ` · ${t('your voice enrolled', 'sesin tanıtıldı')}` : ''}${p.queued ? ` · ${p.queued} ${t('in queue', 'sırada')}` : ''}</p>`
    : `<p class="subtle">${t('Server closed', 'Sunucu kapalı')}</p>${ring.phoneBusy ? `<p class="subtle">${t('Starting…', 'Başlatılıyor…')}</p>` : rbtn('Start server', 'Sunucuyu başlat', 'phone-start', true)}`;
  const pair = ring.pair
    ? `<div class="ring-pair"><div class="ring-qr" aria-label="${t('Pairing QR code', 'Eşleştirme QR kodu')}">${ring.pair.qr}</div><div><div class="ring-addr">${esc(ring.pair.url)}</div><p class="subtle">${t('Code', 'Kod')}: <b>${esc(ring.pair.code)}</b> · ${t('valid 24 hours, once', '24 saat, bir kez geçerli')}</p><div class="row">${rbtn('Copy address', 'Adresi kopyala', 'copy-pair')}</div></div></div>`
    : (p.running ? rbtn('Pair a phone', 'Telefonu bağla', 'phone-pair', true) : '');
  const err = ring.pairError ? `<p class="subtle">${esc(ring.pairError)}</p>` : '';
  const pl = ring.phoneLive;
  const since = iso => { if (!iso) return t('never', 'hiç'); const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? t('just now', 'şimdi') : m < 60 ? `${m} ${t('min ago', 'dk önce')}` : dayStamp(iso); };
  const jobLabel = d => ({teslim: t('in Obsidian', 'Obsidian’da'), hazir: t('ready', 'hazır'), isleniyor: t('processing', 'işleniyor'), sirada: t('queued', 'sırada'), hata: t('error', 'hata')}[d] || d);
  const liveList = !pl ? '' : `<div class="ring-two ring-phone-live"><div><h2>${t('Connected phones', 'Bağlı telefonlar')}</h2><ul class="file-list">${pl.cihazlar.map(c => `<li>${esc(c.ad || t('Phone', 'Telefon'))} · ${t('seen', 'görüldü')} ${since(c.son_gorulme)}</li>`).join('') || `<li>${t('None yet', 'Henüz yok')}</li>`}</ul></div>
    <div><h2>${t('Recent recordings', 'Son kayıtlar')}</h2><ul class="file-list">${pl.isler.map(j => `<li>${dayStamp(j.olusturuldu)} · ${j.ses_sn ? `${Math.max(1, Math.round(j.ses_sn / 60))} ${t('min', 'dk')} · ` : ''}${jobLabel(j.durum)}${j.yazici ? ` · ${esc({codex: 'ChatGPT', claude: 'Claude', gemini: 'Gemini'}[j.yazici] || j.yazici)}` : ''}</li>`).join('') || `<li>${t('None yet', 'Henüz yok')}</li>`}</ul>
    <p class="subtle">${t('Cloud heartbeat', 'Bulut nabzı')}: ${since(pl.son_nabiz)}</p></div></div>`;
  const waiting = p.approval === 'bekliyor' ? `<p class="subtle">${t('Waiting for approval', 'Onay bekliyor')}</p>` : '';
  const privacy = `<p class="subtle"><button class="link" data-ring="privacy">${t('Privacy', 'Gizlilik')}</button></p>`;
  return `<div class="card ring-phone">${head}${state}${waiting}${liveList}${pair}${err}${privacy}</div>`;
}

function pkgProgress() {
  const k = ring.pkg || {};
  if (k.durum === 'hata') return `<div class="health-row health-warn"><div><span>${t('Package stopped', 'Paket durdu')}</span><p>${esc(k.mesaj || '')}</p></div></div>`;
  const pct = k.indirilen && k.toplam ? ` · %${Math.floor(k.indirilen / k.toplam * 100)}` : '';
  return `<div class="stage running"><b>●</b>${esc(k.dosya || t('Preparing', 'Hazırlanıyor'))}${k.kaynaktan ? ` · ${t('copied', 'kopyalandı')}` : pct}</div>`;
}

function devices(s) {
  void s;
  const pkg = ring.pkg ? `<div id="ring-pkg">${pkgProgress()}</div>` : rbtn('Prepare package', 'Kurulum paketini hazırla', 'package');
  return `<section class="panel-section"><h2>${t('Other devices', 'Diğer cihazlar')}</h2>
  ${phoneCard()}<div class="ring-two"><div class="card"><h2>${t('Another computer', 'Başka bir bilgisayar')}</h2>
  <p class="subtle">${t('USB or folder · ~2 GB · installer, engine and models', 'USB ya da klasör · ~2 GB · kurulum, motor ve modeller')}</p>${pkg}</div></div></section>`;
}

async function renderRing() {
  ringBind();
  ring.status = await api.ringStatus();
  (ring.writerSetup ||= {}).status = await api.ringWriterSetup?.().catch(() => null) ?? null;
  ring.phone = await api.ringPhoneStatus?.().catch(() => null) ?? null;
  ring.phoneLive = ring.phone?.cloud ? await api.ringPhoneLive?.().catch(() => null) ?? null : null;
  if (!ring.voice.running) ring.voice.status = await api.ringVoiceStatus?.().catch(() => null) ?? null;
  if (ring.status.running && !ring.running) ring.running = {file: ring.status.running.file, events: ring.status.running.events, started: Date.now()};
  ring.drafts = ring.status.ready ? await api.ringDrafts() : [];
  if (ring.openId && !ring.open) ring.open = await api.ringDraft(ring.openId).catch(() => null);
  const s = ring.status;
  let body = `<h1>${t('Ring', 'Yüzük')}</h1>`;
  if (!s.ready) {
    if (!ring.install.plan && !ring.install.running) ring.install.plan = await api.ringInstallPlan?.().catch(() => null) ?? null;
    if (ring.install.plan?.running) ring.install.running = true;
    content.innerHTML = body + setupNeeded(s) + phoneCard();
    return;
  }
  body += installDone() + engineLine(s);
  if (s.liveCapable && ring.live.devices === null) ring.live.devices = await api.ringDevices().catch(() => []);
  if (s.liveCapable && ring.live.outputs === null) ring.live.outputs = await api.ringOutputs?.().catch(() => []) || [];
  if (s.live && !ring.live.on) Object.assign(ring.live, {on: true, passed: s.live.passed, decisions: s.live.last || []});
  body += liveCard(s);
  body += voiceCard(s);
  if (ring.result?.error) body += `<div id="ring-error" class="health-row health-warn"><div><span>${t('Stopped', 'Durdu')}</span><p>${esc(ring.result.error)}</p></div></div>`;
  if (ring.result?.approved) body += `<div class="health-row"><div><span>${t('Written to memory', 'Hafızaya yazıldı')}</span><p class="path">${esc(ring.result.approved.note)}</p><p>${ring.result.approved.reminders.length} ${t('reminders added', 'hatırlatıcı eklendi')} · ${ring.result.approved.corrected} ${t('corrections saved for training', 'düzeltme eğitim için saklandı')}</p></div></div>`;
  if (ring.result?.written) body += ring.result.written.bos
    ? `<div class="health-row"><div><span>${t('No note', 'Not yok')}</span><p>${t('No speech worth a note was found in the recording.', 'Kayıtta not değerinde konuşma bulunamadı.')}</p></div></div>`
    : `<div class="health-row"><div><span>${t('Written to memory', 'Hafızaya yazıldı')}</span><p class="path">${esc(ring.result.written.not)}</p><p>${ring.result.written.hatirlatici || 0} ${t('reminders added', 'hatırlatıcı eklendi')}</p></div></div>`;
  if (ring.result?.packaged) body += `<div class="health-row"><div><span>${t('Package ready', 'Paket hazır')}</span><p class="path">${esc(ring.result.packaged)}</p><p class="subtle">${t('On the other computer: Claudian-Setup, then Yüzük → Install from a folder', 'Diğer bilgisayarda: Claudian-Setup, sonra Yüzük → Klasörden kur')}</p></div></div>`;
  if (ring.running) body += `<section class="ring-block">${runningView()}</section>`;
  else if (ring.open) body += `<section class="ring-block">${reviewView(ring.open)}</section>`;
  else body += `<section class="ring-block"><h2>${t('Process a recording', 'Kaydı işle')}</h2>${newRecording()}</section>`;
  content.innerHTML = body + history() + devices(s);
}
window.renderRing = renderRing;
// Keep the running clock honest while a job is active; no animation, only the elapsed time.
setInterval(() => { if (view === 'ring' && ring.running) { const el = document.querySelector('.progress-title span:last-child'); if (el) el.textContent = clock((Date.now() - ring.running.started) / 1000); } }, 1000);
