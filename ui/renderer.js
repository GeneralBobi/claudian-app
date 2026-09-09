'use strict';
const api = window.claudian, content = document.querySelector('#content'), errorBox = document.querySelector('#error');
const setup = document.body.dataset.surface === 'setup';
let state, discovery, draft, plan, busy = false, complete = false, events = [], view = 'home', prompt;
const checkIcon = '<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17 4 12"/></svg>';
const labels = { 'claude-code': 'Claude Code', codex: 'Codex' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const btn = (text, action, primary = false, extra = '') => `<button data-action="${action}" class="${primary ? 'primary' : ''}" ${extra}>${text}</button>`;
function error(e) { errorBox.textContent = e.message; errorBox.hidden = false; }
function capture() {
  if (!document.querySelector('#name')) return;
  draft.name = document.querySelector('#name').value;
  draft.vault = document.querySelector('#vault').value;
  draft.mode = document.querySelector('#mode').value;
  draft.storage = document.querySelector('#storage').value;
  draft.hosts = [...document.querySelectorAll('[name=host]:checked')].map(x => x.value);
}
function renderSetup() {
  if (complete) {
    content.innerHTML = `<div class="success-mark">${checkIcon}</div><h1>Kurulum tamamlandı.</h1><p>Hafıza ortamın ve seçtiğin AI bağlantıları hazır.<br>Claudian’ı açarak bağlantı testini tamamlayabilirsin.</p><div class="summary"><div class="summary-row"><div>Not ortamı<small>${esc(state.profile.vault)}</small></div><span class="tag">HAZIR</span></div><div class="summary-row"><div>${state.profile.hosts.map(h => esc(h.label)).join(' · ')}</div><span class="tag">SKILL HAZIR</span></div></div><p class="note">Sonraki açılışta bu kurulum ekranı atlanır. AI erişim izinleri, uygulama içinde ayrıca doğrulanır.</p><div class="actions">${btn('Günlüğü aç', 'logs')}${btn('Claudian’ı aç →', 'enter', true)}</div>`;
    return;
  }
  if (busy || events.length) {
    const stages = [['prepare','Kurulum alanını kontrol et'],['notes','Not ortamını hazırla'],['skills','AI bağlantılarını kur'],['verify','Kurulumu doğrula']];
    const done = stages.filter(([s]) => events.some(e => e.stage === s && e.status === 'done')).length;
    content.innerHTML = `<h1>Claudian kuruluyor.</h1><p>Bu yalnızca ilk açılışta yapılır. Gerekli dosyalar hazırlanıyor ve bağlantılar yapılandırılıyor.</p><div class="progress-title"><span>${done} / 4 adım tamamlandı</span><span>%${done * 25}</span></div><progress value="${done}" max="4" aria-label="Kurulum ilerlemesi"></progress>${stages.map(([id, title]) => { const e = [...events].reverse().find(e => e.stage === id); return `<div class="stage ${e?.status || ''}"><b>${e?.status === 'done' ? checkIcon : '—'}</b>${title}<time>${e ? (e.durationMs / 1000).toFixed(1) + ' sn' : 'Bekliyor'}</time></div>`; }).join('')}<details ${!busy ? 'open' : ''}><summary>Ayrıntıları göster</summary><pre>${events.map(e => `${e.time.slice(11,19)}  ${esc(e.message)}`).join('\n')}</pre></details><div class="actions">${btn('Günlük klasörü', 'logs')}${busy ? btn('İptal et', 'cancel') : btn('Yeniden dene', 'retry', true)}</div>`;
    return;
  }
  if (plan) {
    content.innerHTML = `<h1>Kuruluma hazır.</h1><p>Bu dosyalar hazırlanacak. Mevcut notlar ve AI ayarları korunur.</p><details><summary>Oluşturulacak ${plan.files.length} dosyayı incele</summary><ul class="file-list">${plan.files.map(f => `<li>${esc(f.path)}</li>`).join('')}</ul></details><div class="summary"><div class="summary-row"><div>${draft.mode === 'existing' ? 'Mevcut hafıza' : 'Yeni hafıza'}<small>${esc(draft.vault)}</small></div><span class="tag">YEREL</span></div><div class="summary-row"><div>${draft.hosts.map(h => labels[h]).join(' · ')}</div><span class="tag">HAZIRLANACAK</span></div></div><p class="note">Claudian API anahtarı istemez. AI’ın okuduğu notlar, seçtiğin sağlayıcının koşullarına tabidir.</p><div class="actions">${btn('Geri', 'back')}${btn('Kurulumu başlat →', 'install', true)}</div>`;
    return;
  }
  const found = draft.hosts.map(h => labels[h]).join(' · ');
  content.innerHTML = `<h1>Claudian’ı hazırlayalım.</h1><p>Bu bilgisayardaki ortamı kontrol ettik. Önerilen ayarlarla devam edebilir veya ayrıntıları değiştirebilirsin.</p><div class="summary"><div class="summary-row"><div>${draft.mode === 'existing' ? 'Mevcut not ortamı bulundu' : 'Yeni hafıza klasörü'}<small>${esc(draft.vault)}</small></div><span class="tag">${draft.mode === 'existing' ? 'BULUNDU' : 'ÖNERİLEN'}</span></div><div class="summary-row"><div>${found || 'AI bağlantısı seçilmeli'}<small>${found ? 'Ayar klasörleri bulundu; erişim kurulumdan sonra doğrulanır.' : 'Aşağıdaki ayarlardan kullandığın AI uygulamasını seç.'}</small></div><span class="tag">${found ? 'TESPİT EDİLDİ' : 'SEÇİM GEREKLİ'}</span></div></div><details id="settings" ${found ? '' : 'open'}><summary>Ayarları değiştir</summary><div class="grid"><div><label for="name">Adın</label><input id="name" type="text" value="${esc(draft.name)}" maxlength="100"></div><div><label for="storage">Not ortamı</label><select id="storage"><option value="markdown" ${draft.storage === 'markdown' ? 'selected' : ''}>Markdown</option><option value="obsidian" ${draft.storage === 'obsidian' ? 'selected' : ''}>Obsidian</option></select></div></div><label for="vault">Not klasörü</label><div class="row"><input id="vault" type="text" value="${esc(draft.vault)}">${btn('Değiştir', 'folder')}</div><label for="mode">Klasör kullanımı</label><select id="mode"><option value="new" ${draft.mode === 'new' ? 'selected' : ''}>Yeni / boş klasör</option><option value="existing" ${draft.mode === 'existing' ? 'selected' : ''}>Mevcut notları koru</option></select>${state.hosts.map(h => `<label class="check"><input type="checkbox" name="host" value="${h.id}" ${draft.hosts.includes(h.id) ? 'checked' : ''}>${esc(h.label)}</label>`).join('')}</details><div class="actions"><span class="subtle">Yerel kurulum · Hesap gerekmez</span>${btn('Devam et →', 'preview', true)}</div>`;
}
async function renderPanel() {
  const p = state.profile;
  document.querySelectorAll('[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  if (view === 'companion') { content.innerHTML = `<section class="empty"><div class="caption">GELİŞTİRME AŞAMASINDA</div><div class="wordmark">claudian<span>.</span>app</div><h1>Bir asistandan, yol arkadaşına.</h1><p>Notlarını, zamanını ve değişen koşullarını birlikte anlayan; doğru anda yanında olan bir katman.</p><p>Bu sistem henüz hazır değil. Ortak hafıza bugün çalışıyor; yol arkadaşını bunun üzerine geliştiriyoruz.</p></section>`; return; }
  if (!p) { error(new Error('Hafıza kaydı bulunamadı; uygulamayı yeniden açın.')); return; }
  const connections = `<section class="card"><h2>AI bağlantıları</h2>${p.hosts.map(h => `<div class="connection"><div class="row"><div><strong>${esc(h.label)}</strong><span class="badge">${h.status === 'verified' ? 'Erişim testi geçti' : 'Skill hazır'}</span></div><div>${btn('Test yönergesi', 'challenge', false, `data-host="${h.id}"`)} ${btn('Yanıtı kontrol et', 'verify', false, `data-host="${h.id}"`)}</div></div></div>`).join('')}<p class="note">AI uygulamasını yeniden aç. Test yönergesini bir konuşmada çalıştır; ardından yanıtı kontrol et.</p>${prompt ? `<pre class="prompt">${esc(prompt.prompt)}</pre>${btn('Kopyala', 'copy')}` : ''}</section>`;
  content.innerHTML = `<h1>${view === 'home' ? 'Hafızan burada.' : 'Konuşmalar arasında süreklilik.'}</h1><p>Build your second brain. Keep it yours.</p>${connections}`;
  if (view === 'home') {
    let notes; try { notes = await api.activity(); } catch (e) { error(e); notes = []; }
    content.insertAdjacentHTML('beforeend', `<section class="card"><div class="row"><h2>Not ortamı</h2>${btn('Klasörü aç', 'vault')}</div><p class="note">${esc(p.vault)}</p>${notes.map(n => `<div class="note-row"><span>${esc(n.name)}</span><time>${new Date(n.modified).toLocaleDateString('tr-TR')}</time></div>`).join('')}<p class="note">Kök klasörde son değişen notlar. Sürüm geçmişi değildir.</p></section>`);
  }
}
function render() { return setup ? renderSetup() : renderPanel(); }
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]');
  if (nav) { view = nav.dataset.view; await render(); return; }
  const target = event.target.closest('[data-action]'); if (!target) return;
  target.disabled = true; errorBox.hidden = true;
  try {
    const action = target.dataset.action;
    if (action === 'folder') { capture(); const folder = await api.chooseFolder(); if (folder) { draft.vault = folder; draft.mode = 'existing'; } render(); document.querySelector('#settings').open = true; }
    if (action === 'preview') { capture(); plan = await api.prepare(draft); render(); }
    if (action === 'back' || action === 'retry') { plan = null; events = []; render(); }
    if (action === 'install') {
      busy = true; events = []; render();
      try { await api.install(plan.id); state = await api.snapshot(); complete = true; }
      finally { busy = false; render(); }
    }
    if (action === 'cancel') await api.cancel();
    if (action === 'enter') await api.enter();
    if (action === 'vault' || action === 'logs') await api.open(action);
    if (action === 'challenge') { prompt = await api.challenge(target.dataset.host); await render(); }
    if (action === 'verify') { const result = await api.verify(target.dataset.host); state = await api.snapshot(); await render(); if (!result.verified) throw new Error(result.message); }
    if (action === 'copy') { await api.copy(prompt.prompt); target.textContent = 'Kopyalandı'; }
  } catch (e) { error(e); } finally { if (target.isConnected) target.disabled = false; }
});
api.onProgress(e => { events.push(e); if (busy) { const open = document.querySelector('details')?.open; renderSetup(); if (open) document.querySelector('details').open = true; } });
(async () => { state = await api.snapshot(); if (setup) { discovery = await api.discover(); draft = discovery.suggested; } await render(); })().catch(error);
