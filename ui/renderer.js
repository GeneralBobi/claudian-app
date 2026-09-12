'use strict';
const api=window.claudian, content=document.querySelector('#content'), errorBox=document.querySelector('#error');
let challenge=null, verifyNotice='', verifyState='', firstScan=null, healthData=null, obsidianPresent=null, probeIssue='', cliReady={}, updateInfo=null, autoChallenge=false;
let state, draft, plan, language='en', extending=false, busy=false, complete=false, events=[], view='home', removing=null, notice='', companionData=null, companionIssue='';
const setup=document.body.dataset.surface==='setup';
let reviewing=false, reviewResult=null, selectedHosts=[], verifyRequest=0;
const t=(en,tr)=>language==='tr'?tr:en;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(en,tr,action,primary=false,extra='')=>`<button data-action="${action}" class="${primary?'primary':''}" ${extra}>${t(en,tr)}</button>`;
function error(e){errorBox.textContent=window.claudianError(e.message,language);errorBox.hidden=false;if(/skill.*zaten var/.test(e.message)){const host=state?.hosts.find(h=>e.message.startsWith(h.label+':'));if(host)errorBox.insertAdjacentHTML('beforeend',btn('Open existing skill →','Mevcut skill’i aç →','existing-skill',false,`data-host="${esc(host.id)}"`));}}
// Neyi onayladigini gostermeyen bir onay ekrani, onay degil bir dugmedir.
//
// 12.09.2026'ya kadar bu ekran "dosyalar yazilacak" diyordu ve not klasorunun tamamina
// Read+Edit+Write aliniyordu; kullaniciya kapsam hic sorulmuyor, verilen yetenekler hic
// gosterilmiyordu. Web tarafindaki izin ekrani bunu zaten dogru yapiyordu -- eksik olan
// indirilen uruntu.
function consentBlock(plan){
 if(!plan)return '';
 const caps=plan.capabilities||[];
 const open=caps.filter(c=>c.enabled);
 const row=c=>`<li><code>${esc(c.name)}</code> <span class="badge">${c.scope==='write'?t('writes','yazar'):t('reads','okur')}</span>${c.enabled?'':` <span class="badge">${t('not granted','verilmedi')}</span>`}</li>`;
 return `<section class="grant-consent"><h2>${t('What you are granting','Neyi onaylıyorsun')}</h2>`
  +`<p>${t('Folder','Klasör')}: <span class="path">${esc(plan.vault)}</span></p>`
  +`<p>${plan.access==='write'?t('This connection permits reading and writing notes.','Bu bağlantı notları okumaya ve yazmaya izin verir.'):t('This connection permits reading notes only. Existing permissions in your AI application remain separate.','Bu bağlantı yalnızca okumaya izin verir. AI uygulamasındaki mevcut izinler ayrıdır.')} ${t('Notes are stored locally. Content retrieved by your AI is sent to that provider under its account and privacy settings.','Notlar yerelde saklanır. AI tarafından okunan içerik, o sağlayıcının hesap ve gizlilik ayarları kapsamında iletilir.')}</p>`
  +`<details><summary>${t('Technical capabilities','Teknik yetenekler')} (${open.length}/${caps.length})</summary><ul class="caps">${caps.map(row).join('')}</ul></details>`
  +`</section>`;
}
function capture(){if(!draft)return;for(const k of ['name','vault','storage','mode','access']){const field=document.querySelector('#'+k);if(field)draft[k]=field.value;}draft.hosts=[...document.querySelectorAll('[name=host]:checked')].map(x=>x.value);draft.language=language;}
// Access is the difference between "files are installed" and "the AI can actually read
// them". Measured 11.09.2026: without it the host refuses the read and the model goes quiet.
// Installation is observable; model behaviour is not. The only honest proof is a real
// read/write round trip run inside the user's own AI, and it goes stale when the protocol
// changes. Measured 11.09.2026: the machinery existed but no screen could reach it.
// A memory that quietly stopped working looks exactly like a memory with nothing to say.
// This row is the difference: when the notes last actually changed, and how many
// connections have proven themselves inside the AI rather than merely on disk.
function healthRow(){
 // Order matters. A folder that is gone fails the write probe too, so checking the probe
 // first made this row unreachable and showed a raw ENOENT naming a temp file instead.
 if(healthData&&healthData.vaultMissing)return `<div class="health-row health-warn"><div><span>${t('Notes folder not found','Not klasörü bulunamadı')}</span><p>${t('This folder is no longer there. Nothing was deleted from this app; if you moved the folder, point Claudian at its new place.','Bu klasör artık yok. Bu uygulamadan hiçbir şey silinmedi; klasörü taşıdıysan Claudian’a yeni yerini göster.')}</p><p class="path">${esc(healthData.vault||'')}</p></div>${btn('Choose folder','Klasör seç','relocate',true)}${btn('Create it again','Yeniden oluştur','relocate-same')}<span id="relocate-status" role="status"></span></div>`;
 if(probeIssue)return `<div class="health-row health-warn"><div><span>${t('Notes folder','Not klasörü')}</span><p>${t('Claudian cannot write to your notes folder right now.','Claudian şu an not klasörüne yazamıyor.')}</p><p class="path">${esc(probeIssue)}</p></div></div>`;
 if(!healthData)return '';
 // A notes folder that is gone used to surface as a raw ENOENT toast, or as nothing at
 // all. It is named here, with the two things a person can actually do about it.
 const {lastChange,hosts,verifiedCount}=healthData;
 const changed=lastChange?`${esc(lastChange.name)} · ${new Date(lastChange.at).toLocaleString(language==='tr'?'tr-TR':'en-GB')}`:t('No note has changed yet','Henüz hiçbir not değişmedi');
 const proven=hosts.length?`${verifiedCount}/${hosts.length}`:'0/0';
 const warn=hosts.length&&verifiedCount===0;
 const skipped=healthData.skippedAt&&!healthData.everVerified;
 return `<div class="health-row${warn?' health-warn':''}"><div><span>${t('Last change in your notes','Notlarında son değişiklik')}</span><p class="path">${changed}</p></div><div><span>${t('Connections proven in the AI','AI içinde kanıtlanan bağlantı')}</span><p class="path">${proven}</p></div>${warn?`<p>${skipped?t('Setup finished without proof. You skipped the check — run it in Connections whenever you are ready.','Kurulum kanıtsız bitti. Kontrolü atladın — hazır olduğunda Bağlantılar’dan çalıştır.'):t('Nothing has been proven yet. Open Connections and run the read/write check.','Henüz hiçbir şey kanıtlanmadı. Bağlantılar’ı aç ve okuma/yazma kontrolünü çalıştır.')}</p>`:''}</div>`;
}
// Dogrulama artik bir dugmeye basilarak sorulmuyor; uygulama yaniti kendisi bekliyor ve ne
// oldugunu soyluyor. Eski akista erken basilan "Sonucu kontrol et" dugmesi "AI henuz yanit
// dosyasini olusturmamis" diyordu -- bir ariza gibi okunan, aslinda "daha bitmedi" demek olan
// bir cumle.
function verifyStatus(){
 if(!verifyState)return verifyNotice?`<p role="status">${esc(verifyNotice)}</p>`:'';
 const say={ready:t('Test ready. Open the AI or copy the instruction to begin.','Test hazır. Başlamak için AI’ı aç veya yönergeyi kopyala.'),failed:verifyNotice,waiting:t('Waiting for the AI to answer…','AI’ın cevabı bekleniyor…'),
  writing:t('The answer is being written…','Yanıt yazılıyor…'),
  verified:t('Verified.','Doğrulandı.'),
  mismatch:verifyNotice||t('The answer did not match.','Yanıt eşleşmedi.'),
  timeout:verifyNotice||t('No answer arrived.','Yanıt gelmedi.')}[verifyState]||'';
 const live=verifyState==='waiting'||verifyState==='writing';
 const retry=(verifyState==='timeout'||verifyState==='mismatch'||verifyState==='failed')&&challenge;
 return `<p role="status" class="verify-status" data-state="${verifyState}">${live?'<span class="verify-spinner" aria-hidden="true"></span>':''}${esc(say)}</p>`
  +(retry?`<div class="toolbar">${btn('Wait again','Tekrar bekle','verify-run',false,`data-host="${challenge.host}"`)}</div>`:'');
}
// Doğrulama geçtikten sonra sıradaki adım: AI'ın bildiklerini bir kez gözden geçirip ilk
// notları yazması. Bu akış zaten yazılmıştı ve hiçbir düğme onu açmıyordu.
function firstScanRow(h){
 const info=(healthData?.hosts||[]).find(x=>x.id===h.id);
 if(!info||info.state!=='verified')return '';
 const open=firstScan&&firstScan.host===h.id;
 return `<div class="config-file verify-row" data-state="first-scan"><span>${t('First review','İlk tarama')}</span>`
  +`<span class="badge">${t('Let it read what it already knows and write the first notes','Bildiklerini bir kez gözden geçirip ilk notları yazsın')}</span>`
  +(open?`<pre class="prompt">${esc(firstScan.prompt)}</pre><div class="toolbar">`
     +(cliReady[h.id]?btn('Run it now','Şimdi çalıştır','run-scan',true,`data-host="${h.id}"`)
                     :btn('Copy instruction','Yönergeyi kopyala','copy-scan'))
     +btn('Close','Kapat','scan-close')+`</div>${notice?`<p role="status">${esc(notice)}</p>`:''}`
    :btn('Start the first review','İlk taramayı başlat','scan-open',false,`data-host="${h.id}"`))
  +'</div>';
}
function maintenanceRow(info){
 const m=info?.maintenance;
 if(!m)return `<div class="config-file"><span>${t('Continuous memory','Sürekli hafıza')}</span><span class="badge">${t('No conversation evidence yet','Henüz sohbet kanıtı yok')}</span></div>`;
 const label=m.pending?t('Review pending or missing','Kontrol bekliyor veya atlandı'):m.outcome==='UPDATED'?t('Write verified','Yazma doğrulandı'):m.outcome==='NO_OP'?t('AI reported no change needed','AI değişiklik gerekmediğini bildirdi'):t('Maintenance failed','Hafıza bakımı başarısız');
 const when=m.reviewedAt||m.startedAt;
 const gaps=m.failedTurns?`<p role="status">${esc(m.failedTurns)} ${t('earlier turns had missing or failed memory checks. A successful last turn does not close those gaps.','önceki turda hafıza kontrolü eksik veya başarısızdı. Son turun başarılı olması bu boşlukları kapatmaz.')}</p>`:'';
 return `<div class="config-file"><span>${t('Last conversation check','Son sohbet kontrolü')}</span><span class="badge">${esc(label)} · ${t('Turn','Tur')} ${esc(m.turn)} · ${esc(new Date(when).toLocaleString(language==='tr'?'tr-TR':'en-GB'))}</span><p>${t('This is evidence for the last observed turn. It does not guarantee that every future turn will be saved.','Bu, son gözlenen turdaki kanıttır. Gelecekteki her turun kaydedileceği garantisi değildir.')}</p>${gaps}</div>`;
}
function verifyRow(h){
 if(h.access?.state==='unavailable'||h.access?.scope==='read')return '';
 const info=(healthData?.hosts||[]).find(x=>x.id===h.id);
 const state=info?info.state:'unverified';
 const label={verified:t('Read/write verified','Okuma/yazma doğrulandı'),stale:t('Verified before an update — run it again','Güncellemeden önce doğrulandı — tekrar çalıştır'),unverified:t('Never verified in the AI','AI içinde hiç doğrulanmadı')}[state];
 const when=info?.verifiedAt?` · ${new Date(info.verifiedAt).toLocaleString(language==='tr'?'tr-TR':'en-GB')}`:'';
 const open=challenge&&challenge.host===h.id;
 return maintenanceRow(info)+`<div class="config-file verify-row" data-state="${state}"><span>${t('File access test','Dosya erişim testi')}</span><span class="badge">${esc(label)}${esc(when)}</span>
  ${open?`<p>${cliReady[h.id]?t('Run the test in your AI application. Approve its permission request if shown, then return here for the result.','Testi AI uygulamanda çalıştır. İzin sorarsa inceleyip onayla; sonuç burada beklenecek.'):t('Paste this into ','Şuraya yapıştır: ')+esc(h.label)+t('. The answer is awaited here; nothing else to press. There is no slash or @ command for this — the memory loads by itself at the start of a conversation.','. Yanıt burada bekleniyor, başka bir şeye basman gerekmiyor. Bunun için bir slash veya @ komutu yok — hafıza konuşmanın başında kendiliğinden yükleniyor.')}</p><pre class="prompt">${esc(challenge.prompt)}</pre><div class="toolbar">${cliReady[h.id]?btn('Run it now','Şimdi çalıştır','run-challenge',true,`data-host="${h.id}"`):btn('Copy instruction','Yönergeyi kopyala','copy-challenge')}${btn('Cancel','Vazgeç','challenge-close')}</div>${verifyStatus()}`
       :btn('Verify in the AI','AI içinde doğrula','challenge-start',state!=='verified',`data-host="${h.id}"`)}</div>`;
}
function accessRow(h){
 const a=h.access;
 if(h.hookTrust==='requires-host-review')return `<div class="config-file access-manual"><span>${t('Conversation checks','Sohbet kontrolleri')}</span><p>${t('Open /hooks in Codex and review the installed Claudian hooks. Codex will skip them until trusted. The conversation evidence above shows whether they have run.','Codex içinde /hooks açıp kurulan Claudian hook’larını incele ve güven onayı ver. Codex bu onaya kadar onları atlar. Yukarıdaki sohbet kanıtı çalışıp çalışmadıklarını gösterir.')}</p></div>`;
 if(!a) return '';
 if(a.state==='unavailable') return `<div class="config-file access-manual"><span>${t('Connection unavailable','Bağlantı henüz hazır değil')}</span><p>${esc(a.step)}</p></div>`;
 if(a.state==='manual') return `<div class="config-file access-manual"><span>${t('Folder access','Klasör erişimi')}</span><p>${t('One step is needed; this application’s permission format is not verified, so Claudian did not change it.','Tek adım gerekli; bu uygulamanın izin biçimi doğrulanmadığı için Claudian onu değiştirmedi.')}</p><p class="path">${esc(a.step)}</p></div>`;
 const label=a.state==='granted'?t('Granted during setup','Kurulumda verildi'):t('Already granted','Zaten vardı');
 return `<div class="config-file"><span>${t('Folder access','Klasör erişimi')}</span><span class="badge">${esc(label)}</span></div>`;
}
function header(){document.documentElement.lang=language;document.querySelector('header .caption').textContent='';const nav=document.querySelector('nav');if(nav){nav.hidden=extending;nav.innerHTML=`<button data-view="home">${t('Memory','Hafıza')}</button><button data-view="connections">${t('Connections','Bağlantılar')}</button><button data-view="companion">${t('Companion','Yol arkadaşı')} · <span class="development-label">${t('Under development','Geliştiriliyor')}</span></button><button data-view="settings">${t('Settings','Ayarlar')}</button>`;nav.querySelectorAll('button').forEach(n=>n.classList.toggle('active',n.dataset.view===view));}}
function renderSetup(){
 if(complete){content.innerHTML=`<h1>${t('One step left.','Bir adım kaldı.')}</h1><p>${t('Files are installed and folder access is configured. That is not yet proof that your AI reads them. Restart the application, then run the read/write check.','Dosyalar kuruldu ve klasör erişimi yapılandırıldı. Bu, AI’ının onları okuduğunun kanıtı değil. Uygulamayı yeniden başlat, sonra okuma/yazma kontrolünü çalıştır.')}</p><p class="path">${esc(state.profile.vault)}</p>${notice?`<p role="status">${esc(notice)}</p>`:''}<div class="actions">${btn('Open in Obsidian','Obsidian’da aç','obsidian')}${btn('Open folder','Klasörü aç','vault')}${btn('Change folder','Klasörü değiştir','relocate')}${btn('Verify in the AI','AI içinde doğrula','enter-verify',true)}${btn('Skip for now','Şimdilik atla','skip-verify')}</div>`;return;}
 if(busy||events.length){const stages=[['prepare',t('Check installation','Kurulumu kontrol et')],['notes',t('Prepare notes','Notları hazırla')],['skills',t('Configure connections','Bağlantıları yapılandır')],['verify',t('Check saved files','Yazılan dosyaları kontrol et')]];const done=stages.filter(([id])=>events.some(e=>e.stage===id&&e.status==='done')).length;content.innerHTML=`<h1>${t('Setting up Claudian','Claudian kuruluyor')}</h1><progress max="4" value="${done}" aria-label="${t('Installation progress','Kurulum ilerlemesi')}"></progress>${stages.map(([id,title])=>`<div class="summary-row"><span>${title}</span><span>${events.some(e=>e.stage===id&&e.status==='done')?t('Done','Tamamlandı'):t('Waiting','Bekliyor')}</span></div>`).join('')}<p>${t('Detailed diagnostic messages are saved in the installation log.','Ayrıntılı tanılama mesajları kurulum günlüğüne kaydedilir.')}</p><div class="actions">${btn('Open log folder','Günlük klasörü','logs')}${busy?btn('Cancel','İptal et','cancel'):btn('Try again','Yeniden dene','retry')}</div>`;return;}
 if(plan){content.innerHTML=`<h1>${t('Connect your memory','Hafızanı bağla')}</h1><p>${t('Your selected AI applications will receive a memory skill and startup instructions. Existing global instructions are backed up before changes.','Seçtiğin AI uygulamalarına hafıza skill’i ve başlangıç talimatları eklenecek. Değişiklikten önce mevcut global talimatlar yedeklenir.')}</p><p class="path">${esc(draft.vault)}</p><p>${draft.hosts.map(id=>esc(state.hosts.find(h=>h.id===id).label)).join(' · ')}</p><p>${t('New protocol language: English. Existing notes are preserved.','Yeni protokol dili: Türkçe. Mevcut notlar korunur.')}</p><details><summary>${t('Review file changes','Dosya değişikliklerini incele')} (${plan.files.length})</summary><ul class="file-list">${plan.files.map(f=>`<li>${esc(f.path)}</li>`).join('')}</ul></details>${consentBlock(plan)}<p>${t('This configures local files; it does not grant account access. You can remove connections later without deleting your notes.','Bu işlem yerel dosyaları yapılandırır; hesap erişimi vermez. Bağlantıları daha sonra notlarını silmeden kaldırabilirsin.')}</p><div class="actions">${btn('Back','Geri','back')}${btn('Approve and connect','Onayla ve bağla','install',true)}</div>`;return;}
 if(extending){content.innerHTML=`<h1>${t('Add connection','Bağlantı ekle')}</h1><p>${t('Choose an AI application for your current memory.','Mevcut hafızan için bir AI uygulaması seç.')}</p><p class="path">${esc(draft.vault)}</p><fieldset><legend>AI</legend>${state.hosts.filter(h=>!state.profile.hosts.some(p=>p.id===h.id)).map(h=>`<label class="check"><input name="host" type="checkbox" value="${esc(h.id)}" ${draft.hosts.includes(h.id)?'checked':''}>${esc(h.label)}</label>`).join('')}</fieldset><div class="actions">${btn('Cancel','Vazgeç','exit-setup')}${btn('Continue','Devam et','preview',true)}</div>`;return;}
 const locked='';
 content.innerHTML=`<h1>${extending?t('Add a connection','Bağlantı ekle'):t('Set up your memory','Hafızanı hazırla')}</h1><p>${t('Choose where your notes live and which AI applications can use them.','Notlarının konumunu ve onları kullanacak AI uygulamalarını seç.')}</p><div class="grid"><div><label for="name">${t('Your name','Adın')}</label><input id="name" maxlength="100" value="${esc(draft.name)}" ${locked}></div><div><label for="storage">${t('Note application','Not uygulaması')}</label><select id="storage" ${locked}><option value="markdown" ${draft.storage==='markdown'?'selected':''}>Markdown</option><option value="obsidian" ${draft.storage==='obsidian'?'selected':''}>Obsidian</option></select></div></div><label for="vault">${t('Where should we create your notes folder?','Not klasörünü nerede oluşturalım?')}</label><p class="hint">${t('We suggest a new folder in Documents. Change the path or browse to another location. It will be created when you approve setup.','Belgeler içinde yeni bir klasör öneriyoruz. Yolu değiştirebilir veya başka bir konum seçebilirsin. Klasör, kurulumu onayladığında oluşturulur.')}</p><div class="row folder-choice"><input id="vault" value="${esc(draft.vault)}" ${locked}>${btn('Browse','Gözat','folder',false,locked)}</div><label for="mode">${t('Start fresh or use your notes','Yeni başla veya notlarını kullan')}</label><select id="mode" ${locked}><option value="new" ${draft.mode==='new'?'selected':''}>${t('New / empty folder','Yeni / boş klasör')}</option><option value="existing" ${draft.mode==='existing'?'selected':''}>${t('Use existing notes','Mevcut notları kullan')}</option></select><label for="access">${t('Access','Erişim')}</label><select id="access" ${locked}><option value="write" ${draft.access!=='read'?'selected':''}>${t('Read and write notes','Notları oku ve yaz')}</option><option value="read" ${draft.access==='read'?'selected':''}>${t('Read notes only','Yalnızca notları oku')}</option></select><p class="hint">${t('Read and write allows automatic note maintenance. Read only does not allow this connection to save notes.','Oku ve yaz, otomatik not bakımına izin verir. Yalnızca okuma seçildiğinde bu bağlantı not kaydedemez.')}</p><fieldset><legend>${t('AI applications','AI uygulamaları')}</legend>${state.hosts.filter(h=>!extending||!state.profile.hosts.some(p=>p.id===h.id)).map(h=>`<label class="check"><input name="host" type="checkbox" value="${h.id}" ${draft.hosts.includes(h.id)?'checked':''}>${esc(h.label)}</label>`).join('')}</fieldset><p>${t('The selected language applies to new protocol files. Existing notes will not be translated or replaced.','Seçilen dil yeni protokol dosyalarına uygulanır. Mevcut notlar çevrilmez veya değiştirilmez.')}</p><div class="actions">${extending?btn('Cancel','Vazgeç','exit-setup'):'<span></span>'}${btn('Continue','Devam et','preview',true)}</div>`;
}
async function renderPanel(){const p=state.profile;
 if(!p)throw new Error('Memory is not configured.');
 if(view==='companion'){renderCompanion();return;}
 if(view==='settings'){content.innerHTML=`<h1>${t('Settings','Ayarlar')}</h1><p>${t('The application and newly installed memory files use the setup language. Updates and protocol maintenance are collected here.','Uygulama ve yeni kurulan hafıza dosyaları kurulum dilini kullanır. Güncelleme ve protokol bakımı burada toplanır.')}</p>`;return;}
 const hosts=await api.connections();healthData=await api.health();
 if(obsidianPresent===null)obsidianPresent=await api.obsidianInstalled().catch(()=>null);
 if(updateInfo===null)updateInfo=await api.updates().catch(()=>({available:false}));
 // The proof round trip should not be a copy-paste chore when we can open the CLI ourselves.
 try{const preview=await api.scanPreview(language);cliReady=Object.fromEntries(preview.hosts.map(h=>[h.id,h.available]));}catch{cliReady={};}
 probeIssue='';if(!healthData||!healthData.vaultMissing){try{await api.checkFiles();}catch(err){probeIssue=err?.message||String(err);}}
 if(autoChallenge){autoChallenge=false;}
 content.innerHTML=`<h1>${view==='home'?t('Your memory','Hafızan'):t('AI connections','AI bağlantıları')}</h1>${notice?`<p role="status">${esc(notice)}</p>`:''}`;
 if(view==='home'){const notes=await api.activity();content.insertAdjacentHTML('beforeend',`<section class="vault-section"><h2>${t('Notes folder','Not klasörü')}</h2><p class="path">${esc(p.vault)}</p><div class="toolbar">${btn('Open in Obsidian','Obsidian’da aç','obsidian',true)}${btn('Open folder','Klasörü aç','vault')}${obsidianPresent===false?btn('Download Obsidian','Obsidian’ı indir','download-obsidian'):''}</div>${updateInfo?.available?`<div class="health-row health-warn"><div><span>${t('Update','Güncelleme')}</span><p>${t('Version ','Sürüm ')}${esc(updateInfo.latest)}${t(' is available.',' hazır.')}</p></div>${btn('Update now','Şimdi güncelle','download-update',true)}<span id="update-status" role="status"></span></div>`:''}${healthRow()}<details><summary>${t('Recent notes','Son notlar')}</summary>${notes.length?notes.map(n=>`<div class="note-row"><span>${esc(n.name)}</span><time>${new Date(n.modified).toLocaleDateString(language)}</time></div>`).join(''):`<p>${t('No notes yet.','Henüz not yok.')}</p>`}</details></section>`);}
 if(view==='connections')content.insertAdjacentHTML('beforeend',`<section><details class="memory-trigger"><summary>${t('Remember to use Claudian','Claudian kullanımını hatırlat')}</summary><p>${t('After connecting, add a short usage preference to your AI’s memory or custom instructions. This does not connect an account or copy your notes.','Bağlantıdan sonra AI’ın hafızasına veya özel talimatlarına kısa bir kullanım tercihi ekle. Bu işlem hesap bağlamaz, notlarını kopyalamaz.')}</p>${btn('Copy memory instruction','Hafıza yönergesini kopyala','copy-memory-trigger')}</details><div class="toolbar">${state.hosts.some(h=>!p.hosts.some(x=>x.id===h.id))?btn('Add connection','Bağlantı ekle','add-hosts'):''}</div>${hosts.length?hosts.map(h=>`<div class="connection"><div class="row"><div><strong>${esc(h.label)}</strong><span class="badge">${h.status==='ready'?t('Files installed','Dosyalar kurulu'):t('Needs attention','Kontrol gerekli')}</span></div></div>${accessRow(h)}${verifyRow(h)}${firstScanRow(h)}<details class="usage-details"><summary>${t('How to use this connection','Bu bağlantı nasıl kullanılır?')}</summary>${usageRow(h)}</details><details><summary>${t('Configuration and repair','Yapılandırma ve onarım')}</summary>${btn('Remove connection','Bağlantıyı kaldır','remove',false,`data-host="${h.id}"`)}${capabilityRow(h)}<p>${t('Skill: claudian-memory. Automatic startup uses the host’s rules. Manual: ','Skill: claudian-memory. Otomatik başlangıç uygulamanın kurallarını kullanır. Elle: ')}${manualCommand(h)}</p>${h.files.map(f=>`<div class="config-file"><span>${t(f.kind==='skill'?'Memory skill':'Startup instructions',f.kind==='skill'?'Hafıza skill’i':'Başlangıç talimatı')}</span><p class="path">${esc(f.path)}</p>${btn('Show file','Dosyayı göster','configuration',false,`data-host="${h.id}" data-kind="${f.kind}"`)}${btn('Repair','Onar','repair',false,`data-host="${h.id}"`)}<span class="badge">${t({ready:'Installed',missing:'Missing',changed:'Modified',unreadable:'Unreadable'}[f.status],{ready:'Kurulu',missing:'Eksik',changed:'Değiştirilmiş',unreadable:'Okunamıyor'}[f.status])}</span></div>`).join('')}</details>${removing===h.id?`<div class="remove-confirm"><p>${t('Remove this connection? Your notes stay. Files still used by other connections are kept. Restart this AI application afterward.','Bu bağlantı kaldırılsın mı? Notların ve diğer bağlantıların kullandığı dosyalar korunur. Ardından bu AI uygulamasını yeniden başlat.')}</p>${btn('Keep connection','Bağlantıyı koru','dismiss-remove')}${btn('Remove connection','Bağlantıyı kaldır','confirm-remove',false,`data-host="${h.id}"`)}</div>`:''}</div>`).join(''):`<p>${t('No AI connections. Add one whenever you are ready; your notes are still here.','AI bağlantısı yok. Hazır olduğunda ekleyebilirsin; notların burada kalır.')}</p`}</section>`);
}
async function render(){header();if(reviewing){renderReview();return;}const result=await (setup||extending?renderSetup():renderPanel());if(state.profile&&view==='settings'&&!extending&&!setup){content.insertAdjacentHTML('beforeend',`<section class="updates"><p>Claudian ${esc(state.appVersion)} · Protocol ${esc(state.profile.protocolVersion)}</p>${state.profile.migration?.conflicts?.length?`<div class="health-row health-warn"><div><span>${t('Protocol','Protokol')}</span><p>${t('Your memory protocol is older than this version and was left untouched because it differs from what Claudian installed.','Hafıza protokolün bu sürümden eski ve Claudian kurulumundan farklı olduğu için değiştirilmedi.')}</p><p class="path">${state.profile.migration.conflicts.map(f=>esc(f.split(/[\\/]/).pop())).join(' · ')}</p></div>${btn('Install the current protocol','Güncel protokolü kur','adopt-protocol',true)}</div>`:''}${btn('Check for updates','Güncellemeleri kontrol et','updates')}<span id="update-status" role="status"></span></section>`);}return result;}
// companion-bridge.cjs throws one of three exact codes. Collapsing them into a single
// sentence made an offline Core look like a wrong access code, so the reader concluded
// their data was gone. Each case is named, and the unreachable case says the code was
// never checked and nothing was changed.
function coreIssue(error,stale){const code=String(error&&error.message||'');
 if(code==='CORE_AUTH_REQUIRED')return t('That access code was not accepted. Check it and try again.','Bu access code kabul edilmedi. Kodu kontrol edip tekrar dene.');
 if(code==='CORE_RATE_LIMIT')return t('Too many attempts. Wait a few minutes before trying again.','Çok fazla deneme yapıldı. Tekrar denemeden önce birkaç dakika bekle.');
 return t('The Core did not answer, so the code was never checked. The Core runs on your own machine — start it there, then connect. Nothing was changed.','Core cevap vermedi, yani kod hiç denenmedi. Core kendi makinende çalışır — orada başlat, sonra bağlan. Hiçbir şey değişmedi.')+(stale?' '+t('The last received state is still shown.','Son alınan durum gösteriliyor.'):'');}
document.addEventListener('click',async e=>{const nav=e.target.closest('[data-view]');if(nav&&!busy){view=nav.dataset.view;notice='';await render();return;}const el=e.target.closest('[data-action]');if(!el||busy&&el.dataset.action!=='cancel')return;el.disabled=true;errorBox.hidden=true;try{const a=el.dataset.action;
 if(a==='review-apply'){selectedHosts=[...document.querySelectorAll('[name=review-host]:checked')].map(x=>x.value);busy=true;await render();try{reviewResult=await api.reviewSetup(selectedHosts);state=await api.snapshot();}finally{busy=false;await render();}return;}
 if(a==='review-done'){await api.finishReview();reviewing=false;view='connections';notice=t('Restart the selected AI applications, then verify each connection below.','Seçtiğin AI uygulamalarını yeniden başlat, ardından aşağıdan her bağlantıyı doğrula.');await render();return;}
 if(a==='review-protocol'){await api.adoptProtocol();state=await api.snapshot();reviewResult={conflicts:state.profile.migration?.conflicts||[]};await render();return;}

 if(a==='core-connect'){try{companionData=await api.companionConnect(document.querySelector('#core-code').value);companionIssue='';}catch(e){companionIssue=coreIssue(e,false);}await render();}
 if(a==='core-refresh'){try{companionData=await api.companionRefresh();companionIssue='';}catch(e){companionIssue=coreIssue(e,Boolean(companionData));}await render();}
 if(a==='core-disconnect'){await api.companionDisconnect();companionData=null;companionIssue='';await render();}


 if(a==='copy-memory-trigger'){await api.copy(await api.memoryTrigger());notice=t('Instruction copied. Review it in your AI application; saving is not verified here.','Yönerge kopyalandı. AI uygulamanda incele; kaydedildiği burada doğrulanmaz.');await render();}
 if(a==='scan-back'){view='home';await render();}

 if(a==='existing-skill')await api.existingSkill(el.dataset.host);

 if(a==='add-hosts'){extending=true;plan=null;events=[];complete=false;const d=await api.discover();draft={name:state.profile.name,vault:state.profile.vault,storage:state.profile.storage,mode:'existing',action:'extend',language,hosts:d.suggested.hosts.filter(id=>!state.profile.hosts.some(h=>h.id===id))};await render();}
 if(a==='folder'){capture();const folder=await api.chooseFolder();if(folder){draft.vault=folder;}await render();}
 if(a==='preview'){capture();plan=await api.prepare(draft);await render();}
 if(a==='back'||a==='retry'){plan=null;events=[];await render();}
 if(a==='install'){busy=true;events=[];await render();try{await api.install(plan.id);state=await api.snapshot();complete=true;}finally{busy=false;await render();}}
 if(a==='cancel')await api.cancel();
 if(a==='skip-verify'){await api.skipVerification();}
 if(a==='enter'||a==='enter-verify'||a==='skip-verify'||a==='exit-setup'){if(a==='enter-verify'){view='connections';autoChallenge=true;}if(extending){extending=false;complete=false;events=[];plan=null;await render();}else await api.enter();}
 if(a==='vault'||a==='logs')await api.open(a);
 if(a==='download-obsidian')await api.downloadObsidian();
 // Moving or recreating the notes folder. Both go through the same call: relocating to the
 // current path is how a deleted folder is created again.
 if(a==='relocate'||a==='relocate-same'){
  const target=a==='relocate-same'?(healthData&&healthData.vault)||(state.profile&&state.profile.vault):await api.chooseFolder();
  if(target){
   const status=document.querySelector('#relocate-status');if(status)status.textContent=t('Working…','Çalışıyor…');
   try{const moved=await api.relocate(target);healthData=null;notice=t('Notes folder is now ','Not klasörü artık ')+moved.vault+t('. Check your connections again so the proof matches the new folder.','. Kanıtın yeni klasörle eşleşmesi için bağlantılarını yeniden kontrol et.');}
   catch(e){notice=e.message;}
   state=await api.snapshot();await render();
  }
 }
 if(a==='obsidian'){const result=await api.obsidian();if(result?.notInstalled){notice=t('Install Obsidian from its official website, then return here to open your notes.','Obsidian’ı resmi sitesinden kur, ardından notlarını açmak için buraya dön.');await render();content.insertAdjacentHTML('beforeend',btn('Download Obsidian','Obsidian’ı indir','download-obsidian',true));}if(result?.needsClose){notice=t('Close Obsidian, then press Open in Obsidian again. Claudian will register this folder and open its home note.','Obsidian’ı kapatıp Obsidian’da aç düğmesine tekrar bas. Claudian klasörü kaydedip ana notunu açacak.');await render();}}
 if(a==='repair'){const r=await api.repair(el.dataset.host);state=await api.snapshot();notice=r.conflicts.length?t('Some files could not be repaired; review configuration.','Bazı dosyalar onarılamadı; yapılandırmayı incele.'):t('Connection repaired. Previous files were backed up. Restart your AI application.','Bağlantı onarıldı. Önceki dosyalar yedeklendi. AI uygulamanı yeniden aç.');await render();}
 if(a==='updates'){const r=await api.updates();document.querySelector('#update-status').textContent=r.available?t(' New version: ',' Yeni sürüm: ')+r.latest:t(' You are up to date.',' Güncelsin.');if(r.available)document.querySelector('#update-status').insertAdjacentHTML('beforeend',btn('Update now','Şimdi güncelle','download-update',true));}
 if(a==='adopt-protocol'){const r=await api.adoptProtocol();state=await api.snapshot();notice=t('The current protocol is installed. Your earlier version was kept beside it: ','Güncel protokol kuruldu. Önceki sürümün yanına saklandı: ')+(r.kept.join(', ')||'—');await render();return;}
 if(a==='download-update'){const status=document.querySelector('#update-status');if(status)status.textContent=t(' Downloading the installer…',' Kurulum dosyası indiriliyor…');const r=await api.downloadUpdate();if(status)status.textContent=t(' Installer '+r.version+' opened. Follow it, then reopen Claudian.',' Kurulum '+r.version+' açıldı. Tamamla, sonra Claudian’ı yeniden aç.');return;}
 if(a==='challenge-start'){if(challenge)await api.cancelVerify(challenge.host);verifyRequest++;verifyNotice='';verifyState='ready';challenge={host:el.dataset.host,prompt:(await api.challenge(el.dataset.host)).prompt};await render();return;}
 if(a==='scan-open'){notice='';firstScan={host:el.dataset.host,prompt:(await api.scanPreview(language)).prompt};await render();return;}
 if(a==='scan-close'){firstScan=null;notice='';await render();return;}
 if(a==='run-scan'){await api.scanSend(el.dataset.host,firstScan.prompt);notice=t('Session opened. The review runs there; its notes land in your folder.','Oturum açıldı. Tarama orada çalışıyor; notları klasörüne düşer.');await render();return;}
 if(a==='copy-scan'){await api.copy(firstScan.prompt);notice=t('Instruction copied. Paste it into the application.','Yönerge kopyalandı. Uygulamaya yapıştır.');await render();return;}
 if(a==='challenge-close'){if(challenge)await api.cancelVerify(challenge.host);verifyRequest++;challenge=null;verifyNotice='';verifyState='';await render();return;}
 if(a==='run-challenge'){try{await api.scanSend(el.dataset.host,challenge.prompt);startVerification();}catch(e){verifyState='failed';verifyNotice=e.message;await render();}return;}
 if(a==='copy-challenge'){await api.copy(challenge.prompt);notice=t('Copied. Paste and send it in your AI. Claudian will wait for up to three minutes.','Kopyalandı. AI’a yapıştırıp gönder. Claudian en fazla üç dakika bekleyecek.');startVerification();return;}
 if(a==='verify-run'){startVerification();return;}
 if(a==='configuration')await api.configuration(el.dataset.host,el.dataset.kind);
 if(a==='remove'){removing=el.dataset.host;await render();}
 if(a==='dismiss-remove'){removing=null;await render();}
 if(a==='confirm-remove'){busy=true;try{await api.removeHost(el.dataset.host);state=await api.snapshot();removing=null;notice=t('Connection removed. Your notes were preserved.','Bağlantı kaldırıldı. Notların korundu.');}finally{busy=false;}await render();}
 }catch(err){error(err);}finally{if(el.isConnected)el.disabled=false;}});
api.onProgress(e=>{events.push(e);if(busy&&(setup||extending))renderSetup();});
(async()=>{language=(await api.preferences()).language;state=await api.snapshot();reviewing=!!state.setupReview;selectedHosts=(state.profile?.hosts||[]).map(h=>h.id);if(state.migrationError)error(new Error(state.migrationError));if(setup){draft=(await api.discover()).suggested;draft.language=language;}await render();})().catch(error);



function renderCompanion(){
 const cards=Array.isArray(companionData?.cards)?companionData.cards.slice(0,3):[];
 content.innerHTML=`<section class="empty companion-native"><div class="caption development-label">${t('UNDER DEVELOPMENT','GELİŞTİRİLİYOR')}</div><div class="wordmark">claudian<span>.</span>app</div><h1>${t('From an assistant to a companion.','Bir asistandan, yol arkadaşına.')}</h1><p>${t('A layer that understands your notes, time and changing circumstances together — and is there at the right moment.','Notlarını, zamanını ve değişen koşullarını birlikte anlayan; doğru anda yanında olan bir katman.')}</p><p>${t('This system is not ready yet. Shared memory works today; we are building the companion on top of it.','Bu sistem henüz hazır değil. Ortak hafıza bugün çalışıyor; yol arkadaşını bunun üzerine geliştiriyoruz.')}</p>${companionIssue?`<p role="status">${esc(companionIssue)}</p>`:''}${!companionData?`<form id="core-form"><label for="core-code">${t('Access code','Access code')}</label><div class="row"><input id="core-code" type="password" autocomplete="off" maxlength="128" required placeholder="•••• — ••••"><button type="submit" class="primary">${t('Connect','Bağlan')} →</button></div></form>`:`<div class="companion-feed"><div class="toolbar"><span>${t('Last received','Son alınan')}: ${esc(companionData.generatedAt?new Date(companionData.generatedAt).toLocaleString(language):'—')}</span>${btn('Refresh','Yenile','core-refresh')}${btn('Disconnect','Bağlantıyı kes','core-disconnect')}</div>${companionData.focus?`<h2>${esc(companionData.focus)}</h2>`:''}${cards.length?cards.map(c=>`<article class="companion-contact"><small>${esc(c.sourceLabel)}</small><h2>${esc(c.title)}</h2><p>${esc(c.body)}</p></article>`).join(''):`<p>${t('No new contact to show.','Gösterilecek yeni temas yok.')}</p>`}</div>`}</section>`;
 const form=document.querySelector('#core-form');if(form)form.addEventListener('submit',e=>{e.preventDefault();const button=form.querySelector('button');button.dataset.action='core-connect';button.type='button';button.click();});
}
api.onVerify(async event=>{if(!challenge||event.host!==challenge.host||event.requestId!==verifyRequest)return;verifyState=event.state;if(event.message)verifyNotice=event.message;await render();});
setInterval(async()=>{if(view!=='companion'||!companionData||busy)return;try{companionData=await api.companionRefresh();companionIssue='';}catch(e){companionIssue=coreIssue(e,Boolean(companionData));}if(view==='companion')renderCompanion();},60000);

function manualCommand(h){
 // MCP ile baglanan uygulamalarda cagrilan sey bir skill degil, adi olan yeteneklerdir.
 const mcp=h.artifacts?.server&&h.artifacts?.capabilities?.length;
 if(mcp)return t('ask in plain language; the AI calls them itself','doğal dille iste, AI kendisi çağırır');
 const name=h.files.some(f=>f.path.includes("claudian-memory-bridge"))?"claudian-memory-bridge":"claudian-memory";
 return h.id==="codex"?"$"+name:["claude-code","cursor"].includes(h.id)?"/"+name:t("use the host skill picker","uygulamanın skill seçicisini kullan");}
// Iki farkli baglanma bicimi var ve uygulama bugune kadar hangisinin hangisi oldugunu
//   "bilmiyorum bagli denen modellerin gercekten ne ile ve nasil bagli oldugunu veya
//    nasil cagirmam kullanmam gerektigini"
// Bu yuzden bu satir katlamanin ICINDE degil, baglantinin uzerinde duruyor.
function usageRow(h){
 if(h.access?.state==='unavailable')return '';
 const a=h.artifacts||{};
 const mcp=a.server&&a.capabilities?.length;
 const how=mcp
  ? `MCP · ${t('connection','bağlantı')} <code>${esc(a.server)}</code>`
  : t('Startup rule + skill file','Başlangıç kuralı + skill dosyası');
 const call=mcp
  ? `${t('Ask in plain language. The AI calls these itself','Doğal dille iste, AI bunları kendisi çağırır')}: ${t('capability names are in Configuration','yetenek adları Yapılandırma bölümünde')}`
  : h.id==='codex'
   ? `${t('Loads by itself each session. By hand','Her oturumda kendiliğinden yüklenir. Elle')}: <code>$claudian-memory</code>`
   : ['claude-code','cursor'].includes(h.id)
    ? `${t('Loads by itself each session. By hand','Her oturumda kendiliğinden yüklenir. Elle')}: <code>/claudian-memory</code>`
    : t('Loads by itself each session; use the skill picker by hand.','Her oturumda kendiliğinden yüklenir; elle uygulamanın skill seçicisini kullan.');
 return `<div class="usage"><p><b>${t('How it connects','Nasıl bağlı')}:</b> ${how}</p><p><b>${t('How to use it','Nasıl kullanılır')}:</b> ${call}</p></div>`;
}
// Baglantinin adi ve cagrilabilir yetenekleri. Kullanici bunlari goremezse bir seyin
// calistigini kendi basina sinayamaz.
function capabilityRow(h){
 const a=h.artifacts||{};
 if(!a.server||!a.capabilities?.length)return '';
 return `<div class="caps-row"><p>${t('Connection name','Bağlantı adı')}: <code>${esc(a.server)}</code></p>`
  +`<p>${t('Callable capabilities','Çağrılabilir yetenekler')}:</p><ul class="caps">${a.capabilities.map(n=>`<li><code>${esc(n)}</code></li>`).join('')}</ul></div>`;}

async function startVerification(){
 if(!challenge)return;
 const host=challenge.host,id=++verifyRequest;
 verifyState='waiting';verifyNotice='';await render();
 try{const r=await api.verifyWatch(host,id);if(id!==verifyRequest||challenge?.host!==host)return;
  verifyState=r.verified?'verified':(r.state||'mismatch');verifyNotice=r.message||'';
  if(r.verified){challenge=null;notice=t('The AI read and returned the test value. Connection verified.','AI test değerini okuyup geri yazdı. Bağlantı doğrulandı.');healthData=await api.health();}
 }catch(e){if(id!==verifyRequest)return;verifyState='failed';verifyNotice=e.message;}
 await render();
}
function renderReview(){
 const p=state.profile,conflicts=reviewResult?.conflicts||[];
 content.innerHTML='<h1>'+t('Review your installation','Kurulumunu gözden geçir')+'</h1><p>'+t('We found settings from your previous installation. Confirm your notes folder and choose which AI applications should stay connected.','Önceki kurulumundan ayarlar bulundu. Not klasörünü kontrol et ve hangi AI uygulamalarının bağlı kalacağını seç.')+'</p><h2>'+t('Notes folder','Not klasörü')+'</h2><p class="path">'+esc(p.vault)+'</p><div class="toolbar">'+btn('Choose another folder','Başka klasör seç','relocate')+'</div><fieldset><legend>'+t('AI applications','AI uygulamaları')+'</legend>'+state.hosts.map(h=>'<label class="check"><input name="review-host" type="checkbox" value="'+esc(h.id)+'" '+(selectedHosts.includes(h.id)?'checked':'')+(busy?' disabled':'')+'>'+esc(h.label)+'</label>').join('')+'</fieldset><p>'+t('Apply will repair selected local connections and update managed protocol files. Unchecked connections will be removed; your notes stay. Account sign-in and permissions requested by the AI must still be completed there.','Uygula, seçili yerel bağlantıları onarır ve yönetilen protokol dosyalarını günceller. İşaretini kaldırdığın bağlantılar kaldırılır; notların korunur. AI’ın hesap girişi ve kendi izin onayı o uygulamada tamamlanır.')+'</p><p>'+t('ChatGPT requires a remote connector; selecting it does not install a working cloud connection.','ChatGPT uzak connector gerektirir; burada seçmek çalışan bir bulut bağlantısı kurmaz.')+'</p>'+(busy?'<p role="status"><span class="verify-spinner"></span> '+t('Applying your choices…','Seçimlerin uygulanıyor…')+'</p>':btn('Apply choices','Seçimleri uygula','review-apply',true))+(reviewResult?'<section role="status"><h2>'+t('Installation result','Kurulum sonucu')+'</h2><p>'+ (conflicts.length?t('Some modified files were preserved. Review them before considering setup complete.','Değiştirilmiş bazı dosyalar korundu. Kurulumu tamamlandı saymadan bunları kontrol et.'):t('Selected local connections and managed files were checked. Now test them in the AI.','Seçili yerel bağlantılar ve yönetilen dosyalar kontrol edildi. Şimdi AI içinde test et.'))+'</p>'+conflicts.map(f=>'<p class="path">'+esc(f)+'</p>').join('')+(conflicts.some(f=>/Protocol|CHATGPT.md|CLAUDE.md|CODEX.md/.test(f))?btn('Back up and update protocol copies','Protokol kopyalarını yedekle ve güncelle','review-protocol'):'')+'<div class="actions">'+btn('Go to connection tests','Bağlantı testlerine geç','review-done',true)+'</div></section>':'');
}
