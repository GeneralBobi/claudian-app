'use strict';
const api=window.claudian, content=document.querySelector('#content'), errorBox=document.querySelector('#error');
let challenge=null, verifyNotice='', verifyState='', firstScan=null, healthData=null, obsidianPresent=null, probeIssue='', cliReady={}, updateInfo=null, autoChallenge=false;
let state, draft, plan, language='en', extending=false, busy=false, complete=false, events=[], view='home', removing=null, notice='', companionData=null, companionIssue='';
const setup=document.body.dataset.surface==='setup';
let reviewing=false, reviewResult=null, selectedHosts=[], verifyRequest=0;
// Claudian checks its own connections instead of handing the check back to the user.
let selfCheck=null, selectedConnection=null;
let remoteStatus=null,remoteRefreshBusy=false,extensionArchive='';
let reviewResults={},reviewRefreshBusy=false;
const checkIcon='<svg class="step-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
function connectionSteps(h){
 const info=healthData?.hosts?.find(x=>x.id===h.id),review=reviewResults[h.id];
 return `<ol class="connection-steps" aria-label="${t('Connection progress','Bağlantı ilerlemesi')}">${[[h.status==='ready',t('Files ready','Dosyalar hazır')],[info?.state==='verified',t('AI read/write','AI okuma/yazma')],[review?.status==='completed',t('First review','İlk tarama')]].map(([done,label],i)=>`<li data-complete="${done===true}"><span class="step-symbol">${done?checkIcon:i+1}</span>${label}</li>`).join('')}</ol>`;
}
function appActions(h,copyAction,done=false){
 return `${btn('Copy instruction','Yönergeyi kopyala',copyAction)}${['codex','claude-code','claude-desktop','chatgpt','antigravity','antigravity-cli','cursor'].includes(h.id)?btn('Copy and open app','Kopyala ve uygulamayı aç','open-in-ai',!done&&!cliReady[h.id],`data-host="${h.id}" data-copy="${copyAction}"`):''}`;
}
const remoteHost=h=>['chatgpt','claude-desktop'].includes(h.id);
function remoteStatusBody(){
 const s=remoteStatus||{state:'stopped',requests:[],grants:[]};
 const label={online:t('Device online','Cihaz çevrimiçi'),connecting:t('Connecting device','Cihaz bağlanıyor'),offline:t('Device offline','Cihaz çevrimdışı'),stopped:t('Device connection stopped','Cihaz bağlantısı kapalı')}[s.state]||s.state;
 return `<p role="status"><strong>${esc(label)}</strong>${s.lastError?' — '+esc(s.lastError):''}</p>`
  +(s.requests||[]).map(r=>`<section class="grant"><h3>${t('Approve AI connection','AI bağlantısını onayla')}</h3><p>${t('Only approve if the code matches the browser you opened. The application name is supplied by the requesting client.','Yalnızca açtığın tarayıcıdaki kodla eşleşiyorsa onayla. Uygulama adı, bağlantı isteyen istemci tarafından gönderilir.')}</p><p><strong>${esc(r.code)}</strong> · ${esc(r.name)} · ${esc(r.host)}</p><p class="path">${esc(new URL(r.redirect).hostname)}</p><p>${esc(r.scope)}<br>${esc(r.vault)}</p>${btn('Approve this connection','Bu bağlantıya izin ver','connector-approve',true,`data-id="${esc(r.id)}"`)}${btn('Deny','Reddet','connector-deny',false,`data-id="${esc(r.id)}"`)}</section>`).join('')
  +(s.grants||[]).map(g=>`<div class="config-file"><strong>${esc(g.name)}</strong><span>${esc(g.host)} · ${esc(g.revoked?t('Revoked','İzin kaldırıldı'):g.lastSeen?t('AI contacted this device','AI bu cihaza ulaştı'):t('Authorized; waiting for AI','Yetkilendirildi; AI bekleniyor'))}</span><p>${esc(g.scope)}${g.lastTool?' · '+esc(g.lastTool):''}${g.lastSeen?' · '+esc(new Date(g.lastSeen).toLocaleString()):''}</p>${g.revoked?'':btn('Revoke account access','Hesap erişimini kaldır','connector-revoke',false,`data-id="${esc(g.id)}"`)}</div>`).join('');
}
function remoteSettings(){
 return `<details class="connection cloud-settings" open><summary>${t('Cloud connection settings','Bulut bağlantısı ayarları')}</summary><p>${t('A relay carries requests between your AI account and this computer. It is not an account login. Keep Claudian and this computer running while using it. Requested note content passes through this service.','Relay, AI hesabın ile bu bilgisayar arasındaki istekleri taşıyan hizmettir. Bir hesap giriş alanı değildir. Kullanırken Claudian ve bu bilgisayar açık kalır; istenen not içeriği bu hizmetten geçer.')}</p>${!remoteStatus?.relay?`<p class="health-warn">${t('Connect through the Claudian relay. Your device address will appear here after connecting.','Claudian relay üzerinden bağlan. Bağlandıktan sonra cihaza ait adres burada görünür.')}</p>`:''}<div id="remote-status">${remoteStatusBody()}</div>${!remoteStatus?.enabled?btn("Connect this device","Bu cihazı bağla","connector-default",true):""}<details><summary>${t('Advanced · self-hosted service','Gelişmiş · kendi hizmetini kullan')}</summary><p>${t('For administrators running a Claudian relay. Enter the HTTPS endpoint supplied by that service; an ordinary website address will not work.','Claudian relay çalıştıran yöneticiler içindir. O hizmetin sağladığı HTTPS adresini gir; sıradan bir web sitesi adresi çalışmaz.')}</p><label for="relay-url">${t('Claudian relay endpoint','Claudian relay adresi')}</label><input id="relay-url" type="url" value="${esc(remoteStatus?.relay||'')}" ${remoteStatus?.enabled?'disabled':''}>${remoteStatus?.enabled?'':btn('Connect configured service','Tanımlanan hizmete bağlan','connector-start')}</details><div class="toolbar">${remoteStatus?.enabled?btn('Disconnect device','Cihaz bağlantısını kapat','connector-stop'):''}${btn('Refresh connection state','Bağlantı durumunu yenile','connector-refresh')}</div></details>`;
}
function desktopExtensionCard(h){
 return h.id==='claude-desktop'?`<section class="connection"><h3>Claude Desktop</h3><p>${t("Install the local extension to use your selected memory in Claude Desktop. Confirm installation in the Claude window that opens.","Seçili hafızanı Claude Desktop içinde kullanmak için yerel eklentiyi kur. Açılan Claude penceresinde kurulumu onayla.")}</p>${btn("Install Claude Desktop extension","Claude Desktop eklentisini kur","connector-desktop-install",true)}</section>`:'';
}
function remoteHostCard(h){
 const url=remoteStatus?.urls?.[h.id];
 const grants=(remoteStatus?.grants||[]).filter(g=>g.host===h.id&&!g.revoked);
 const cloud=`<p>${esc(grants.length?t('Account access approved. Run the AI test to verify reading and writing.','Hesap erişimi onaylandı. Okuma/yazmayı doğrulamak için AI testini çalıştır.'):t('Cloud account access has not been approved yet.','Bulut hesabı erişimi henüz onaylanmadı.'))}</p>${url?`<ol class="setup-steps"><li>${t('Open account connections and create a connection named Claudian Core.','Hesap bağlantılarını aç ve Claudian Core adlı bir bağlantı oluştur.')} ${btn('Copy address and open settings','Adresi kopyala ve ayarları aç','connector-provider',true,`data-host="${h.id}"`)}</li><li>${t('This is a connector address, not a browser login page. In ChatGPT: Plugins → Create app (or Settings → Apps → Advanced settings → Developer mode in other versions). Name: Claudian Core. Authentication: OAuth. Paste into MCP server URL. In Claude: Add custom connector.','Bu adres tarayıcı giriş sayfası değildir. ChatGPT: Eklentiler → Create app / Uygulama oluştur (diğer sürümlerde Ayarlar → Uygulamalar → Gelişmiş ayarlar → Geliştirici modu). Ad: Claudian Core. Kimlik doğrulama: OAuth. MCP sunucu URL alanına yapıştır. Claude: Özel bağlayıcı ekle.')}<p class="path">${esc(url)}</p>${btn('Copy connector URL','Bağlantı adresini kopyala','connector-copy',false,`data-host="${h.id}"`)}</li><li>${t('Approve the matching code here, then start a new AI conversation with Claudian enabled.','Eşleşen kodu burada onayla, ardından Claudian etkin olarak yeni bir AI sohbeti başlat.')}</li></ol>`:`<p>${t('Connect this device below, then open your account connections to authorize Claudian.','Aşağıdan bu cihazı bağla; ardından Claudian’a izin vermek için hesap bağlantılarını aç.')}</p>`}`;
 if(h.id==='claude-desktop')return `<div class="connection"><h2>Claude Desktop</h2>${connectionSteps(h)}<p>${t('Use the local extension on this computer. Cloud account authorization is a separate connection for web and mobile.','Bu bilgisayarda yerel eklentiyi kullan. Bulut hesabı izni, web ve mobil için ayrı bir bağlantıdır.')}</p>${remoteStatus?.desktopExtension?.current?`<p class="health-ok">${checkIcon}${t('Extension enabled and up to date','Eklenti etkin ve güncel')}</p>`:btn('Prepare extension and open Claude','Eklentiyi hazırla ve Claude’u aç','connector-desktop-install',true)}${extensionArchive?`<ol class="setup-steps"><li>${t('Claude → Settings → Extensions → Advanced settings → Install Extension…','Claude → Ayarlar → Eklentiler → Gelişmiş ayarlar → Eklenti yükle…')}</li><li>${t('Paste the copied path into the file picker and open it.','Kopyalanan yolu dosya seçicisine yapıştır ve aç.')}<p class="path">${esc(extensionArchive)}</p></li><li>${t('Enable Claudian Core, start a new chat, then return here and refresh.','Claudian Core’u etkinleştir, yeni sohbet aç; buraya dönüp durumu yenile.')}</li></ol>`:''}<p>${t('In Claude, confirm installation and enable Claudian Core in Settings → Extensions. Start a new conversation. A successful CLI test does not verify this extension.','Claude içinde kurulumu onayla ve Ayarlar → Eklentiler bölümünde Claudian Core’u etkinleştir. Yeni bir sohbet aç. Başarılı CLI testi bu eklentiyi doğrulamaz.')}</p>${selfCheckRow(h)}${accessRow(h)}${verifyRow(h)}${firstScanRow(h)}<details><summary>${t('Web and mobile connection','Web ve mobil bağlantısı')}</summary>${cloud}</details>${memoryRow(h)}</div>`;
 return `<div class="connection"><h2>ChatGPT</h2>${cloud}${grants.length?verifyRow({...h,access:{state:'ready',scope:grants.some(g=>g.scope?.includes('write'))?'write':'read'}})+firstScanRow(h):''}${memoryRow(h)}</div>`;
}
async function refreshRemote(){
 if(remoteRefreshBusy)return;remoteRefreshBusy=true;
 try{const before=JSON.stringify([remoteStatus?.desktopExtension,remoteStatus?.urls,remoteStatus?.grants?.map(g=>[g.id,g.revoked])]);remoteStatus=await api.connectorStatus();const after=JSON.stringify([remoteStatus?.desktopExtension,remoteStatus?.urls,remoteStatus?.grants?.map(g=>[g.id,g.revoked])]);if(before!==after)await render();else{const element=document.querySelector('#remote-status');if(element&&element.innerHTML!==remoteStatusBody())element.innerHTML=remoteStatusBody();}}finally{remoteRefreshBusy=false;}
}
setInterval(()=>{if(view==='connections'&&!busy&&!setup&&!extending)refreshRemote().catch(()=>{});},3000);
setInterval(async()=>{
 if(view!=='connections'||busy||reviewRefreshBusy||!api.reviewStatus)return;
 reviewRefreshBusy=true;
 try{let changed=false;for(const [id,r] of Object.entries(reviewResults))if(r.status==='waiting'){
  const next=await api.reviewStatus(id);if(JSON.stringify(next)!==JSON.stringify(r)){reviewResults[id]=next;changed=true;}
 }if(changed)await render();}catch(e){error(e);}finally{reviewRefreshBusy=false;}
},3000);
// Consent is an act, not a paragraph: nothing is written until this is true.
let granted=false, withdrawing=[];
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
 const row=c=>`<li><code>${esc(c.name)}</code> <span class="badge">${c.scope==='write'?t('writes','yazar'):t('reads','okur')}</span>${c.enabled?'':` <span class="badge muted">${t('not granted','verilmedi')}</span>`}</li>`;
 return `<p>${t('Notes stay on this computer. What your AI reads from them is sent to that provider under your own account and privacy settings.','Notlar bu bilgisayarda kalır. AI’ının onlardan okuduğu içerik, kendi hesabın ve gizlilik ayarların kapsamında o sağlayıcıya iletilir.')}</p>`
  +`<h3>${t('Capabilities','Yetenekler')} <span class="badge">${open.length}/${caps.length}</span></h3>`
  +`<ul class="caps">${caps.map(row).join('')}</ul>`;
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
 const open=firstScan&&firstScan.host===h.id,r=reviewResults[h.id];
 const labels={completed:t('Review completed','Tarama tamamlandı'),needs_input:t('Your answer is needed','Yanıtın gerekiyor'),failed:t('Review failed','Tarama başarısız'),waiting:t('Waiting for the AI report','AI raporu bekleniyor'),expired:t('Review expired; start again','Tarama süresi doldu; yeniden başlat'),invalid:t('Report could not be verified','Rapor doğrulanamadı'),stale:t('Configuration changed; review again','Yapılandırma değişti; yeniden tara')};
 return `<div class="config-file verify-row" data-state="${r?.status==='completed'?'verified':'first-scan'}"><span>${t('First review','İlk tarama')}</span>`
  +`<span class="badge" role="status">${esc(labels[r?.status]||t('Not started','Başlatılmadı'))}${r?.receivedAt?' · '+esc(new Date(r.receivedAt).toLocaleString()):''}</span>${r?.summary?`<details class="review-report"><summary>${t('Read the AI report','AI raporunu oku')}</summary><pre>${esc(r.summary)}</pre><p>${t('Report returned by the AI for this review.','Bu tarama için AI tarafından döndürülen rapor.')}</p></details>`:''}`
  +(open?`<pre class="prompt">${esc(firstScan.prompt)}</pre><div class="toolbar">`
     +(cliReady[h.id]?btn('Run in terminal','Terminalde çalıştır','run-scan',r?.status!=='completed',`data-host="${h.id}"`)
                     :'')+appActions(h,'copy-scan',r?.status==='completed')
     +btn('Close','Kapat','scan-close')+`</div>${notice?`<p role="status">${esc(notice)}</p>`:''}`
    :btn(r?.status==='completed'?'Review again':'Start the first review',r?.status==='completed'?'Yeniden tara':'İlk taramayı başlat','scan-open',r?.status!=='completed',`data-host="${h.id}"`))
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
// Only a broken connection speaks. A check that announces success on every launch teaches the
// user to stop reading it, and the point of this row is that a connection which quietly
// stopped working must not look like one nobody has checked yet.
// A connector delivers capabilities; it does not decide that the model reaches for them at the
// first message. On a surface with its own persistent memory that decision lives there, which is
// why the setup that worked best was never only a skill file.
function memoryRow(h){
 return `<details class="config-file memory-trigger"><summary>${t('Also save this to ','Bunu ayrıca ')}${esc(h.label)}${t('’s own memory',' hafızasına da kaydet')}</summary>`
  +`<p>${t('Paste this into the application once. It tells the model when to reach for this memory, and to stay quiet about it. It grants no access and copies no notes.','Bunu uygulamaya bir kez yapıştır. Modele bu hafızaya ne zaman uzanacağını ve bunu duyurmamasını söyler. Erişim vermez, not kopyalamaz.')}</p>`
  +`${btn('Copy the instruction','Yönergeyi kopyala','copy-memory-trigger',false,`data-host="${h.id}"`)}</details>`;
}
function selfCheckRow(h){
 const info=(selfCheck?.connections||[]).find(x=>x.id===h.id);
 if(!info)return '';
 const c=info.checks||{};
 const problems=[];
 if(c.files==='broken')problems.push(t('Installed files were modified or are missing.','Kurulu dosyalar değiştirilmiş veya eksik.'));
 if(c.access==='unavailable')problems.push(t('This AI cannot reach the notes folder.','Bu AI not klasörüne erişemiyor.'));
 if(c.server?.state==='broken')problems.push(t('The memory server did not answer: ','Hafıza sunucusu cevap vermedi: ')+(c.server.detail||''));
 const stale=(info.fileStates||[]).filter(f=>f.state!=='ready');
 // Naming the file that failed is the difference between a warning and an instruction.
 const named=stale.length?`<p class="path">${stale.map(f=>esc(f.path)+' — '+t({missing:'missing',changed:'points somewhere else or was edited'}[f.state]||f.state,{missing:'eksik',changed:'başka yeri gösteriyor veya düzenlenmiş'}[f.state]||f.state)).join('<br>')}</p>`:'';
 if(problems.length)return `<div class="config-file health-warn" data-check="broken"><span>${t('Automatic check','Otomatik kontrol')}</span><p>${problems.map(esc).join(' ')}</p>${named}${btn('Repair','Onar','repair',true,`data-host="${h.id}"`)}</div>`;
 const parts=[t('files','dosyalar')];
 if(c.access==='ready')parts.push(t('folder access','klasör erişimi'));
 if(c.access==='manual')parts.push(t('folder access: one manual step','klasör erişimi: tek elle adım'));
 if(c.server?.state==='ready')parts.push(t('memory server answered','hafıza sunucusu cevapladı'));
 return `<div class="config-file" data-check="ready"><span>${t('Automatic check','Otomatik kontrol')}</span><span class="badge">${esc(parts.join(' · '))}</span></div>`;
}
function verifyRow(h){
 if(h.access?.state==='unavailable'||h.access?.scope==='read')return '';
 const info=(healthData?.hosts||[]).find(x=>x.id===h.id);
 const state=info?info.state:'unverified';
 const label={verified:t('Read/write verified','Okuma/yazma doğrulandı'),stale:t('Verified before an update — run it again','Güncellemeden önce doğrulandı — tekrar çalıştır'),unverified:t('Never verified in the AI','AI içinde hiç doğrulanmadı')}[state];
 const when=info?.verifiedAt?` · ${new Date(info.verifiedAt).toLocaleString(language==='tr'?'tr-TR':'en-GB')}`:'';
 const open=challenge&&challenge.host===h.id;
 return maintenanceRow(info)+`<div class="config-file verify-row" data-state="${state}"><span>${t('File access test','Dosya erişim testi')}</span><span class="badge">${esc(label)}${esc(when)}</span>
  ${open?`${h.id==='gemini-cli'?`${btn('Open Gemini sign-in','Gemini girişini aç','gemini-login',false)}<p>${t('Finish sign-in until you reach the Gemini chat prompt. Then close that terminal and use Run in terminal below to start the test in a new session. The browser success page alone does not complete this step.','Gemini sohbet satırına ulaşana kadar girişi tamamla. Sonra o terminali kapatıp aşağıdaki Terminalde çalıştır ile testi yeni oturumda başlat. Tarayıcıdaki başarı sayfası tek başına bu adımı tamamlamaz.')}</p><p class="health-warn">${t('Google browser sign-in is not the memory test. Return to the terminal; if it stays on Get started, retry sign-in there. If it reports UNSUPPORTED_CLIENT, this account cannot use that CLI; use Antigravity or a provider-supported authentication method.','Google tarayıcı girişi hafıza testi değildir. Terminale dön; Get started ekranında kalırsa girişi oradan yeniden dene. UNSUPPORTED_CLIENT hatası varsa bu hesap o CLI’ı kullanamıyor; Antigravity veya sağlayıcının desteklediği bir giriş yöntemi gerekir.')}</p>`:''}<p>${cliReady[h.id]?t('Run the test in your AI application. Approve its permission request if shown, then return here for the result.','Testi AI uygulamanda çalıştır. İzin sorarsa inceleyip onayla; sonuç burada beklenecek.'):t('Paste this into ','Şuraya yapıştır: ')+esc(h.label)+t('. The answer is awaited here; nothing else to press. There is no slash or @ command for this — the memory loads by itself at the start of a conversation.','. Yanıt burada bekleniyor, başka bir şeye basman gerekmiyor. Bunun için bir slash veya @ komutu yok — hafıza konuşmanın başında kendiliğinden yükleniyor.')}</p><pre class="prompt">${esc(challenge.prompt)}</pre><div class="toolbar">${cliReady[h.id]?btn('Run in terminal','Terminalde çalıştır','run-challenge',state!=='verified',`data-host="${h.id}"`):''}${appActions(h,'copy-challenge',state==='verified')}${btn('Cancel','Vazgeç','challenge-close')}</div>${verifyStatus()}`
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
 if(complete){content.innerHTML=`<h1>${t('Your memory folder is ready.','Hafıza klasörün hazır.')}</h1><p>${t('Continue to Connections to install the provider plugin and authorize your AI account. Local file setup alone does not connect ChatGPT or Claude web and mobile.','Sağlayıcı eklentisini kurmak ve AI hesabına izin vermek için Bağlantılar’a devam et. Yerel dosyaların hazırlanması, ChatGPT veya Claude web ve mobil hesabını bağlamaz.')}</p><p class="path">${esc(state.profile.vault)}</p>${notice?`<p role="status">${esc(notice)}</p>`:''}<div class="actions">${btn('Open in Obsidian','Obsidian’da aç','obsidian')}${btn('Open folder','Klasörü aç','vault')}${btn('Change folder','Klasörü değiştir','relocate')}${btn('Set up AI connections','AI bağlantılarını kur','enter-verify',true)}${btn('Skip for now','Şimdilik atla','skip-verify')}</div>`;return;}
 if(busy||events.length){const stages=[['prepare',t('Check installation','Kurulumu kontrol et')],['notes',t('Prepare notes','Notları hazırla')],['skills',t('Configure connections','Bağlantıları yapılandır')],['verify',t('Check saved files','Yazılan dosyaları kontrol et')]];const done=stages.filter(([id])=>events.some(e=>e.stage===id&&e.status==='done')).length;content.innerHTML=`<h1>${t('Setting up Claudian','Claudian kuruluyor')}</h1><progress max="4" value="${done}" aria-label="${t('Installation progress','Kurulum ilerlemesi')}"></progress>${stages.map(([id,title])=>`<div class="summary-row"><span>${title}</span><span>${events.some(e=>e.stage===id&&e.status==='done')?t('Done','Tamamlandı'):t('Waiting','Bekliyor')}</span></div>`).join('')}<p>${t('Detailed diagnostic messages are saved in the installation log.','Ayrıntılı tanılama mesajları kurulum günlüğüne kaydedilir.')}</p><div class="actions">${btn('Open log folder','Günlük klasörü','logs')}${busy?btn('Cancel','İptal et','cancel'):btn('Try again','Yeniden dene','retry')}</div>`;return;}
 if(plan){content.innerHTML=`<section class="grant"><h1>${t('Grant permission','İzin ver')}</h1><p class="lead">${t('Nothing has been written yet. Choose what these applications may do with your notes, then grant it. Any connection can be withdrawn later without deleting notes.','Henüz hiçbir şey yazılmadı. Bu uygulamaların notlarınla ne yapabileceğini seç ve izni ver. Her bağlantıyı sonradan, notlarını silmeden geri alabilirsin.')}</p><div class="grant-body"><section class="grant-col"><h2>${t('What you are granting','Neyi veriyorsun')}</h2><dl class="grant-facts"><dt>${t('Folder','Klasör')}</dt><dd class="path">${esc(draft.vault)}</dd><dt>${t('Applications','Uygulamalar')}</dt><dd>${draft.hosts.map(id=>esc(state.hosts.find(h=>h.id===id).label)).join(' · ')}</dd></dl><fieldset class="scope-choice"><label class="check"><input type="radio" name="grant-scope" value="read" ${draft.access==='read'?'checked':''}><span><strong>${t('Read notes','Notları oku')}</strong>${t('The AI can retrieve your notes. It cannot change or add anything.','AI notlarını getirebilir; hiçbir şeyi değiştiremez, ekleyemez.')}</span></label><label class="check"><input type="radio" name="grant-scope" value="write" ${draft.access!=='read'?'checked':''}><span><strong>${t('Read and write notes','Notları oku ve yaz')}</strong>${t('It can also create, update and archive notes in this folder. Without this, memory cannot maintain itself.','Bu klasörde not oluşturabilir, güncelleyebilir ve arşivleyebilir. Bu olmadan hafıza kendiliğinden bakım göremez.')}</span></label></fieldset></section><section class="grant-col"><h2>${t('What that means','Bu ne anlama geliyor')}</h2>${consentBlock(plan)}<details><summary>${t('Every file that will be written','Yazılacak her dosya')} (${plan.files.length})</summary><ul class="file-list">${plan.files.map(f=>`<li>${esc(f.path)}</li>`).join('')}</ul></details><p class="note">${t('This configures local files on this computer. It signs in to no account and uploads nothing.','Bu işlem bu bilgisayardaki yerel dosyaları yapılandırır. Hiçbir hesaba giriş yapmaz, hiçbir şey yüklemez.')}</p></section></div><label class="check grant-confirm"><input type="checkbox" id="grant-confirm" ${granted?'checked':''}><span>${t('Allow Claudian to configure the selected applications with the folder access shown above.','Claudian’ın seçili uygulamaları yukarıdaki klasör erişimiyle yapılandırmasına izin veriyorum.')}</span></label></section><div class="actions">${btn('Back','Geri','back')}${btn('Grant and connect','İzni ver ve bağla','install',true,granted?'':'disabled')}</div>`;return;}
 if(extending){content.innerHTML=`<h1>${t('Add connection','Bağlantı ekle')}</h1><p>${t('Choose an AI application for your current memory.','Mevcut hafızan için bir AI uygulaması seç.')}</p><p class="path">${esc(draft.vault)}</p><fieldset><legend>AI</legend>${state.hosts.filter(h=>!state.profile.hosts.some(p=>p.id===h.id)).map(h=>`<label class="check"><input name="host" type="checkbox" value="${esc(h.id)}" ${draft.hosts.includes(h.id)?'checked':''}>${esc(h.label)}</label>`).join('')}</fieldset><div class="actions">${btn('Cancel','Vazgeç','exit-setup')}${btn('Continue','Devam et','preview',true)}</div>`;return;}
 const locked='';
 content.innerHTML=`<h1>${extending?t('Add a connection','Bağlantı ekle'):t('Set up your memory','Hafızanı hazırla')}</h1><p>${t('Choose where your notes live and which AI applications can use them.','Notlarının konumunu ve onları kullanacak AI uygulamalarını seç.')}</p><div class="grid"><div><label for="name">${t('Your name','Adın')}</label><input id="name" maxlength="100" value="${esc(draft.name)}" ${locked}></div><div><label for="storage">${t('Note application','Not uygulaması')}</label><select id="storage" ${locked}><option value="markdown" ${draft.storage==='markdown'?'selected':''}>Markdown</option><option value="obsidian" ${draft.storage==='obsidian'?'selected':''}>Obsidian</option></select></div></div><label for="vault">${t('Where should we create your notes folder?','Not klasörünü nerede oluşturalım?')}</label><p class="hint">${t('We suggest a new folder in Documents. Change the path or browse to another location. It will be created when you approve setup.','Belgeler içinde yeni bir klasör öneriyoruz. Yolu değiştirebilir veya başka bir konum seçebilirsin. Klasör, kurulumu onayladığında oluşturulur.')}</p><div class="row folder-choice"><input id="vault" value="${esc(draft.vault)}" ${locked}>${btn('Browse','Gözat','folder',false,locked)}</div><label for="mode">${t('Start fresh or use your notes','Yeni başla veya notlarını kullan')}</label><select id="mode" ${locked}><option value="new" ${draft.mode==='new'?'selected':''}>${t('New / empty folder','Yeni / boş klasör')}</option><option value="existing" ${draft.mode==='existing'?'selected':''}>${t('Use existing notes','Mevcut notları kullan')}</option></select><label for="access">${t('Access','Erişim')}</label><select id="access" ${locked}><option value="write" ${draft.access!=='read'?'selected':''}>${t('Read and write notes','Notları oku ve yaz')}</option><option value="read" ${draft.access==='read'?'selected':''}>${t('Read notes only','Yalnızca notları oku')}</option></select><p class="hint">${t('Read and write allows automatic note maintenance. Read only does not allow this connection to save notes.','Oku ve yaz, otomatik not bakımına izin verir. Yalnızca okuma seçildiğinde bu bağlantı not kaydedemez.')}</p><fieldset><legend>${t('AI applications','AI uygulamaları')}</legend>${state.hosts.filter(h=>!extending||!state.profile.hosts.some(p=>p.id===h.id)).map(h=>`<label class="check"><input name="host" type="checkbox" value="${h.id}" ${draft.hosts.includes(h.id)?'checked':''}>${esc(h.label)}</label>`).join('')}</fieldset><p>${t('The selected language applies to new protocol files. Existing notes will not be translated or replaced.','Seçilen dil yeni protokol dosyalarına uygulanır. Mevcut notlar çevrilmez veya değiştirilmez.')}</p><div class="actions">${extending?btn('Cancel','Vazgeç','exit-setup'):'<span></span>'}${btn('Continue','Devam et','preview',true)}</div>`;
}
async function renderPanel(){const p=state.profile;
 if(!p)throw new Error('Memory is not configured.');
 if(view==='companion'){renderCompanion();return;}
 if(view==='settings'){content.innerHTML=`<h1>${t('Settings','Ayarlar')}</h1><p>${t('The application and newly installed memory files use the setup language. Updates and protocol maintenance are collected here.','Uygulama ve yeni kurulan hafıza dosyaları kurulum dilini kullanır. Güncelleme ve protokol bakımı burada toplanır.')}</p>`;return;}
 const hosts=await api.connections();healthData=await api.health();if(api.reviewStatus)for(const h of hosts)reviewResults[h.id]=await api.reviewStatus(h.id).catch(e=>({status:'invalid',message:e.message}));if(view==='connections')remoteStatus=await api.connectorStatus();
 if(obsidianPresent===null)obsidianPresent=await api.obsidianInstalled().catch(()=>null);
 if(updateInfo===null)updateInfo=await api.updates().catch(()=>({available:false}));
 // The proof round trip should not be a copy-paste chore when we can open the CLI ourselves.
 try{const preview=await api.scanPreview(language);cliReady=Object.fromEntries(preview.hosts.map(h=>[h.id,h.available]));}catch{cliReady={};}
 probeIssue='';if(!healthData||!healthData.vaultMissing){try{await api.checkFiles();}catch(err){probeIssue=err?.message||String(err);}}
 // The server check spawns the exact command each host is configured to run, so it is done
 // once per render of this view rather than on every keystroke elsewhere.
 if(view==='connections'){try{selfCheck=await api.selfCheck();}catch(err){selfCheck={checkedAt:null,connections:[],error:err?.message||String(err)};}}
 if(autoChallenge){autoChallenge=false;}
 content.innerHTML=`<h1>${view==='home'?t('Your memory','Hafızan'):t('AI connections','AI bağlantıları')}</h1>${notice?`<p role="status">${esc(notice)}</p>`:''}`;
 if(view==='home'){const notes=await api.activity();content.insertAdjacentHTML('beforeend',`<section class="vault-section"><h2>${t('Notes folder','Not klasörü')}</h2><p class="path">${esc(p.vault)}</p><div class="toolbar">${btn('Open in Obsidian','Obsidian’da aç','obsidian',true)}${btn('Open folder','Klasörü aç','vault')}${obsidianPresent===false?btn('Download Obsidian','Obsidian’ı indir','download-obsidian'):''}</div>${updateInfo?.available?`<div class="health-row health-warn"><div><span>${t('Update','Güncelleme')}</span><p>${t('Version ','Sürüm ')}${esc(updateInfo.latest)}${t(' is available.',' hazır.')}</p></div>${btn('Update now','Şimdi güncelle','download-update',true)}<span id="update-status" role="status"></span></div>`:''}${healthRow()}<details><summary>${t('Recent notes','Son notlar')}</summary>${notes.length?notes.map(n=>`<div class="note-row"><span>${esc(n.name)}</span><time>${new Date(n.modified).toLocaleDateString(language)}</time></div>`).join(''):`<p>${t('No notes yet.','Henüz not yok.')}</p>`}</details></section>`);}
 if(view==='connections')content.insertAdjacentHTML('beforeend',`<p>${t('Choose an AI to connect it, run a test or read its first review.','Bağlamak, test etmek veya ilk tarama sonucunu görmek için bir AI seç.')}</p><div class="toolbar">${state.hosts.some(h=>!p.hosts.some(x=>x.id===h.id))?btn('Add connection','Bağlantı ekle','add-hosts'):''}</div><p class="restart-hint">${t('After installing or updating Claudian, restart the AI applications you use: ','Claudian kurulumu veya güncellemesinden sonra kullandığın AI uygulamalarını yeniden başlat: ')}${hosts.filter(h=>!remoteHost(h)).map(h=>esc(h.label)).join(', ')}.</p><section class="connection-grid" aria-label="${t('AI connection status','AI bağlantı durumu')}">${hosts.map(connectionTile).join('')}</section>${connectionDialog(hosts)}`);
}

function connectionDetail(h){return remoteHost(h)?remoteHostCard(h):`<div class="connection"><div class="row"><div><strong>${esc(h.label)}</strong><span class="badge">${h.status==='ready'?t('Files installed','Dosyalar kurulu'):t('Needs attention','Kontrol gerekli')}</span></div></div>${connectionSteps(h)}${selfCheckRow(h)}${accessRow(h)}${verifyRow(h)}${firstScanRow(h)}${memoryRow(h)}<details class="usage-details"><summary>${t('How to use this connection','Bu bağlantı nasıl kullanılır?')}</summary>${usageRow(h)}</details><details><summary>${t('Configuration and repair','Yapılandırma ve onarım')}</summary>${btn('Remove connection','Bağlantıyı kaldır','remove',false,`data-host="${h.id}"`)}${capabilityRow(h)}<p>${t('Skill: claudian-memory. Automatic startup uses the host’s rules. Manual: ','Skill: claudian-memory. Otomatik başlangıç uygulamanın kurallarını kullanır. Elle: ')}${manualCommand(h)}</p>${h.files.map(f=>`<div class="config-file"><span>${t(f.kind==='skill'?'Memory skill':'Startup instructions',f.kind==='skill'?'Hafıza skill’i':'Başlangıç talimatı')}</span><p class="path">${esc(f.path)}</p>${btn('Show file','Dosyayı göster','configuration',false,`data-host="${h.id}" data-kind="${f.kind}"`)}${btn('Repair','Onar','repair',false,`data-host="${h.id}"`)}<span class="badge">${t({ready:'Installed',missing:'Missing',changed:'Modified',unreadable:'Unreadable'}[f.status],{ready:'Kurulu',missing:'Eksik',changed:'Değiştirilmiş',unreadable:'Okunamıyor'}[f.status])}</span></div>`).join('')}</details>${removing===h.id?`<div class="remove-confirm"><p>${t('Remove this connection? Your notes stay. Files still used by other connections are kept. Restart this AI application afterward.','Bu bağlantı kaldırılsın mı? Notların ve diğer bağlantıların kullandığı dosyalar korunur. Ardından bu AI uygulamasını yeniden başlat.')}</p>${btn('Keep connection','Bağlantıyı koru','dismiss-remove')}${btn('Remove connection','Bağlantıyı kaldır','confirm-remove',false,`data-host="${h.id}"`)}</div>`:''}</div>`;}
function connectionTile(h){
 const info=healthData?.hosts?.find(x=>x.id===h.id), review=reviewResults[h.id];
 const cloudReady=(remoteStatus?.grants||[]).some(g=>g.host===h.id&&!g.revoked);
 const broken=(h.id==='chatgpt'?!cloudReady:h.status!=='ready')||['invalid','failed','expired'].includes(review?.status);
 const verified=info?.state==='verified', done=verified&&review?.status==='completed'&&!broken;
 const tone=broken?'issue':done?'complete':verified?'verified':'pending';
 const label=broken?t('Needs attention','Kontrol gerekli'):done?t('Completed','Tamamlandı'):verified?t('Review pending','İlk tarama bekliyor'):t('AI test pending','AI testi bekliyor');
 return `<button class="connection-tile" data-action="connection-open" data-host="${esc(h.id)}" data-state="${tone}" aria-haspopup="dialog"><span class="tile-heading"><strong>${esc(h.label)}</strong><span class="tile-mark">${done?checkIcon:broken?'!':'↗'}</span></span><span class="tile-status">${label}</span><span class="tile-evidence">${verified?t('Read/write verified','Okuma/yazma doğrulandı'):t('Reading and writing not yet proven','Okuma/yazma henüz kanıtlanmadı')}</span></button>`;
}
function connectionDialog(hosts){
 const host=hosts.find(h=>h.id===selectedConnection);if(!host)return '';
 return `<dialog id="connection-dialog" aria-labelledby="connection-title"><header class="connection-dialog-header"><h2 id="connection-title">${esc(host.label)}</h2>${btn('Close','Kapat','connection-close')}</header><div class="connection-dialog-body">${connectionDetail(host)}${remoteHost(host)?remoteSettings():''}</div></dialog>`;
}

let renderedView=null,renderQueue=Promise.resolve();
function render(){
 const next=renderQueue.then(renderNow,renderNow);renderQueue=next.catch(()=>{});return next;
}
async function renderNow(){
 const preserve=renderedView===view;
 const expanded=preserve?[...content.querySelectorAll('details')].map((d,i)=>d.open?i:-1).filter(i=>i>=0):[];
 const y=window.scrollY, dialogY=document.querySelector('.connection-dialog-body')?.scrollTop||0;await renderContent();renderedView=view;
 const dialog=document.querySelector('#connection-dialog');if(dialog){dialog.showModal();dialog.addEventListener('cancel',()=>{selectedConnection=null;});dialog.querySelector('.connection-dialog-body').scrollTop=dialogY;}
 const details=[...content.querySelectorAll('details')];for(const i of expanded)if(details[i])details[i].open=true;
 if(preserve)window.scrollTo(0,y);
}
async function renderContent(){header();if(reviewing){renderReview();return;}const result=await (setup||extending?renderSetup():renderPanel());if(state.profile&&view==='settings'&&!extending&&!setup){content.insertAdjacentHTML('beforeend',`<section class="updates"><p>Claudian ${esc(state.appVersion)} · Protocol ${esc(state.profile.protocolVersion)}</p>${state.protocolConflicts?.length?`<div class="health-row health-warn"><div><span>${t('Protocol','Protokol')}</span><p>${t('Your memory protocol is older than this version and was left untouched because it differs from what Claudian installed.','Hafıza protokolün bu sürümden eski ve Claudian kurulumundan farklı olduğu için değiştirilmedi.')}</p><p class="path">${state.protocolConflicts.map(f=>esc(f.split(/[\\/]/).pop())).join(' · ')}</p></div>${btn('Install the current protocol','Güncel protokolü kur','adopt-protocol',true)}</div>`:''}${state.connectionConflicts?.length?`<div class="health-row health-warn"><div><span>${t('Connection files','Bağlantı dosyaları')}</span><p>${t('These files carry changes Claudian did not write, so they were left alone. Repair the connection to reinstall them.','Bu dosyalarda Claudian’ın yazmadığı değişiklikler var, bu yüzden dokunulmadı. Yeniden kurmak için bağlantıyı onar.')}</p><p class="path">${state.connectionConflicts.map(f=>esc(f.split(/[\/]/).pop())).join(' · ')}</p></div>${btn('Go to connections','Bağlantılara git','goto-connections')}</div>`:''}${btn('Check for updates','Güncellemeleri kontrol et','updates')}<span id="update-status" role="status"></span></section>`);}return result;}
// companion-bridge.cjs throws one of three exact codes. Collapsing them into a single
// sentence made an offline Core look like a wrong access code, so the reader concluded
// their data was gone. Each case is named, and the unreachable case says the code was
// never checked and nothing was changed.
function coreIssue(error,stale){const code=String(error&&error.message||'');
 if(code==='CORE_AUTH_REQUIRED')return t('That access code was not accepted. Check it and try again.','Bu access code kabul edilmedi. Kodu kontrol edip tekrar dene.');
 if(code==='CORE_RATE_LIMIT')return t('Too many attempts. Wait a few minutes before trying again.','Çok fazla deneme yapıldı. Tekrar denemeden önce birkaç dakika bekle.');
 return t('The Core did not answer, so the code was never checked. The Core runs on your own machine — start it there, then connect. Nothing was changed.','Core cevap vermedi, yani kod hiç denenmedi. Core kendi makinende çalışır — orada başlat, sonra bağlan. Hiçbir şey değişmedi.')+(stale?' '+t('The last received state is still shown.','Son alınan durum gösteriliyor.'):'');}
// The grant screen is the only place where a choice changes what will be written, so the scope
// re-prepares the plan: the file list under it must always be the list this scope produces.
document.addEventListener('change',async e=>{
 const confirm=e.target.closest('#grant-confirm');
 if(confirm){granted=confirm.checked;await render();return;}
 const scope=e.target.closest('[name=grant-scope]');
 if(scope&&plan&&!busy){
  draft.access=scope.value;granted=false;
  try{plan=await api.prepare(draft);}catch(err){error(err);}
  await render();
 }
});
document.addEventListener('click',async e=>{const nav=e.target.closest('[data-view]');if(nav&&!busy){view=nav.dataset.view;selectedConnection=null;notice='';await render();return;}const el=e.target.closest('[data-action]');if(!el||busy&&el.dataset.action!=='cancel')return;el.disabled=true;errorBox.hidden=true;try{const a=el.dataset.action;
 if(a==='connection-open'){selectedConnection=el.dataset.host;await render();return;}
 if(a==='connection-close'){const id=selectedConnection;selectedConnection=null;document.querySelector('#connection-dialog')?.close();await render();document.querySelector(`[data-action=connection-open][data-host="${id}"]`)?.focus();return;}
 if(a==='review-apply'){selectedHosts=[...document.querySelectorAll('[name=review-host]:checked')].map(x=>x.value);busy=true;await render();try{const installed=(state.profile?.hosts||[]).map(h=>h.id);
  const losing=installed.filter(id=>!selectedHosts.includes(id));
  if(losing.length&&!losing.every(id=>withdrawing.includes(id))){withdrawing=losing;busy=false;await render();return;}
  reviewResult=await api.reviewSetup(selectedHosts,granted,withdrawing);state=await api.snapshot();}finally{busy=false;await render();}return;}
 if(a==='review-done'){await api.finishReview();reviewing=false;view='connections';notice=t('Restart the selected AI applications, then verify each connection below.','Seçtiğin AI uygulamalarını yeniden başlat, ardından aşağıdan her bağlantıyı doğrula.');await render();return;}
 if(a==='review-protocol'){await api.adoptProtocol();state=await api.snapshot();reviewResult={conflicts:state.profile.migration?.conflicts||[]};await render();return;}

 if(a==='connector-desktop-install'){const result=await api.connectorDesktopInstall();extensionArchive=result.archive;notice=t('Package path copied. Follow the installation steps below.','Paket yolu kopyalandı. Aşağıdaki kurulum adımlarını izle.');await render();try{await api.openAiApp('claude-desktop');}catch(e){notice=e.message;await render();}return;}
 if(a==='connector-refresh'){await refreshRemote();return;}
 if(a==='connector-default'){remoteStatus=await api.connectorStart();await render();return;}
 if(a==='connector-start'){remoteStatus=await api.connectorStart(document.querySelector('#relay-url').value.trim());await render();return;}
 if(a==='connector-stop'){remoteStatus=await api.connectorStop();await render();return;}
 if(a==='connector-approve'||a==='connector-deny'){remoteStatus=await api.connectorApprove(el.dataset.id,a==='connector-approve');await render();return;}
 if(a==='connector-revoke'){remoteStatus=await api.connectorRevoke(el.dataset.id);await render();return;}
 if(a==='connector-copy'){await api.copy(remoteStatus.urls[el.dataset.host]);el.textContent=t('Address copied','Adres kopyalandı');return;}
 if(a==='connector-provider'){await api.copy(remoteStatus.urls[el.dataset.host]);await api.connectorProvider(el.dataset.host);notice=t('Address copied. Create Claudian Core, choose OAuth and paste it into the MCP URL field.','Adres kopyalandı. Claudian Core bağlantısını oluştur, OAuth seç ve MCP URL alanına yapıştır.');await render();return;}
 if(a==='connector-export'){const result=await api.connectorExport(el.dataset.host);if(result){notice=t('Plugin package prepared. Installation in the provider is still required.','Eklenti paketi hazırlandı. Sağlayıcıda kurulması gerekiyor.');await render();}return;}
 if(a==='core-connect'){try{companionData=await api.companionConnect(document.querySelector('#core-code').value);companionIssue='';}catch(e){companionIssue=coreIssue(e,false);}await render();}
 if(a==='core-refresh'){try{companionData=await api.companionRefresh();companionIssue='';}catch(e){companionIssue=coreIssue(e,Boolean(companionData));}await render();}
 if(a==='core-disconnect'){await api.companionDisconnect();companionData=null;companionIssue='';await render();}


 if(a==='copy-memory-trigger'){await api.copy(await api.memoryTrigger(el.dataset.host));el.textContent=t('Copied — this is a preference, not a connection test','Kopyalandı — bu bir tercih, bağlantı testi değil');return;}
 if(a==='scan-back'){view='home';await render();}

 if(a==='existing-skill')await api.existingSkill(el.dataset.host);

 if(a==='add-hosts'){extending=true;plan=null;events=[];complete=false;const d=await api.discover();draft={name:state.profile.name,vault:state.profile.vault,storage:state.profile.storage,mode:'existing',action:'extend',language,hosts:d.suggested.hosts.filter(id=>!state.profile.hosts.some(h=>h.id===id))};await render();}
 if(a==='folder'){capture();const folder=await api.chooseFolder();if(folder){draft.vault=folder;}await render();}
 // A grant belongs to the plan it was given for. Reaching this screen again, or leaving it,
 // withdraws it: the next set of files must be granted on its own terms.
 if(a==='preview'){capture();granted=false;plan=await api.prepare(draft);await render();}
 if(a==='back'||a==='retry'){plan=null;granted=false;events=[];await render();}
 if(a==='install'){if(!granted)return;busy=true;events=[];await render();try{await api.install(plan.id,true);state=await api.snapshot();complete=true;}finally{busy=false;await render();}}
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
 if(a==='goto-connections'){view='connections';await render();return;}
 if(a==='adopt-protocol'){const r=await api.adoptProtocol();state=await api.snapshot();notice=t('The current protocol is installed. Your earlier version was kept beside it: ','Güncel protokol kuruldu. Önceki sürümün yanına saklandı: ')+(r.kept.join(', ')||'—');await render();return;}
 if(a==='download-update'){const status=document.querySelector('#update-status');if(status)status.textContent=t(' Downloading the installer…',' Kurulum dosyası indiriliyor…');const r=await api.downloadUpdate();if(status)status.textContent=t(' Installer '+r.version+' opened. Follow it, then reopen Claudian.',' Kurulum '+r.version+' açıldı. Tamamla, sonra Claudian’ı yeniden aç.');return;}
 if(a==='challenge-start'){if(challenge)await api.cancelVerify(challenge.host);verifyRequest++;verifyNotice='';verifyState='ready';challenge={host:el.dataset.host,prompt:(await api.challenge(el.dataset.host)).prompt};await render();return;}
 if(a==='open-in-ai'){
  const scanning=el.dataset.copy==='copy-scan',prompt=scanning?firstScan?.prompt:challenge?.prompt;
  if(!prompt)return;await api.copy(prompt);
  if(!scanning)startVerification();
  await api.openAiApp(el.dataset.host);
  notice=t('Instruction copied. Paste and send it in a new conversation with Claudian enabled.','Yönerge kopyalandı. Claudian etkin olan yeni bir sohbete yapıştırıp gönder.');await render();return;
 }
 if(a==='scan-open'){notice='';firstScan=await api.reviewStart(el.dataset.host);reviewResults[el.dataset.host]={status:'waiting'};await render();return;}
 if(a==='scan-close'){firstScan=null;notice='';await render();return;}
 if(a==='run-scan'){await api.scanSend(el.dataset.host,firstScan.prompt);notice=t('Session opened. The review runs there; its notes land in your folder.','Oturum açıldı. Tarama orada çalışıyor; notları klasörüne düşer.');await render();return;}
 if(a==='copy-scan'){await api.copy(firstScan.prompt);notice=t('Instruction copied. Paste it into the application.','Yönerge kopyalandı. Uygulamaya yapıştır.');await render();return;}
 if(a==='challenge-close'){if(challenge)await api.cancelVerify(challenge.host);verifyRequest++;challenge=null;verifyNotice='';verifyState='';await render();return;}
 if(a==='gemini-login'){await api.geminiLogin();notice=t('Finish sign-in in the Gemini terminal, then run the test.','Gemini terminalinde girişi tamamla, sonra testi çalıştır.');await render();return;}
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
api.onVerify(async event=>{if(!challenge||event.host!==challenge.host||event.requestId!==verifyRequest)return;const message=event.message||verifyNotice;if(verifyState===event.state&&verifyNotice===message)return;verifyState=event.state;verifyNotice=message;await render();});
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
 // The folder this screen confirms may not exist: uninstalling the program left the profile
 // behind, so a reinstall resumed it and the user was shown a notes folder they had deleted.
 // Until a real folder is settled there is nothing to review, and Apply stays closed.
 const gone=state.vaultMissing;
 content.innerHTML='<h1>'+t('Review your installation','Kurulumunu gözden geçir')+'</h1><p>'+(gone?t('Your previous notes folder is not there any more. Choose where your notes should live before connecting anything.','Önceki not klasörün artık yok. Bir şey bağlamadan önce notlarının nerede duracağını seç.'):t('We found settings from your previous installation. Confirm your notes folder and choose which AI applications should stay connected.','Önceki kurulumundan ayarlar bulundu. Not klasörünü kontrol et ve hangi AI uygulamalarının bağlı kalacağını seç.'))+'</p><h2>'+t('Notes folder','Not klasörü')+'</h2><p class="path">'+esc(p.vault)+'</p>'+(gone?'<div class="health-row health-warn"><div><span>'+t('Not found','Bulunamadı')+'</span><p>'+t('Nothing was deleted by this app. Point Claudian at the folder, or create it again here.','Bu uygulamadan hiçbir şey silinmedi. Klasörü göster ya da burada yeniden oluştur.')+'</p></div>'+btn('Choose folder','Klasör seç','relocate',true)+btn('Create it again','Yeniden oluştur','relocate-same')+'<span id="relocate-status" role="status"></span></div>':'<div class="toolbar">'+btn('Choose another folder','Başka klasör seç','relocate')+'</div>')+'<fieldset><legend>'+t('AI applications','AI uygulamaları')+'</legend>'+state.hosts.map(h=>'<label class="check"><input name="review-host" type="checkbox" value="'+esc(h.id)+'" '+(selectedHosts.includes(h.id)?'checked':'')+(busy?' disabled':'')+'>'+esc(h.label)+'</label>').join('')+'</fieldset><p>'+t('Apply will repair selected local connections and update managed protocol files. Unchecked connections will be removed; your notes stay. Account sign-in and permissions requested by the AI must still be completed there.','Uygula, seçili yerel bağlantıları onarır ve yönetilen protokol dosyalarını günceller. İşaretini kaldırdığın bağlantılar kaldırılır; notların korunur. AI’ın hesap girişi ve kendi izin onayı o uygulamada tamamlanır.')+'</p><p>'+t('ChatGPT requires a remote connector; selecting it does not install a working cloud connection.','ChatGPT uzak connector gerektirir; burada seçmek çalışan bir bulut bağlantısı kurmaz.')+'</p>'+((state.profile?.hosts||[]).filter(h=>!selectedHosts.includes(h.id)).length?'<div class="health-row health-warn"><div><span>'+t('These connections will be removed','Bu bağlantılar kaldırılacak')+'</span><p>'+(state.profile.hosts.filter(h=>!selectedHosts.includes(h.id)).map(h=>esc(h.label)).join(' · '))+'</p><p>'+t('Their files are withdrawn from those applications. Your notes stay exactly where they are.','Dosyaları o uygulamalardan geri alınır. Notların olduğu yerde kalır.')+'</p></div></div>':'')+ '<p>'+t('This confirms local configuration changes by Claudian, not acceptance of a user agreement. The selected AI applications use the folder shown above with your existing access level: ','Bu onay, kullanıcı sözleşmesi kabulü değil; Claudian’ın yerel ayar değişikliklerini uygulaması içindir. Seçili AI uygulamalarının yukarıdaki klasör için mevcut erişim düzeyi: ')+t(p.access==='write'?'read, create, update and archive notes.':'read notes only.',p.access==='write'?'notları okuma, oluşturma, güncelleme ve arşivleme.':'yalnızca notları okuma.')+'</p><p>'+t('When an AI reads a note, that content may be processed by its provider. This step does not sign in or authorize a cloud account; cloud access is approved separately.','AI bir notu okuduğunda içerik o AI sağlayıcısında işlenebilir. Bu adım hesap girişi yapmaz veya bulut hesabına izin vermez; bulut erişimi ayrıca onaylanır.')+'</p>'+'<label class="check grant-confirm"><input type="checkbox" id="grant-confirm" '+(granted?'checked':'')+'><span>'+t('Allow Claudian to apply these local connection changes.','Claudian’ın bu yerel bağlantı değişikliklerini uygulamasına izin veriyorum.')+'</span></label>'+(busy?'<p role="status"><span class="verify-spinner"></span> '+t('Applying your choices…','Seçimlerin uygulanıyor…')+'</p>':btn('Apply choices','Seçimleri uygula','review-apply',true,(gone||!granted)?'disabled':''))+(reviewResult?'<section role="status"><h2>'+t('Installation result','Kurulum sonucu')+'</h2><p>'+ (conflicts.length?t('Some modified files were preserved. Review them before considering setup complete.','Değiştirilmiş bazı dosyalar korundu. Kurulumu tamamlandı saymadan bunları kontrol et.'):t('Selected local connections and managed files were checked. Now test them in the AI.','Seçili yerel bağlantılar ve yönetilen dosyalar kontrol edildi. Şimdi AI içinde test et.'))+'</p>'+conflicts.map(f=>'<p class="path">'+esc(f)+'</p>').join('')+(conflicts.some(f=>/Protocol|CHATGPT.md|CLAUDE.md|CODEX.md/.test(f))?btn('Back up and update protocol copies','Protokol kopyalarını yedekle ve güncelle','review-protocol'):'')+'<div class="actions">'+btn('Go to connection tests','Bağlantı testlerine geç','review-done',true)+'</div></section>':'');
}
