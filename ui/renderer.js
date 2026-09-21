'use strict';
const api=window.claudian, content=document.querySelector('#content'), errorBox=document.querySelector('#error');
let challenge=null, verifyNotice='', verifyState='', firstScan=null, healthData=null, obsidianPresent=null, probeIssue='', cliReady={}, updateInfo=null, autoChallenge=false;
let state, draft, plan, language='en', extending=false, busy=false, complete=false, events=[], view='home', removing=null, notice='', panelState=null;
const setup=document.body.dataset.surface==='setup';
let reviewing=false, reviewResult=null, selectedHosts=[], verifyRequest=0;
// Claudian checks its own connections instead of handing the check back to the user.
let selfCheck=null, selectedConnection=null;
// Restart is only claimed when the application actually said so: memory:obsidian returns
// needsClose when the vault is not registered yet and Obsidian.exe is running. Nothing else
// sets this flag, so the warning can never appear on a guess.
let obsidianNeedsClose=false, connectionList=[];
let remoteStatus=null,remoteRefreshBusy=false,extensionArchive='';
let reviewResults={},reviewRefreshBusy=false;
const checkIcon='<svg class="step-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
function connectionSteps(h){
 const info=healthData?.hosts?.find(x=>x.id===h.id),review=reviewResults[h.id];
 return `<ol class="connection-steps" aria-label="${t('Connection progress','Bağlantı ilerlemesi')}">${[[h.status==='ready',t('Files ready','Dosyalar hazır')],[info?.state==='verified',t('AI read/write','AI okuma/yazma')],[review?.status==='completed',t('First review','İlk tarama')]].map(([done,label],i)=>`<li data-complete="${done===true}"><span class="step-symbol">${done?checkIcon:i+1}</span>${label}</li>`).join('')}</ol>`;
}
function appActions(h,copyAction,done=false){
 return `${btn('Copy instruction','Yönergeyi kopyala',copyAction)}${['codex','claude-code','claude-desktop','chatgpt','gemini','perplexity','antigravity','antigravity-cli','cursor'].includes(h.id)?btn(['chatgpt','gemini','perplexity'].includes(h.id)?'Copy and open website':'Copy and open app',['chatgpt','gemini','perplexity'].includes(h.id)?'Kopyala ve web sitesini aç':'Kopyala ve uygulamayı aç','open-in-ai',!done&&!cliReady[h.id],`data-host="${h.id}" data-copy="${copyAction}"`):''}`;
}
const remoteHost=h=>['chatgpt','claude-desktop','gemini','perplexity'].includes(h.id);
function remoteStatusBody(){
 const s=remoteStatus||{state:'stopped',requests:[],grants:[]};
 const label={online:t('Device online','Cihaz çevrimiçi'),connecting:t('Connecting device','Cihaz bağlanıyor'),offline:t('Device offline','Cihaz çevrimdışı'),stopped:t('Device connection stopped','Cihaz bağlantısı kapalı')}[s.state]||s.state;
 return `<p role="status"><strong>${esc(label)}</strong>${s.lastError?' — '+esc(s.lastError):''}</p>`
  +(s.requests||[]).map(r=>`<section class="grant"><h3>${t('Approve AI connection','AI bağlantısını onayla')}</h3><p class="claimed-name">${t('The application name and return address below are reported by the requesting application itself. Claudian cannot verify them. Approve only a request whose code matches the one on your screen.','Aşağıdaki uygulama adı ve dönüş adresi, isteği yapan uygulamanın kendi beyanıdır; Claudian bunları doğrulayamaz. Yalnız ekranındaki kodla eşleşen isteği onayla.')}</p><p>${t('Only approve if the code matches the browser you opened. The application name is supplied by the requesting client.','Yalnızca açtığın tarayıcıdaki kodla eşleşiyorsa onayla. Uygulama adı, bağlantı isteyen istemci tarafından gönderilir.')}</p><p><strong>${esc(r.code)}</strong> · ${esc(r.name)} · ${esc(r.host)}</p><p class="path">${esc(new URL(r.redirect).hostname)}</p><p>${esc(r.scope)}<br>${esc(r.vault)}</p>${btn('Approve this connection','Bu bağlantıya izin ver','connector-approve',true,`data-id="${esc(r.id)}"`)}${btn('Deny','Reddet','connector-deny',false,`data-id="${esc(r.id)}"`)}</section>`).join('')
  +(s.grants||[]).map(g=>`<div class="config-file"><strong>${esc(g.name)}</strong> · <span>${esc(g.host)} · ${esc(g.revoked?t('Revoked','İzin kaldırıldı'):g.lastSeen?t('AI contacted this device','AI bu cihaza ulaştı'):t('Permission given; setup incomplete','İzin verildi; kurulum tamamlanmadı'))}</span><p>${esc(g.scope)}${g.lastTool?' · '+esc(g.lastTool):''}${g.lastSeen?' · '+esc(new Date(g.lastSeen).toLocaleString()):''}</p>${g.revoked?'':btn('Revoke account access','Hesap erişimini kaldır','connector-revoke',false,`data-id="${esc(g.id)}"`)}</div>`).join('');
}
function remoteSettings(){
 return `<details class="connection cloud-settings"><summary>${t('Cloud connection settings','Bulut bağlantısı ayarları')}</summary><p>${t('A relay carries requests between your AI account and this computer. It is not an account login. Keep Claudian and this computer running while using it. Requested note content passes through this service.','Relay, AI hesabın ile bu bilgisayar arasındaki istekleri taşıyan hizmettir. Bir hesap giriş alanı değildir. Kullanırken Claudian ve bu bilgisayar açık kalır; istenen not içeriği bu hizmetten geçer.')}</p>${!remoteStatus?.relay?`<p class="health-warn">${t('Connect through the Claudian relay. Your device address will appear here after connecting.','Claudian relay üzerinden bağlan. Bağlandıktan sonra cihaza ait adres burada görünür.')}</p>`:''}<div id="remote-status">${remoteStatusBody()}</div>${!remoteStatus?.enabled?btn("Connect this device","Bu cihazı bağla","connector-default",true):""}<details><summary>${t('Advanced · self-hosted service','Gelişmiş · kendi hizmetini kullan')}</summary><p>${t('For administrators running a Claudian relay. Enter the HTTPS endpoint supplied by that service; an ordinary website address will not work.','Claudian relay çalıştıran yöneticiler içindir. O hizmetin sağladığı HTTPS adresini gir; sıradan bir web sitesi adresi çalışmaz.')}</p><label for="relay-url">${t('Claudian relay endpoint','Claudian relay adresi')}</label><input id="relay-url" type="url" value="${esc(remoteStatus?.relay||'')}" ${remoteStatus?.enabled?'disabled':''}>${remoteStatus?.enabled?'':btn('Connect configured service','Tanımlanan hizmete bağlan','connector-start')}</details><div class="toolbar">${remoteStatus?.enabled?btn('Disconnect device','Cihaz bağlantısını kapat','connector-stop'):''}${btn('Refresh connection state','Bağlantı durumunu yenile','connector-refresh')}</div></details>`;
}
function desktopExtensionCard(h){
 return h.id==='claude-desktop'?`<section class="connection"><h3>Claude Desktop</h3><p>${t("Install the local extension to use your selected memory in Claude Desktop. Confirm installation in the Claude window that opens.","Seçili hafızanı Claude Desktop içinde kullanmak için yerel eklentiyi kur. Açılan Claude penceresinde kurulumu onayla.")}</p>${btn("Install Claude Desktop extension","Claude Desktop eklentisini kur","connector-desktop-install",true)}</section>`:'';
}
// These steps record navigation only. They never grant or verify access.
function setupKey(id){return 'claudian-setup:'+state?.profile?.vault+':'+id;}
function setupStep(id){try{return localStorage.getItem(setupKey(id))||'auto';}catch{return 'auto';}}
function saveSetupStep(id,step){try{localStorage.setItem(setupKey(id),step);}catch{}}
// What the provider itself currently requires. Never a guess, and never two answers at once:
// where the vendor's rule depends on the access this connection asks for, the rule is written
// out that way instead of picking one half and printing it as fact. Source for ChatGPT:
// OpenAI Help Center, "Developer mode and MCP apps in ChatGPT" (read 20.09.2026) -- "Full MCP
// is only available to Business and Enterprise/Edu users, currently. Pro users can connect
// MCPs with read/fetch permissions in developer mode." and "Are MCP apps available on
// mobile? No - web only."
const hostRequirement=id=>({
 chatgpt:t('Custom MCP app on ChatGPT web only. Read and write needs Business or Enterprise/Edu; Pro can connect read-only in developer mode.','Yalnızca ChatGPT web üzerinde özel MCP uygulaması. Okuma ve yazma için Business veya Enterprise/Edu gerekir; Pro, developer mode ile yalnızca okuma bağlayabilir.'),
 gemini:t('Runs inside Spark, not ordinary Gemini chat. Needs Spark custom apps on your Google account.','Normal Gemini sohbetinde değil, Spark içinde çalışır. Google hesabında Spark özel uygulamaları gerekir.'),
 perplexity:t('Needs custom connectors; not offered on every account.','Özel bağlantı ekleme özelliği gerekir; her hesapta sunulmaz.')}[id]||'');
function webHostCard(h){
 const p=remoteStatus?.progress?.[h.id]||{phase:'setup',canTest:false};
 const verified=healthData?.hosts?.find(x=>x.id===h.id)?.state==='verified';
 const pending=(remoteStatus?.requests||[]).filter(r=>r.host===h.id);
 const step=setupStep(h.id), host=`data-host="${h.id}"`;
 const action=(en,tr,stage,primary=true)=>btn(en,tr,'cloud-step',primary,`${host} data-step="${stage}"`);
 const title=t('Connect '+h.label,h.label+' bağlantısını kur');
 const setupName=h.id==='gemini'?'Spark için özel uygulamalar':h.id==='perplexity'?'+ Custom connector':'Create app / Uygulama oluştur';
 const select=t(h.id==='chatgpt'?'In a new ChatGPT chat, select Claudian — Bu cihaz from the + menu.':h.id==='gemini'?'Turn on Spark and select the Claudian custom app. Ordinary Gemini chat cannot use it.':'Select your Claudian connector in the conversation.',h.id==='chatgpt'?'Yeni ChatGPT sohbetinde + menüsünden Claudian — Bu cihaz uygulamasını seç.':h.id==='gemini'?'Spark’ı aç ve özel Claudian uygulamasını seç. Normal Gemini sohbeti bu bağlantıyı kullanamaz.':'Sohbette Claudian bağlantısını seç.');
 let body='';
 if(pending.length){body=pending.map(r=>`<h3>${t('Confirm the matching code','Eşleşen kodu onayla')}</h3><p>${t('Compare this with the code in the browser.','Bu kodu tarayıcıdaki kodla karşılaştır.')} <strong class="pairing-code">${esc(r.code)}</strong></p><p>${t('This application is requesting access: ','Erişim isteyen uygulama: ')}${esc(r.name)} · ${esc(new URL(r.redirect).hostname)}</p><p>${t('Permission covers your selected notes folder: ','İzin seçili not klasörün içindir: ')}${esc(r.vault)}. ${r.scope.includes('claudian.write')?t('Read and update notes.','Notları okuma ve güncelleme.'):t('Read notes.','Notları okuma.')}</p><div class="toolbar">${btn('Codes match — allow','Kodlar eşleşiyor — izin ver','connector-approve',true,`data-id="${esc(r.id)}"`)}${btn('Deny','Reddet','connector-deny',false,`data-id="${esc(r.id)}"`)}</div>`).join('');}
 else if(p.canTest){body=`<h3 class="${verified?'health-ok':''}">${verified?checkIcon+t('Access verified','Erişim doğrulandı'):t('Now use the connected conversation','Şimdi bağlantının seçili olduğu sohbeti kullan')}</h3><p>${select}</p>${verifyRow({...h,access:{state:'ready',scope:'write'}})}${firstScanRow(h)}`;}
 else if(step==='unavailable'){body=`<h3>${t('This account cannot continue here','Bu hesapla burada devam edilemiyor')}</h3><p>${t('The provider does not show the required add-app option. No connection was installed. There is no test to run yet.','Sağlayıcı gereken uygulama ekleme seçeneğini göstermiyor. Bağlantı kurulmadı; henüz çalıştırılacak bir test yok.')}</p>${action('Try another account or check again','Başka hesapla dene veya yeniden bak','start',false)}`;}
 else if((['auto','waiting'].includes(step)&&['authorizing','loading'].includes(p.phase))||step==='waiting'){body=`<h3>${t('Finish in '+h.label,h.label+' içindeki onayı tamamla')}</h3><p>${t('If the new app is listed, open it and choose Connect. After permission is approved, this window will advance when the AI requests its tools.','Yeni uygulama listeleniyorsa açıp Bağlan / Connect düğmesine bas. İzin onayından sonra AI araçlarını istediğinde bu pencere ilerleyecek.')}</p><p>${select}</p><div class="toolbar">${btn('Open '+h.label,h.label+' aç','cloud-open',true,host)}${action('Connection is stuck','Bağlantı ilerlemiyor','repair',false)}</div>`;}
 else if(step==='form'){body=`<h3>${t('Fill the opened form','Açılan formu doldur')}</h3><p>${t('Use the ready values below. You do not need to write an address or create a password.','Aşağıdaki hazır değerleri kullan. Adres yazman veya şifre oluşturman gerekmiyor.')}</p><div class="setup-fields">${h.id==='gemini'?'':`<div><span>${t('Name','Ad')}</span><strong>Claudian — Bu cihaz</strong>${btn('Copy name','Adı kopyala','cloud-name',false,host)}</div>`}<div><span>${h.id==='gemini'?t('App URL','Uygulama URL’si'):'MCP Server URL'}</span><strong>${t('Your device address is ready','Cihaz adresin hazır')}</strong>${btn('Copy address','Adresi kopyala','connector-copy',false,host)}</div>${h.id==='gemini'?'':`<div><span>${t('Authentication','Kimlik doğrulama')}</span><strong>OAuth</strong></div>`}${h.id==='perplexity'?'<div><span>Transport</span><strong>Streamable HTTP</strong></div>':''}</div><p>${t('Review the provider’s permission notice, then choose Create, Add or Next.','Sağlayıcının izin açıklamasını incele; ardından Oluştur, Ekle veya İleri düğmesine bas.')}</p>${action('I saved the app — continue','Uygulamayı ekledim — devam et','waiting')}`;}
 else if(step==='opened'){body=`<h3>${t('Find the add button','Ekleme düğmesini bul')}</h3><p>${t('In the page that opened, choose ','Açılan sayfada ')}<strong>${esc(setupName)}</strong>${t('. If you already have Claudian — Bu cihaz, open that connection instead.',' seçeneğini aç. Claudian — Bu cihaz zaten varsa o bağlantıyı aç.')}</p>${h.id==='perplexity'?`<p>${t('Choose Remote in the window that opens.','Açılan pencerede Remote seç.')}</p>`:''}<div class="toolbar">${action('The form is open','Form açıldı','form')}${action('This option is missing','Bu seçenek yok','unavailable',false)}${action('I already added this device','Bu cihazı zaten ekledim','waiting',false)}</div>`;}
 else if(step==='repair'){body=`<h3>${t('Resume the existing connection','Mevcut bağlantıdan devam et')}</h3><p>${t('Open Claudian — Bu cihaz in the provider and reconnect or refresh its tools. The older Claudian Core may point elsewhere. Do not create another copy.','Sağlayıcıda Claudian — Bu cihaz bağlantısını aç ve yeniden bağlan veya araçlarını yenile. Eski Claudian Core başka adrese bağlı olabilir. Yeni bir kopya oluşturma.')}</p><div class="toolbar">${btn('Open connection settings','Bağlantı ayarlarını aç','cloud-begin',true,host)}${action('This option is missing','Bu seçenek yok','unavailable',false)}</div>`;}
 else {body=`<h3>${title}</h3><p>${t('We will open the right settings and prepare the values for you. This window will guide you one step at a time.','Doğru ayarları açıp gereken bilgileri hazırlayacağız. Bu pencere seni tek adımla ilerletecek.')}</p><p>${hostRequirement(h.id)}</p>${btn('Start setup','Kuruluma başla','cloud-begin',true,host)}`;}
 return `<div class="connection cloud-wizard"><ol class="connection-steps" aria-label="${t('Connection progress','Bağlantı ilerlemesi')}">${[[p.phase==='authorizing'||p.phase==='loading'||p.canTest,t('Account permission','Hesap izni')],[p.canTest,t('Tools available','Araçlar hazır')],[verified,t('Access verified','Erişim doğrulandı')]].map(([done,label],i)=>`<li data-complete="${done===true}"><span class="step-symbol">${done?checkIcon:i+1}</span>${label}</li>`).join('')}</ol><section class="setup-current" aria-live="polite">${body}</section><details><summary>${t('Help and connection settings','Yardım ve bağlantı ayarları')}</summary><p>${t('Keep Claudian and this computer running. A saved app or permission alone is not proof of access.','Claudian ve bu bilgisayar açık kalsın. Uygulamanın kaydedilmesi veya izin verilmesi erişim kanıtı değildir.')}</p>${btn('Get step-by-step help from AI','AI’dan adım adım yardım al','connector-help',false,host)}${action('Start the guide again','Kurulum rehberini baştan aç','start',false)}${p.canTest?btn('Open settings','Ayarları aç','connector-provider',false,host):''}${h.id==='gemini'?btn('Gemini manual sharing — no connection','Gemini’de manuel paylaşım — bağlantısız','gemini-web-guide'):''}${memoryRow(h)}</details></div>`;
}
function remoteHostCard(h){
 if(['chatgpt','gemini','perplexity'].includes(h.id))return webHostCard(h);
 const url=remoteStatus?.urls?.[h.id];
 const grants=(remoteStatus?.grants||[]).filter(g=>g.host===h.id&&!g.revoked);
 const localReady=h.id==='claude-desktop'&&remoteStatus?.desktopExtension?.current;
 const verified=healthData?.hosts?.find(x=>x.id===h.id)?.state==='verified';
 const actions=`<div class="toolbar">${btn(h.id==='chatgpt'?'Set up with ChatGPT':'Connect to Claude',h.id==='chatgpt'?'ChatGPT ile kur':'Claude’a bağlan',h.id==='chatgpt'?'connector-help':'connector-provider',true,`data-host="${h.id}"`)}${btn(h.id==='chatgpt'?'Open setup myself':'AI setup help',h.id==='chatgpt'?'Kurulumu kendim aç':'AI ile kurulum yardımı',h.id==='chatgpt'?'connector-provider':'connector-help',false,`data-host="${h.id}"`)}</div>`;
 const cloud=grants.length?`<p class="health-ok">${checkIcon}${t('Account permission approved','Hesap izni onaylandı')}</p><p>${t('Next: verify access in a new AI conversation.','Sıradaki adım: yeni bir AI sohbetinde erişimi doğrula.')}</p>`:`<p>${h.id==='chatgpt'?t('Let ChatGPT help you connect. The setup instruction is copied; paste it into the chat that opens.','Bağlantıyı ChatGPT yardımıyla kur. Kurulum yönergesi kopyalanır; açılan sohbete yapıştır.'):t('Open Claude with the connection name and address already filled in. Review and confirm there.','Claude’u bağlantı adı ve adresi doldurulmuş olarak aç. Orada kontrol edip onayla.')}</p>${actions}<p>${t('Keep Claudian and this computer running during setup and use.','Kurulum ve kullanım boyunca Claudian ve bu bilgisayar açık kalsın.')}</p>`;
 const manual=`<details><summary>${t('Manual setup and old connections','Elle kurulum ve eski bağlantılar')}</summary><p>${t('Use OAuth with this device address. An old claudian.app/api/mcp connection uses a separate tunnel; opening this app does not start that old service. You do not need both local and cloud connections on the same surface.','Bu cihaz adresiyle OAuth kullan. Eski claudian.app/api/mcp bağlantısı ayrı bir tünel kullanır; bu uygulamayı açmak o eski hizmeti başlatmaz. Aynı yüzeyde yerel ve bulut bağlantılarının ikisi birden gerekmez.')}</p>${url?`<p class="path">${esc(url)}</p>${btn('Copy address','Adresi kopyala','connector-copy',false,`data-host="${h.id}"`)}`:''}</details>`;
 if(h.id==='chatgpt')return `<div class="connection"><h2>ChatGPT</h2>${cloud}${grants.length?verifyRow({...h,access:{state:'ready',scope:grants.some(g=>g.scope?.includes('write'))?'write':'read'}})+firstScanRow(h):''}${manual}${memoryRow(h)}</div>`;
 const local=`<details><summary>${t('Local extension and repair','Yerel eklenti ve onarım')}</summary><p>${localReady?t('Local extension is enabled. Its bridge uses the installed Claudian application, so an app update alone does not require reinstalling it.','Yerel eklenti etkin. Bağlantı kurulu Claudian uygulamasını kullanır; sırf uygulama güncellendi diye eklentiyi yeniden kurman gerekmez.'):t('Use this alternative for Claude Desktop local access. Installing the Claudian app prepares its connection files; it does not prove the extension is enabled in Claude.','Claude Desktop yerel erişimi için bu alternatifi kullan. Claudian kurulumu bağlantı dosyalarını hazırlar; eklentinin Claude içinde etkin olduğu anlamına gelmez.')}</p>${localReady?'':btn('Prepare local package','Yerel paketi hazırla','connector-desktop-install',false)}${extensionArchive?`<p>${t('In Claude: Settings → Extensions → Advanced settings → Install Extension. In the file picker paste the copied path into File name, then Open.','Claude içinde Ayarlar → Eklentiler → Gelişmiş ayarlar → Eklenti yükle. Dosya seçicide kopyalanan yolu Dosya adı alanına yapıştır ve Aç düğmesine bas.')}</p><p class="path">${esc(extensionArchive)}</p>`:''}${selfCheckRow(h)}${accessRow(h)}</details>`;
 return `<div class="connection"><h2>Claude</h2>${connectionSteps(h)}${localReady||verified?`<p class="health-ok">${checkIcon}${t('Your existing connection is ready to use','Mevcut bağlantın kullanıma hazır')}</p><p>${t('Continue with this connection. Another extension or web connection is not required.','Bu bağlantıyla devam et. Başka bir eklenti veya web bağlantısı kurman gerekmiyor.')}</p>`:cloud}${verifyRow(h)}${firstScanRow(h)}${local}<details><summary>${t('Also use on web or mobile','Web veya mobilde de kullan')}</summary>${cloud}${manual}</details>${memoryRow(h)}</div>`;
}
async function refreshRemote(){
 if(remoteRefreshBusy)return;remoteRefreshBusy=true;
 try{const before=JSON.stringify([remoteStatus?.desktopExtension,remoteStatus?.urls,remoteStatus?.progress,remoteStatus?.requests?.map(r=>r.id),remoteStatus?.grants?.map(g=>[g.id,g.revoked])]);remoteStatus=await api.connectorStatus();const after=JSON.stringify([remoteStatus?.desktopExtension,remoteStatus?.urls,remoteStatus?.progress,remoteStatus?.requests?.map(r=>r.id),remoteStatus?.grants?.map(g=>[g.id,g.revoked])]);if(before!==after)await render();else{const element=document.querySelector('#remote-status');if(element&&element.innerHTML!==remoteStatusBody())element.innerHTML=remoteStatusBody();}}finally{remoteRefreshBusy=false;}
}
setInterval(()=>{if(view==='connections'&&!busy&&!setup&&!extending)refreshRemote().catch(()=>{});},3000);
setInterval(async()=>{
 if(view!=='connections'||busy||reviewRefreshBusy||!api.reviewStatus)return;
 reviewRefreshBusy=true;
 try{let changed=false;for(const [id,r] of Object.entries(reviewResults))if(r.status==='waiting'){
  const next=await api.reviewStatus(id);if(JSON.stringify(next)!==JSON.stringify(r)){reviewResults[id]=next;changed=true;}
 }if(changed)await render();}catch(e){error(e);}finally{reviewRefreshBusy=false;}
},3000);
// One derived answer to "what should this person do next?". It reads only state that already
// exists -- the profile, health(), connections() and cloud progress -- and stores no second
// copy of setup progress. Exactly one action comes out, or null when nothing is pending.
//
// "Selected" is not "connected": a host sits in profile.hosts the moment its checkbox was
// ticked during setup, long before anything on the provider side answers.
const remoteId=id=>['chatgpt','gemini','perplexity'].includes(id);
// Antigravity's IDE and its terminal are two entry points of ONE provider -- see COMPANIONS
// in core.cjs. The registry marks the secondary with variantOf, and nothing in the product
// may draw it as an AI application of its own: the primary card answers for both, carries
// both sets of files, and is only "ready" when both are.
const hostEntry=id=>(state?.hosts||[]).find(h=>h.id===id)||null;
const isVariant=id=>!!hostEntry(id)?.variantOf;
const primaryId=id=>hostEntry(id)?.variantOf||id;
const providerHosts=()=>[...new Set((state?.profile?.hosts||[]).map(h=>primaryId(h.id)))];
const entryPoints=id=>[id,...((hostEntry(id)?.companions)||[]).filter(c=>(state?.profile?.hosts||[]).some(h=>h.id===c))];
// A provider card stands for every entry point it owns, so ticking it keeps all of them.
const expandSelection=ids=>[...new Set(ids.flatMap(id=>[id,...((hostEntry(id)?.companions)||[])]))];
function mergedConnections(list){
 return list.filter(c=>!isVariant(c.id)).map(c=>{
  const extra=entryPoints(c.id).slice(1).map(id=>list.find(x=>x.id===id)).filter(Boolean);
  if(!extra.length)return c;
  const all=[c,...extra];
  return {...c,files:all.flatMap(x=>x.files||[]),parts:all.map(x=>x.id),
   status:all.every(x=>x.status==='ready')?'ready':'attention'};
 });
}
function connectionUsable(id){
 if(remoteId(id))return remoteStatus?.progress?.[id]?.canTest===true;
 const c=connectionList.find(x=>x.id===id);
 return !!c&&c.status==='ready'&&c.access?.state!=='unavailable';
}
function setupState(){
 if(!state?.profile)return 'AI_NOT_SELECTED';
 if(state.vaultMissing||healthData?.vaultMissing)return 'VAULT_MISSING';
 if(state.profile.storage==='obsidian'&&obsidianNeedsClose)return 'OBSIDIAN_RESTART_REQUIRED';
 if(state.profile.storage==='obsidian'&&obsidianPresent===false)return 'OBSIDIAN_MISSING';
 const selected=state.profile.hosts||[];
 if(!selected.length)return 'AI_NOT_SELECTED';
 if(selected.some(h=>connectionUsable(h.id))){
  if((healthData?.verifiedCount||0)>0)return 'READY';
  return healthData?.skippedAt?'READY':'VERIFY_PENDING';
 }
 const broken=connectionList.some(c=>c.access?.state==='unavailable'&&!remoteId(c.id))
  ||selected.some(h=>['invalid','failed','expired'].includes(reviewResults[h.id]?.status));
 return broken?'CONNECTION_FAILED':'AI_SELECTED_NOT_CONNECTED';
}
// action: what the button does · view: where it lives · en/tr: its label.
function nextAction(){
 const map={
  OBSIDIAN_MISSING:{en:'Download Obsidian',tr:'Obsidian\u2019\u0131 indir',action:'download-obsidian',view:null},
  OBSIDIAN_RESTART_REQUIRED:{en:'Restart Obsidian',tr:'Obsidian\u2019\u0131 yeniden ba\u015flat',action:'obsidian',view:null},
  VAULT_MISSING:{en:'Choose notes folder',tr:'Not klas\u00f6r\u00fcn\u00fc se\u00e7',action:'relocate',view:null},
  AI_NOT_SELECTED:{en:'Set up your first connection',tr:'\u0130lk ba\u011flant\u0131n\u0131 kur',action:'add-hosts',view:'connections'},
  AI_SELECTED_NOT_CONNECTED:{en:'Finish the connection',tr:'Ba\u011flant\u0131y\u0131 tamamla',action:'open-next-connection',view:'connections'},
  CONNECTION_FAILED:{en:'Repair the connection',tr:'Ba\u011flant\u0131y\u0131 onar',action:'open-next-connection',view:'connections'},
  // Not 'goto-connections'. This banner is rendered on the connections screen itself, so a
  // button that only switches to that screen was pressed by users already standing on it and
  // answered with nothing at all. Access verification is a real operation with a real result;
  // the button now starts it, and the dialog it opens shows the outcome.
  VERIFY_PENDING:{en:'Verify access',tr:'Eri\u015fimi do\u011frula',action:'start-verification',view:'connections'}};
 const entry=map[setupState()];if(!entry)return null;
 if(entry.action!=='start-verification'&&entry.action!=='open-next-connection')return entry;
 const host=pendingHost(entry.action);
 // A control we cannot aim is a control we do not draw.
 return host?{...entry,host}:null;
}
// Which connection the pending action is about: verification needs one that can actually
// answer a challenge right now, repair the one that is not usable.
function pendingHost(action){
 const installed=providerHosts();
 if(action!=='start-verification')return installed.find(id=>!connectionUsable(id))||installed[0]||null;
 // A read-only profile cannot write the answer, so there is no test to offer.
 if(state?.profile?.access==='read')return null;
 // A cloud connection only shows the test once its tools are reachable.
 const testable=id=>remoteId(id)?remoteStatus?.progress?.[id]?.canTest===true:connectionUsable(id);
 return installed.find(id=>!remoteId(id)&&testable(id))||installed.find(testable)||null;
}
const statusLine=()=>({
 OBSIDIAN_MISSING:t('Obsidian is not installed on this computer yet.','Obsidian bu bilgisayarda hen\u00fcz kurulu de\u011fil.'),
 OBSIDIAN_RESTART_REQUIRED:t('Obsidian is running, so Claudian cannot register your notes folder yet.','Obsidian a\u00e7\u0131k oldu\u011fu i\u00e7in Claudian not klas\u00f6r\u00fcn\u00fc hen\u00fcz kaydedemiyor.'),
 VAULT_MISSING:t('Your notes folder is not where Claudian expects it.','Not klas\u00f6r\u00fcn Claudian\u2019\u0131n bekledi\u011fi yerde de\u011fil.'),
 AI_NOT_SELECTED:t('Claudian is ready, but no AI application is connected yet.','Claudian haz\u0131r, ancak hen\u00fcz hi\u00e7bir AI arac\u0131 ba\u011fl\u0131 de\u011fil.'),
 AI_SELECTED_NOT_CONNECTED:t('An AI application is selected but its connection is not finished.','Bir AI arac\u0131 se\u00e7ildi ama ba\u011flant\u0131s\u0131 tamamlanmad\u0131.'),
 CONNECTION_FAILED:t('A connection needs attention before it can be used.','Bir ba\u011flant\u0131 kullan\u0131labilmesi i\u00e7in kontrol istiyor.'),
 VERIFY_PENDING:t('Files are installed, but no AI has proven it can read them yet.','Dosyalar kurulu, ancak hi\u00e7bir AI hen\u00fcz okuyabildi\u011fini kan\u0131tlamad\u0131.')}[setupState()]||'');
// The one next step on the screen. It is emphasised, never animated -- see .next-step in
// styles.css. Anything else that wants attention uses a warning callout instead, so
// "press this" and "careful" never wear the same clothes.
const recommended=(a,extra='')=>`<button data-action="${a.action}" class="primary next-step" ${a.host?`data-host="${esc(a.host)}" `:''}${extra}>${t(a.en,a.tr)}</button>`;
const warnCallout=(title,body,action='')=>`<div class="callout-warn" role="status"><p class="callout-title"><span class="callout-mark" aria-hidden="true">\u25b2</span>${esc(title)}</p><p>${esc(body)}</p>${action}</div>`;

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
// One provider, more than one way in. Antigravity's IDE and terminal read the same rule file
// and the same memory; they were drawn as two AI applications, which invited the user to
// connect the same product twice. Here they are what they are: two ways to continue.
function entryPointRow(h){
 if(!(h.parts&&h.parts.length>1))return '';
 return `<div class="config-file entry-points"><span>${t('Ways to continue','Devam etme yolları')}</span>`
  +`<p>${t('This is one connection. Both entry points read the same notes and the same instruction file.','Bu tek bir bağlantıdır. İki giriş yolu da aynı notları ve aynı talimat dosyasını okur.')}</p>`
  +`<div class="toolbar">${btn('Continue in the app','Uygulamada devam et','entry-open',true,`data-host="${esc(h.id)}" data-mode="app"`)}`
  +`${btn('Continue in the terminal','Terminalde devam et','entry-open',false,`data-host="${esc(h.id)}" data-mode="terminal"`)}</div></div>`;
}
// What Claudian turned away, in its own words, from its own record. Distinguishing "the AI
// never called" from "the AI called and was refused" is the difference between a screen that
// waits and a screen that explains.
function refusal(h){
 const g=(remoteStatus?.grants||[]).filter(x=>x.host===h.id&&!x.revoked&&x.refused&&Object.keys(x.refused).length);
 if(!g.length)return '';
 const last=g.map(x=>Object.entries(x.refused)).flat().sort((a,b)=>Date.parse(b[1].at)-Date.parse(a[1].at))[0];
 if(!last||!/first_review/.test(last[0]))return '';
 return last[1].error||'';
}
function firstScanRow(h){
 const info=(healthData?.hosts||[]).find(x=>x.id===h.id);
 if(!info||info.state!=='verified')return '';
 const open=firstScan&&firstScan.host===h.id;
 let r=reviewResults[h.id];
 // A web provider can accept the instruction, use the connection and still never call
 // submit_first_review -- its own policy may block the callback. That is not "waiting"; it is
 // a review that did not come back, and it used to read as pending for twenty-four hours.
 // Derived from the application's own grant record, never from anything the provider wrote.
 if(r&&r.status==='waiting'&&r.issuedAt&&remoteId(h.id)){
  const since=Date.parse(r.issuedAt);
  const used=(remoteStatus?.grants||[]).some(g=>g.host===h.id&&!g.revoked&&g.lastSeen&&Date.parse(g.lastSeen)>since);
  if(used&&Date.now()-since>10*60*1000)r={...r,status:'no_report'};
 }
 const labels={completed:t('Review completed','Tarama tamamlandı'),needs_input:t('Your answer is needed','Yanıtın gerekiyor'),failed:t('Review failed','Tarama başarısız'),waiting:t('Waiting for the AI report','AI raporu bekleniyor'),no_report:t('The AI used the connection but returned no report','AI bağlantıyı kullandı ama rapor döndürmedi'),superseded:t('A Claudian update replaced the protocol; start the review again','Claudian güncellemesi protokolü değiştirdi; taramayı yeniden başlat'),expired:t('Review expired; start again','Tarama süresi doldu; yeniden başlat'),invalid:t('Report could not be verified','Rapor doğrulanamadı'),stale:t('Configuration changed; review again','Yapılandırma değişti; yeniden tara')};
 return `<div class="config-file verify-row" data-state="${r?.status==='completed'?'verified':'first-scan'}"><span>${t('First review','İlk tarama')}</span>`
  +`<span class="badge" role="status">${esc(labels[r?.status]||t('Not started','Başlatılmadı'))}${r?.receivedAt?' · '+esc(new Date(r.receivedAt).toLocaleString()):''}</span>`
  +(r?.status==='superseded'&&r.from?`<p class="review-reason">${t('The request was issued under protocol ','İstek protokol ')}${esc(r.from)}${t('; this device now runs ','ile açıldı; bu cihaz artık ')}${esc(r.to||'')}${t('. Nothing was lost — the review simply has to be run against the current protocol.','sürümünü kullanıyor. Hiçbir şey kaybolmadı; tarama güncel protokolle yeniden çalıştırılmalı.')}</p>`:'')
  +(refusal(h)?`<p class="review-reason">${t('Claudian refused this connection’s last attempt: ','Claudian bu bağlantının son denemesini geri çevirdi: ')}${esc(refusal(h))}</p>`:'')
  +`${r?.summary?`<details class="review-report"><summary>${t('Read the AI report','AI raporunu oku')}</summary><pre>${esc(r.summary)}</pre><p>${t('Report returned by the AI for this review.','Bu tarama için AI tarafından döndürülen rapor.')}</p></details>`:''}`
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
  ${open?`${h.id==='gemini-cli'?`<p class="health-warn">${t('If Google reports “This client is no longer supported”, retrying sign-in will not fix this client. Use Antigravity, or a separately configured API key / Vertex AI account. Google browser success alone does not verify this connection.','Google “This client is no longer supported” diyorsa aynı istemcide tekrar giriş denemek çözüm değildir. Antigravity kullan veya ayrıca yapılandırılmış API anahtarı / Vertex AI hesabıyla devam et. Tarayıcıdaki giriş başarısı bu bağlantıyı doğrulamaz.')}</p><div class="toolbar">${btn('Open Antigravity','Antigravity’yi aç','gemini-alternative',false)}${btn('Open CLI for another sign-in method','Farklı giriş yöntemi için CLI’ı aç','gemini-login',false)}</div>`:''}<p>${cliReady[h.id]?t('Run the test in your AI application. Approve its permission request if shown, then return here for the result.','Testi AI uygulamanda çalıştır. İzin sorarsa inceleyip onayla; sonuç burada beklenecek.'):t('Paste this into ','Şuraya yapıştır: ')+esc(h.label)+t('. Use a conversation with Claudian selected. Opening the application alone does not make its tools available.','. Claudian’ın seçili olduğu sohbeti kullan. Uygulamayı açmak tek başına araçları sohbete eklemez.')}</p><pre class="prompt">${esc(challenge.prompt)}</pre><div class="toolbar">${cliReady[h.id]?btn('Run in terminal','Terminalde çalıştır','run-challenge',state!=='verified',`data-host="${h.id}"`):''}${appActions(h,'copy-challenge',state==='verified')}${btn('Cancel','Vazgeç','challenge-close')}</div>${verifyStatus()}`
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
function header(){document.documentElement.lang=language;document.querySelector('header .caption').textContent='';const nav=document.querySelector('nav');if(nav){nav.hidden=extending;nav.innerHTML=`<button data-view="home">${t('Memory','Hafıza')}</button><button data-view="connections">${t('Connections','Bağlantılar')}</button><button data-view="companion">${t('Panel','Panel')}</button><button data-view="settings">${t('Settings','Ayarlar')}</button>`;nav.querySelectorAll('button').forEach(n=>n.classList.toggle('active',n.dataset.view===view));}}
// A card instead of a bare checkbox. Every line on it has a source in this repository:
// the connection kind comes from the host registry, "found on this computer" from the same
// detection the installer uses, the requirement sentence from web-providers.cjs. A line
// without a source is not rendered at all -- an empty badge would be a claim.
const connectionKind=id=>['chatgpt','gemini','perplexity'].includes(id)
 ?t('Connects through your account','Hesabın üzerinden bağlanır')
 :id==='claude-desktop'?t('Local extension','Yerel eklenti')
 :t('Local file in the application','Uygulamadaki yerel dosya');
function hostCard(h){
 const on=draft.hosts.includes(h.id), req=hostRequirement(h.id);
 return `<label class="host-card" data-selected="${on}"><span class="host-card-top"><input name="host" type="checkbox" value="${esc(h.id)}" ${on?'checked':''}><strong>${esc(h.label)}</strong>${providerBadge(h.id)}</span>`
  +`<span class="host-card-kind">${connectionKind(h.id)}</span>`
  +(h.configurationFound?`<span class="host-card-found">${t('Found on this computer','Bu bilgisayarda bulundu')}</span>`:'')
  +(req?`<span class="host-card-req">${req}</span>`:'')
  +`</label>`;
}
function renderSetup(){
 if(complete){content.innerHTML=`<h1>${t('Your notes folder is ready. One step left.','Not klasörün hazır. Bir adım kaldı.')}</h1><p>${t('Nothing is connected yet. Continue to Connections to install the provider plugin and authorize your AI account. Preparing local files does not connect ChatGPT, Claude or Spark.','Henüz hiçbir şey bağlı değil. Sağlayıcı eklentisini kurmak ve AI hesabına izin vermek için Bağlantılar’a devam et. Yerel dosyaların hazırlanması ChatGPT, Claude veya Spark hesabını bağlamaz.')}</p><p class="path">${esc(state.profile.vault)}</p>${notice?`<p role="status">${esc(notice)}</p>`:''}<div class="actions">${btn('Open in Obsidian','Obsidian’da aç','obsidian')}${btn('Open folder','Klasörü aç','vault')}${btn('Change folder','Klasörü değiştir','relocate')}<button data-action="enter-verify" class="primary next-step">${t('Set up AI connections','AI bağlantılarını kur')}</button>${btn('Skip for now','Şimdilik atla','skip-verify')}</div>`;return;}
 if(busy||events.length){const stages=[['prepare',t('Check installation','Kurulumu kontrol et')],['notes',t('Prepare notes','Notları hazırla')],['skills',t('Configure connections','Bağlantıları yapılandır')],['verify',t('Check saved files','Yazılan dosyaları kontrol et')]];const done=stages.filter(([id])=>events.some(e=>e.stage===id&&e.status==='done')).length;content.innerHTML=`<h1>${t('Setting up Claudian','Claudian kuruluyor')}</h1><progress max="4" value="${done}" aria-label="${t('Installation progress','Kurulum ilerlemesi')}"></progress>${stages.map(([id,title])=>`<div class="summary-row"><span>${title}</span><span>${events.some(e=>e.stage===id&&e.status==='done')?t('Done','Tamamlandı'):t('Waiting','Bekliyor')}</span></div>`).join('')}<p>${t('Detailed diagnostic messages are saved in the installation log.','Ayrıntılı tanılama mesajları kurulum günlüğüne kaydedilir.')}</p><div class="actions">${btn('Open log folder','Günlük klasörü','logs')}${busy?btn('Cancel','İptal et','cancel'):btn('Try again','Yeniden dene','retry')}</div>`;return;}
 if(plan){content.innerHTML=`<section class="grant"><h1>${t('Grant permission','İzin ver')}</h1><p class="lead">${t('Nothing has been written yet. Choose what these applications may do with your notes, then grant it. Any connection can be withdrawn later without deleting notes.','Henüz hiçbir şey yazılmadı. Bu uygulamaların notlarınla ne yapabileceğini seç ve izni ver. Her bağlantıyı sonradan, notlarını silmeden geri alabilirsin.')}</p><div class="grant-body"><section class="grant-col"><h2>${t('What you are granting','Neyi veriyorsun')}</h2><dl class="grant-facts"><dt>${t('Folder','Klasör')}</dt><dd class="path">${esc(draft.vault)}</dd><dt>${t('Applications','Uygulamalar')}</dt><dd>${draft.hosts.map(id=>esc(state.hosts.find(h=>h.id===id).label)).join(' · ')}</dd></dl><fieldset class="scope-choice"><label class="check"><input type="radio" name="grant-scope" value="read" ${draft.access==='read'?'checked':''}><span><strong>${t('Read notes','Notları oku')}</strong>${t('The AI can retrieve your notes. It cannot change or add anything.','AI notlarını getirebilir; hiçbir şeyi değiştiremez, ekleyemez.')}</span></label><label class="check"><input type="radio" name="grant-scope" value="write" ${draft.access!=='read'?'checked':''}><span><strong>${t('Read and write notes','Notları oku ve yaz')}</strong>${t('It can also create, update and archive notes in this folder. Without this, memory cannot maintain itself.','Bu klasörde not oluşturabilir, güncelleyebilir ve arşivleyebilir. Bu olmadan hafıza kendiliğinden bakım göremez.')}</span></label></fieldset></section><section class="grant-col"><h2>${t('What that means','Bu ne anlama geliyor')}</h2>${consentBlock(plan)}<details><summary>${t('Every file that will be written','Yazılacak her dosya')} (${plan.files.length})</summary><ul class="file-list">${plan.files.map(f=>`<li>${esc(f.path)}</li>`).join('')}</ul></details><p class="note">${t('This configures local files on this computer. It signs in to no account and uploads nothing.','Bu işlem bu bilgisayardaki yerel dosyaları yapılandırır. Hiçbir hesaba giriş yapmaz, hiçbir şey yüklemez.')}</p></section></div><label class="check grant-confirm"><input type="checkbox" id="grant-confirm" ${granted?'checked':''}><span>${t('Allow Claudian to configure the selected applications with the folder access shown above.','Claudian’ın seçili uygulamaları yukarıdaki klasör erişimiyle yapılandırmasına izin veriyorum.')}</span></label></section><div class="actions"><span class="sticky-reason">${granted?t('Ready to install.','Kuruluma hazır.'):t('Tick the permission box above to continue.','Devam etmek için yukarıdaki izin kutusunu işaretle.')}</span><span>${btn('Back','Geri','back')}${granted?`<button data-action="install" class="primary next-step">${t('Grant and connect','İzni ver ve bağla')}</button>`:btn('Grant and connect','İzni ver ve bağla','install',true,'disabled')}</span></div>`;return;}
 if(extending){content.innerHTML=`<h1>${t('Add connection','Bağlantı ekle')}</h1><p>${t('Choose an AI application for your current memory.','Mevcut hafızan için bir AI uygulaması seç.')}</p><p class="path">${esc(draft.vault)}</p><fieldset><legend>AI</legend>${state.hosts.filter(h=>!h.variantOf&&!state.profile.hosts.some(p=>p.id===h.id)).map(h=>`<label class="check"><input name="host" type="checkbox" value="${esc(h.id)}" ${draft.hosts.includes(h.id)?'checked':''}>${esc(h.label)}</label>`).join('')}</fieldset><div class="actions">${btn('Cancel','Vazgeç','exit-setup')}${btn('Continue','Devam et','preview',true)}</div>`;return;}
 const locked='';
 content.innerHTML=`<h1>${extending?t('Add a connection','Bağlantı ekle'):t('Set up your memory','Hafızanı hazırla')}</h1><p>${t('Choose where your notes live and which AI applications can use them.','Notlarının konumunu ve onları kullanacak AI uygulamalarını seç.')}</p><div class="grid"><div><label for="name">${t('Your name','Adın')}</label><input id="name" maxlength="100" value="${esc(draft.name)}" ${locked}></div><div><label for="storage">${t('Note application','Not uygulaması')}</label><select id="storage" ${locked}><option value="obsidian" ${draft.storage!=='markdown'?'selected':''}>Obsidian${obsidianPresent===false?t(' — not installed yet',' — henüz kurulu değil'):''}</option><option value="markdown" ${draft.storage==='markdown'?'selected':''}>${t('Plain Markdown files (advanced)','Düz Markdown dosyaları (gelişmiş)')}</option></select><p class="hint">${t('Obsidian is how Claudian is meant to be used. Plain Markdown works too, but you lose the linked note view.','Claudian’ın tasarlandığı kullanım Obsidian üzerinedir. Düz Markdown da çalışır, ancak bağlantılı not görünümünü kaybedersin.')}</p></div></div><label for="vault">${t('Where should we create your notes folder?','Not klasörünü nerede oluşturalım?')}</label><p class="hint">${t('We suggest a new folder in Documents. Change the path or browse to another location. It will be created when you approve setup.','Belgeler içinde yeni bir klasör öneriyoruz. Yolu değiştirebilir veya başka bir konum seçebilirsin. Klasör, kurulumu onayladığında oluşturulur.')}</p><div class="row folder-choice"><input id="vault" value="${esc(draft.vault)}" ${locked}>${btn('Browse','Gözat','folder',false,locked)}</div><label for="mode">${t('Start fresh or use your notes','Yeni başla veya notlarını kullan')}</label><select id="mode" ${locked}><option value="new" ${draft.mode==='new'?'selected':''}>${t('New / empty folder','Yeni / boş klasör')}</option><option value="existing" ${draft.mode==='existing'?'selected':''}>${t('Use existing notes','Mevcut notları kullan')}</option></select><label for="access">${t('Access','Erişim')}</label><select id="access" ${locked}><option value="write" ${draft.access!=='read'?'selected':''}>${t('Read and write notes','Notları oku ve yaz')}</option><option value="read" ${draft.access==='read'?'selected':''}>${t('Read notes only','Yalnızca notları oku')}</option></select><p class="hint">${t('Read and write allows automatic note maintenance. Read only does not allow this connection to save notes.','Oku ve yaz, otomatik not bakımına izin verir. Yalnızca okuma seçildiğinde bu bağlantı not kaydedemez.')}</p><fieldset class="host-cards"><legend>${t('AI applications','AI uygulamaları')}</legend><div class="host-grid">${state.hosts.filter(h=>!h.variantOf).filter(h=>!extending||!state.profile.hosts.some(p=>p.id===h.id)).map(hostCard).join('')}</div></fieldset><p>${t('The selected language applies to new protocol files. Existing notes will not be translated or replaced.','Seçilen dil yeni protokol dosyalarına uygulanır. Mevcut notlar çevrilmez veya değiştirilmez.')}</p>${draft.storage!=='markdown'&&obsidianPresent===false?warnCallout(t('Obsidian is not installed','Obsidian kurulu değil'),t('Claudian will still create your notes folder. Install Obsidian to open it as a linked vault, or choose plain Markdown above.','Claudian not klasörünü yine de oluşturur. Bağlantılı vault olarak açmak için Obsidian’ı kur veya yukarıdan düz Markdown’ı seç.'),btn('Download Obsidian','Obsidian’ı indir','download-obsidian')):''}<div class="actions">${extending?btn('Cancel','Vazgeç','exit-setup'):'<span></span>'}${btn('Continue','Devam et','preview',true)}</div>`;
}
async function renderPanel(){const p=state.profile;
 if(!p)throw new Error('Memory is not configured.');
 if(view==='companion'){renderPanelView();return;}
 if(view==='settings'){content.innerHTML=`<h1>${t('Settings','Ayarlar')}</h1><p>${t('The application and newly installed memory files use the setup language. Updates and protocol maintenance are collected here.','Uygulama ve yeni kurulan hafıza dosyaları kurulum dilini kullanır. Güncelleme ve protokol bakımı burada toplanır.')}</p>`;return;}
 const hosts=mergedConnections(await api.connections());connectionList=hosts;healthData=await api.health();if(api.reviewStatus)for(const h of hosts)reviewResults[h.id]=await api.reviewStatus(h.id).catch(e=>({status:'invalid',message:e.message}));if(view==='connections')remoteStatus=await api.connectorStatus();
 if(obsidianPresent===null)obsidianPresent=await api.obsidianInstalled().catch(()=>null);
 // Only the renderer learns this, and the derived state needs it: without it Claudian could
 // never report a missing note application or one that has to be restarted, because those two
 // states existed in state.cjs with nothing to set them.
 api.reportObsidian({present:obsidianPresent,needsClose:obsidianNeedsClose}).catch(()=>{});
 if(updateInfo===null)updateInfo=await api.updates().catch(()=>({available:false}));
 // The proof round trip should not be a copy-paste chore when we can open the CLI ourselves.
 try{const preview=await api.scanPreview(language);cliReady=Object.fromEntries(preview.hosts.map(h=>[h.id,h.available]));}catch{cliReady={};}
 probeIssue='';if(!healthData||!healthData.vaultMissing){try{await api.checkFiles();}catch(err){probeIssue=err?.message||String(err);}}
 // The server check spawns the exact command each host is configured to run, so it is done
 // once per render of this view rather than on every keystroke elsewhere.
 if(view==='connections'){try{selfCheck=await api.selfCheck();}catch(err){selfCheck={checkedAt:null,connections:[],error:err?.message||String(err)};}}
 if(autoChallenge){autoChallenge=false;}
 const pending=nextAction();
 const banner=pending&&view!=='connections'&&pending.view==='connections'
  ?`<div class="setup-banner" role="status"><div><strong>${t('Setup incomplete','Kurulum tamamlanmadı')}</strong><p>${esc(statusLine())}</p></div>${recommended(pending)}</div>`:'';
 content.innerHTML=`${banner}<h1>${view==='home'?t('Your memory','Hafızan'):t('AI connections','AI bağlantıları')}</h1>${notice?`<p role="status">${esc(notice)}</p>`:''}`;
 if(view==='home'){const notes=await api.activity();content.insertAdjacentHTML('beforeend',`<section class="vault-section"><h2>${t('Notes folder','Not klasörü')}</h2><p class="path">${esc(p.vault)}</p><div class="toolbar">${btn('Open in Obsidian','Obsidian’da aç','obsidian',true)}${btn('Open folder','Klasörü aç','vault')}</div>${obsidianNeedsClose?warnCallout(t('Obsidian restart required','Obsidian yeniden başlatılmalı'),t('Obsidian is open, so Claudian cannot add this folder to its vault list. Close Obsidian completely, then press the button below. Nothing was changed.','Obsidian açık olduğu için Claudian bu klasörü vault listesine ekleyemiyor. Obsidian’ı tamamen kapat, sonra aşağıdaki düğmeye bas. Hiçbir şey değiştirilmedi.'),recommended(nextAction()||{en:'Restart Obsidian',tr:'Obsidian’ı yeniden başlat',action:'obsidian'})):obsidianPresent===false?warnCallout(t('Obsidian is not installed','Obsidian kurulu değil'),t('Your notes are safe as Markdown files. Install Obsidian to open them as a linked vault.','Notların Markdown dosyası olarak duruyor. Bağlantılı vault olarak açmak için Obsidian’ı kur.'),recommended({en:'Download Obsidian',tr:'Obsidian’ı indir',action:'download-obsidian'})):''}${updateInfo?.available?`<div class="health-row health-warn"><div><span>${t('Update','Güncelleme')}</span><p>${t('Version ','Sürüm ')}${esc(updateInfo.latest)}${t(' is available.',' hazır.')}</p></div>${btn('Update now','Şimdi güncelle','download-update',true)}<span id="update-status" role="status"></span></div>`:''}${healthRow()}<details><summary>${t('Recent notes','Son notlar')}</summary>${notes.length?notes.map(n=>`<div class="note-row"><span>${esc(n.name)}</span><time>${new Date(n.modified).toLocaleDateString(language)}</time></div>`).join(''):`<p>${t('No notes yet.','Henüz not yok.')}</p>`}</details></section>`);}
 if(view==='connections')content.insertAdjacentHTML('beforeend',`${pending&&pending.view==='connections'?`<div class="setup-banner setup-banner-lead" role="status"><div><strong>${t('Setup incomplete','Kurulum tamamlanmadı')}</strong><p>${esc(statusLine())}</p></div>${recommended(pending)}</div>`:''}<p>${t('Choose an AI to connect it, run a test or read its first review.','Bağlamak, test etmek veya ilk tarama sonucunu görmek için bir AI seç.')}</p><div class="toolbar">${state.hosts.some(h=>!h.variantOf&&!p.hosts.some(x=>x.id===h.id))?btn('Add connection','Bağlantı ekle','add-hosts'):''}</div><p class="restart-hint">${t('After installing or updating Claudian, restart the AI applications you use: ','Claudian kurulumu veya güncellemesinden sonra kullandığın AI uygulamalarını yeniden başlat: ')}${hosts.filter(h=>!remoteHost(h)).map(h=>esc(h.label)).join(', ')}.</p><section class="connection-grid" aria-label="${t('AI connection status','AI bağlantı durumu')}">${hosts.map(connectionTile).join('')}</section>${connectionDialog(hosts)}`);
}

function connectionDetail(h){if(h.id==='gemini-cli')return `<div class="connection"><h2>Gemini CLI · ${t('Legacy connection','Eski bağlantı')}</h2><p>${t('This is a terminal connection, not Gemini web. Earlier file tests may have been completed by another application; they do not verify Gemini web. Existing files are preserved. Add Gemini from the connection list for the web setup.','Bu bir terminal bağlantısıdır; Gemini web değildir. Önceki dosya testleri başka uygulamadan tamamlanmış olabilir; Gemini web erişimini doğrulamaz. Mevcut dosyalar korunur. Web kurulumu için bağlantı listesinden Gemini ekle.')}</p>${btn('Add web connection','Web bağlantısı ekle','add-hosts',true)}${btn('Gemini manual sharing — no connection','Gemini’de manuel paylaşım — bağlantısız','gemini-web-guide')}</div>`;return remoteHost(h)?remoteHostCard(h):`<div class="connection"><div class="row"><div><strong>${esc(h.label)}</strong><span class="badge">${h.status==='ready'?t('Files installed','Dosyalar kurulu'):t('Needs attention','Kontrol gerekli')}</span></div></div>${connectionSteps(h)}${selfCheckRow(h)}${accessRow(h)}${entryPointRow(h)}${verifyRow(h)}${firstScanRow(h)}${memoryRow(h)}<details class="usage-details"><summary>${t('How to use this connection','Bu bağlantı nasıl kullanılır?')}</summary>${usageRow(h)}</details><details><summary>${t('Configuration and repair','Yapılandırma ve onarım')}</summary>${btn('Remove connection','Bağlantıyı kaldır','remove',false,`data-host="${h.id}"`)}${capabilityRow(h)}<p>${t('Skill: claudian-memory. Automatic startup uses the host’s rules. Manual: ','Skill: claudian-memory. Otomatik başlangıç uygulamanın kurallarını kullanır. Elle: ')}${manualCommand(h)}</p>${h.files.map(f=>`<div class="config-file"><span>${t(f.kind==='skill'?'Memory skill':'Startup instructions',f.kind==='skill'?'Hafıza skill’i':'Başlangıç talimatı')}</span><p class="path">${esc(f.path)}</p>${btn('Show file','Dosyayı göster','configuration',false,`data-host="${h.id}" data-kind="${f.kind}"`)}${btn('Repair','Onar','repair',false,`data-host="${h.id}"`)}<span class="badge">${t({ready:'Installed',missing:'Missing',changed:'Modified',unreadable:'Unreadable'}[f.status],{ready:'Kurulu',missing:'Eksik',changed:'Değiştirilmiş',unreadable:'Okunamıyor'}[f.status])}</span></div>`).join('')}</details>${removing===h.id?`<div class="remove-confirm"><p>${t('Remove this connection? Your notes stay. Files still used by other connections are kept. Restart this AI application afterward.','Bu bağlantı kaldırılsın mı? Notların ve diğer bağlantıların kullandığı dosyalar korunur. Ardından bu AI uygulamasını yeniden başlat.')}</p>${btn('Keep connection','Bağlantıyı koru','dismiss-remove')}${btn('Remove connection','Bağlantıyı kaldır','confirm-remove',false,`data-host="${h.id}"`)}</div>`:''}</div>`;}
// Badges state what this repository can prove and nothing else.
//   Spark      -- early access product; the integration is real but the product is beta.
//   Perplexity -- never exercised by a real account here, so it claims nothing.
// No plan tier is shown for any provider: no plan requirement is recorded anywhere in this
// codebase, and inventing one would be a claim the product cannot stand behind.
function providerBadge(id){
 if(id==='gemini')return `<span class="provider-badge" title="${t('Spark is an early-access Google product reached from the Gemini web app. Ordinary Gemini chat cannot use this connection.','Spark, Gemini web uygulamasından ulaşılan erken erişim Google ürünüdür. Normal Gemini sohbeti bu bağlantıyı kullanamaz.')}">Beta</span>`;
 if(id==='perplexity')return `<span class="provider-badge provider-badge-untested" title="${t('This integration has not been exercised with a real account. It may work; it is not proven.','Bu entegrasyon gerçek bir hesapla çalıştırılmadı. Çalışabilir; kanıtlanmış değil.')}">${t('Untested','Denenmedi')}</span>`;
 return '';
}
function connectionTile(h){
 const info=healthData?.hosts?.find(x=>x.id===h.id), review=reviewResults[h.id];
 const cloudReady=remoteStatus?.progress?.[h.id]?.canTest===true;
 const broken=(['chatgpt','gemini','perplexity'].includes(h.id)?!cloudReady:h.status!=='ready')||['invalid','failed','expired','stale','superseded'].includes(review?.status);
 const verified=info?.state==='verified', done=verified&&review?.status==='completed'&&!broken;
 const tone=h.id==='gemini-cli'?'pending':broken?'issue':done?'complete':verified?'verified':'pending';
 const label=['chatgpt','gemini','perplexity'].includes(h.id)&&!cloudReady&&setupStep(h.id)==='unavailable'?t('Unavailable in this account','Bu hesapta kullanılamıyor'):h.id==='gemini-cli'?t('Legacy CLI · not Gemini web','Eski CLI · Gemini web değil'):broken?(['chatgpt','gemini','perplexity'].includes(h.id)?t('Setup incomplete','Kurulum tamamlanmadı'):t('Needs attention','Kontrol gerekli')):done?t('Completed','Tamamlandı'):verified?t('Review pending','İlk tarama bekliyor'):t('AI test pending','AI testi bekliyor');
 // Ticking a checkbox during setup put this host in the profile. That is "selected".
 // "Connected" is a separate fact with separate evidence, and "verified" a third.
 const connected=connectionUsable(h.id);
 const link=connected?t('Connected','Bağlı'):t('Not connected','Bağlı değil');
 return `<button class="connection-tile" data-action="connection-open" data-host="${esc(h.id)}" data-state="${tone}" aria-haspopup="dialog"><span class="tile-heading"><strong>${esc(h.label)}</strong>${providerBadge(h.id)}<span class="tile-mark">${done?checkIcon:broken?'!':'↗'}</span></span><span class="tile-selection" data-linked="${connected}">${t('Selected','Seçili')} · ${link}</span><span class="tile-status">${label}</span><span class="tile-evidence">${verified?t('Read/write verified','Okuma/yazma doğrulandı'):t('Access not yet verified','Erişim henüz doğrulanmadı')}</span></button>`;
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
async function renderContent(){header();if(reviewing){renderReview();return;}
 // The panel reads the application's own derivation, not the renderer's live guesses, so it
 // is the same answer the tray shows and the same answer that was true while the window was
 // closed. Loaded on entry rather than on every render of every other screen.
 // Re-read on every entry, not only the first. The panel's whole claim is that a solved
 // problem is not there any more; keeping the first answer until a timer fired meant coming
 // back from fixing something and still being told about it.
 if(view==='companion'){try{panelState=await api.state();}catch(e){error(e);}}const result=await (setup||extending?renderSetup():renderPanel());if(state.profile&&view==='settings'&&!extending&&!setup){content.insertAdjacentHTML('beforeend',`<section class="updates"><p>Claudian ${esc(state.appVersion)} · Protocol ${esc(state.profile.protocolVersion)}</p>${state.protocolConflicts?.length?`<div class="health-row health-warn"><div><span>${t('Protocol','Protokol')}</span><p>${t('Your memory protocol is older than this version and was left untouched because it differs from what Claudian installed.','Hafıza protokolün bu sürümden eski ve Claudian kurulumundan farklı olduğu için değiştirilmedi.')}</p><p class="path">${state.protocolConflicts.map(f=>esc(f.split(/[\\/]/).pop())).join(' · ')}</p></div>${btn('Install the current protocol','Güncel protokolü kur','adopt-protocol',true)}</div>`:''}${state.connectionConflicts?.length?`<div class="health-row health-warn"><div><span>${t('Connection files','Bağlantı dosyaları')}</span><p>${t('These files carry changes Claudian did not write, so they were left alone. Repair the connection to reinstall them.','Bu dosyalarda Claudian’ın yazmadığı değişiklikler var, bu yüzden dokunulmadı. Yeniden kurmak için bağlantıyı onar.')}</p><p class="path">${state.connectionConflicts.map(f=>esc(f.split(/[\/]/).pop())).join(' · ')}</p></div>${btn('Go to connections','Bağlantılara git','goto-connections')}</div>`:''}${btn('Check for updates','Güncellemeleri kontrol et','updates')}<span id="update-status" role="status"></span></section>`);}return result;}
// companion-bridge.cjs throws one of three exact codes. Collapsing them into a single
// sentence made an offline Core look like a wrong access code, so the reader concluded
// their data was gone. Each case is named, and the unreachable case says the code was
// never checked and nothing was changed.
// Kept deliberately while `companion-bridge.cjs` is kept: nothing calls this today, because
// the Panel derives its own state and asks for no access code. If a remote Core is ever
// wanted again, these three sentences are the lesson, and deleting them would lose it.
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
 if(a==='cloud-step'){saveSetupStep(el.dataset.host,el.dataset.step);await render();return;}
 if(a==='cloud-name'){await api.copy('Claudian — Bu cihaz');el.textContent=t('Name copied','Ad kopyalandı');return;}
 if(a==='cloud-open'){await api.openAiApp(el.dataset.host);return;}
 if(a==='cloud-begin'){await api.connectorProvider(el.dataset.host);saveSetupStep(el.dataset.host,'opened');remoteStatus=await api.connectorStatus();await render();return;}
 if(a==='connection-open'){selectedConnection=el.dataset.host;await render();return;}
 if(a==='connection-close'){const id=selectedConnection;selectedConnection=null;document.querySelector('#connection-dialog')?.close();await render();document.querySelector(`[data-action=connection-open][data-host="${id}"]`)?.focus();return;}
 if(a==='review-apply'){selectedHosts=expandSelection([...document.querySelectorAll('[name=review-host]:checked')].map(x=>x.value));busy=true;await render();try{const installed=(state.profile?.hosts||[]).map(h=>h.id);
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
 if(a==='connector-provider'){await api.connectorProvider(el.dataset.host);remoteStatus=await api.connectorStatus();notice=['gemini','perplexity'].includes(el.dataset.host)?t('Address copied and connection settings opened. Paste the address into the custom app form and confirm OAuth access.','Adres kopyalandı ve bağlantı ayarları açıldı. Özel uygulama formuna adresi yapıştır ve OAuth erişimini onayla.'):el.dataset.host==='claude-desktop'?t('Claude opens with the name and address filled in. Review and confirm there.','Claude, adı ve adresi doldurulmuş olarak açılır. Orada kontrol edip onayla.'):t('Device address copied. Choose Create app and paste it into MCP server URL; authentication is OAuth.','Cihaz adresi kopyalandı. Create app / Uygulama oluştur seçeneğinde MCP sunucu URL alanına yapıştır; kimlik doğrulama OAuth.');await render();return;}
 if(a==='gemini-web-guide'){await api.geminiGuide();notice=t('Manual-sharing guide copied and ordinary Gemini chat opened. This is not Spark and it does not connect or verify anything.','Manuel paylaşım yönergesi kopyalandı ve normal Gemini sohbeti açıldı. Bu Spark değildir; hiçbir şeyi bağlamaz veya doğrulamaz.');await render();return;}
 if(a==='connector-help'){await api.connectorSetupHelp(el.dataset.host);remoteStatus=await api.connectorStatus();notice=t('Setup instruction copied. Paste and send it in the AI chat that opened. Browser control depends on the tools available in that chat.','Kurulum yönergesi kopyalandı. Açılan AI sohbetine yapıştırıp gönder. Tarayıcıyı kullanabilmesi o sohbetin araçlarına bağlıdır.');await render();return;}
 if(a==='connector-export'){const result=await api.connectorExport(el.dataset.host);if(result){notice=t('Plugin package prepared. Installation in the provider is still required.','Eklenti paketi hazırlandı. Sağlayıcıda kurulması gerekiyor.');await render();}return;}


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
 if(a==='enter'||a==='enter-verify'||a==='skip-verify'||a==='exit-setup'){
  // The window reloads, so the destination has to travel through the main process. Setting
  // view here used to be thrown away by the reload and the person landed on Memory.
  const target=a==='enter-verify'?'connections':'';
  if(a==='enter-verify'){view='connections';autoChallenge=true;}
  if(extending){extending=false;complete=false;events=[];plan=null;await render();}else await api.enter(target);}
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
 if(a==='obsidian'){const result=await api.obsidian();
  // Only the application's own answer sets these. Claudian never guesses that a restart is needed.
  obsidianNeedsClose=!!result?.needsClose;
  api.reportObsidian({present:obsidianPresent,needsClose:obsidianNeedsClose}).catch(()=>{});
  if(result?.notInstalled){obsidianPresent=false;notice='';await render();}
  if(result?.needsClose){notice='';await render();}
  if(result&&!result.notInstalled&&!result.needsClose)obsidianNeedsClose=false;}
 if(a==='repair'){const r=await api.repair(el.dataset.host);state=await api.snapshot();notice=r.conflicts.length?t('Some files could not be repaired; review configuration.','Bazı dosyalar onarılamadı; yapılandırmayı incele.'):t('Connection repaired. Previous files were backed up. Restart your AI application.','Bağlantı onarıldı. Önceki dosyalar yedeklendi. AI uygulamanı yeniden aç.');await render();}
 if(a==='updates'){const r=await api.updates();document.querySelector('#update-status').textContent=r.available?t(' New version: ',' Yeni sürüm: ')+r.latest:t(' You are up to date.',' Güncelsin.');if(r.available)document.querySelector('#update-status').insertAdjacentHTML('beforeend',btn('Update now','Şimdi güncelle','download-update',true));}
 if(a==='goto-connections'){view='connections';await render();return;}
 if(a==='panel-refresh'){panelState=await api.state();await render();return;}
 // The two banner actions that used to be 'goto-connections'. Pressed from the connections
 // screen -- where the banner lives -- that did nothing at all: same view, same render, same
 // screen. Each now opens the connection it is about, and 'Verify access' additionally issues
 // the real challenge, so the press produces state a user can see and Claudian can check.
 if(a==='open-next-connection'||a==='start-verification'){
  const host=el.dataset.host;if(!host)return;
  view='connections';selectedConnection=host;
  if(a==='start-verification'){
   if(challenge)await api.cancelVerify(challenge.host);
   verifyRequest++;verifyNotice='';verifyState='ready';
   // A failure here is the answer, not a silent no-op: say it on the screen that was pressed.
   try{challenge={host,prompt:(await api.challenge(host)).prompt};}
   catch(e){challenge=null;verifyState='';notice=e.message;}
  }
  await render();return;
 }
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
 if(a==='gemini-alternative'){await api.openAiApp('antigravity');return;}
 // Two entry points, one provider. Neither pretends to launch something it cannot: the app
 // action opens the application, the terminal action prepares the instruction and says where
 // it goes, because Claudian has no launcher for that terminal and will not invent one.
 if(a==='entry-open'){
  const host=el.dataset.host,instruction=manualStart(host);
  await api.copy(instruction);
  if(el.dataset.mode==='app'){
   try{await api.openAiApp(host);notice=t('Instruction copied and the application opened. Paste it into a new conversation.','Yönerge kopyalandı ve uygulama açıldı. Yeni bir sohbete yapıştır.');}
   catch(e){notice=e.message;}
  } else notice=t('Instruction copied. Paste it into the Antigravity terminal session.','Yönerge kopyalandı. Antigravity terminal oturumuna yapıştır.');
  await render();return;
 }
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
(async()=>{language=(await api.preferences()).language;state=await api.snapshot();if(state.entryView)view=state.entryView;reviewing=!!state.setupReview;selectedHosts=(state.profile?.hosts||[]).map(h=>h.id);if(state.migrationError)error(new Error(state.migrationError));if(setup){draft=(await api.discover()).suggested;draft.language=language;}await render();})().catch(error);



// The panel knows the user's situation by itself.
//
// It used to be a window onto a web Core reached with an access code, over a tunnel, from a
// Next server started by hand with `run.bat`. So the answer to "is my Spark verification
// still pending?" depended on a batch file being open on this desktop — and when it was not,
// the panel asked for a code that could not work and said nothing about why.
//
// Everything below is derived by the application from its own files (see state.cjs). No AI
// has to have been opened, nothing waits for a model to write Markdown, and a fact that
// cannot be derived is absent rather than invented.
function panelAction(a){
 // Every line has to be actionable or it is just a status board.
 if(a.kind==='setup_incomplete')return btn('Continue setup','Kuruluma devam et','goto-connections',true);
 if(a.kind==='connector_offline')return btn('Connection settings','Bağlantı ayarları','goto-connections');
 // A reminder lives in the user's own notes, so the only honest action is to open them.
 if(a.kind==='reminder_due'||a.kind==='reminder_overdue')return btn('Open notes','Notları aç','obsidian');
 if(a.host)return btn('Open','Aç','open-next-connection',a.kind.startsWith('verification')||a.kind==='connection_broken',`data-host="${esc(a.host)}"`);
 return '';
}
// The panel says what is unfinished, not which constant the code used.
function setupReason(code){
 return {
  VAULT_MISSING:t('Your notes folder is not where Claudian expects it','Not klasörün Claudian’ın beklediği yerde değil'),
  OBSIDIAN_MISSING:t('Obsidian is not installed on this computer','Obsidian bu bilgisayarda kurulu değil'),
  OBSIDIAN_RESTART_REQUIRED:t('Obsidian is running, so the notes folder cannot be registered yet','Obsidian açık olduğu için not klasörü henüz kaydedilemiyor'),
  AI_NOT_SELECTED:t('No AI application is connected yet','Henüz hiçbir AI uygulaması bağlı değil'),
  AI_SELECTED_NOT_CONNECTED:t('An AI is selected but its connection is not finished','Bir AI seçildi ama bağlantısı tamamlanmadı'),
  CONNECTION_FAILED:t('A connection needs attention before it can be used','Bir bağlantı kullanılabilmesi için kontrol istiyor'),
  VERIFY_PENDING:t('Files are installed, but no AI has proven it can read them','Dosyalar kurulu, ancak hiçbir AI okuyabildiğini kanıtlamadı'),
 }[code]||t('Setup is not finished','Kurulum tamamlanmadı');
}
function panelLabel(a){
 const label={
  setup_incomplete:setupReason(a.detail),
  connector_offline:t('This device is not reachable by your AI accounts','Bu cihaza AI hesaplarından ulaşılamıyor'),
  verification_pending:t('Access has never been verified','Erişim hiç doğrulanmadı'),
  verification_stale:t('Verification is older than the current setup','Doğrulama güncel kurulumdan eski'),
  authorization_waiting:t('An authorization is waiting for your approval','Bir izin isteği onayını bekliyor'),
  first_review_rejected:t('A report was refused','Bir rapor geri çevrildi'),
  first_review_failed:t('The first review failed','İlk tarama başarısız oldu'),
  first_review_expired:t('The first review expired','İlk taramanın süresi doldu'),
  first_review_stale:t('The first review belongs to an older setup','İlk tarama eski bir kuruluma ait'),
  first_review_superseded:t('A Claudian update replaced the protocol after this review started','Tarama başladıktan sonra bir Claudian güncellemesi protokolü değiştirdi'),
  first_review_needs_input:t('The review is waiting for your answer','Tarama yanıtını bekliyor'),
  connection_broken:t('This connection is broken','Bu bağlantı bozuk'),
  verification_unfinished:t('A verification was started and never finished','Bir doğrulama başlatıldı ama tamamlanmadı'),
  reminder_due:t('Due today','Bugün'),
  reminder_overdue:t('Past due','Tarihi geçti'),
 }[a.kind];
 return label||String(a.kind||'');
}
function panelLine(a){
 const label=panelLabel(a);
 const reminder=a.kind==='reminder_due'||a.kind==='reminder_overdue';
 const heading=reminder?esc(a.label||''):`${a.label?esc(a.label)+' · ':''}${esc(label)}`;
 const detail=reminder?esc(label)+(a.detail?' · '+esc(String(a.detail)):''):(a.detail&&a.kind!=='setup_incomplete'?esc(String(a.detail)):'');
 return `<div class="panel-item" data-kind="${esc(a.kind)}"><div><strong>${heading}</strong>${detail?`<p>${detail}</p>`:''}</div>${panelAction(a)}</div>`;
}
// The history is read by the same person as the rest of the panel, so it says what happened
// rather than which identifier the code used.
function eventLine(e){
 if(e.kind==='setup_changed')return t('Setup: ','Kurulum: ')+setupReason(e.to);
 if(e.kind==='connection_restored')return t('This device is reachable again','Bu cihaza yeniden ulaşılabiliyor');
 const what=panelLabel({kind:e.attention,label:e.label,detail:e.detail});
 const who=e.label&&!String(e.attention||'').startsWith('reminder')?esc(e.label)+' · ':'';
 return (e.kind==='attention_cleared'?t('Resolved — ','Çözüldü — '):t('Needs you — ','Bekliyor — '))+who+what;
}
function renderPanelView(){
 const s=panelState;
 if(!s)return content.innerHTML=`<h1>${t('Panel','Panel')}</h1><p>${t('Reading this device’s state…','Bu cihazın durumu okunuyor…')}</p>`;
 const when=s.updatedAt?new Date(s.updatedAt).toLocaleTimeString(language==='tr'?'tr-TR':'en-GB'):'—';
 const attention=s.attention||[];
 content.innerHTML=`<h1>${t('Panel','Panel')}</h1>`
  +`<p class="hint">${t('Derived by Claudian from this computer. No AI has to be open for this to be current.','Claudian bunu bu bilgisayardan türetir. Güncel olması için bir AI’ın açık olması gerekmez.')} · ${t('Updated ','Güncellendi ')}${esc(when)}</p>`
  +`<section class="panel-section"><h2>${t('Needs you','Seni bekleyen')}${attention.length?` (${attention.length})`:''}</h2>`
  +(attention.length?attention.map(panelLine).join('')
    :`<p class="panel-clear">${s.verificationSkipped
        ? t('Nothing needs you. You skipped the access check, so no connection has proven itself inside an AI — run it from Connections whenever you want to.','Seni bekleyen bir şey yok. Erişim kontrolünü atladın, yani hiçbir bağlantı kendini AI içinde kanıtlamadı — istediğin zaman Bağlantılar’dan çalıştırabilirsin.')
        : t('Nothing needs you right now.','Şu an seni bekleyen bir şey yok.')}</p>`)
  +`</section>`
  +`<section class="panel-section"><h2>${t('Connections','Bağlantılar')}</h2>`
  +(s.connections||[]).map(c=>`<div class="panel-item"><div><strong>${esc(c.label)}</strong><p>${c.connected?t('Connected','Bağlı'):t('Not connected','Bağlı değil')} · ${c.verified?t('read/write verified','okuma/yazma doğrulandı'):t('access not verified','erişim doğrulanmadı')} · ${t('first review: ','ilk tarama: ')}${esc(c.review)}</p></div>${btn('Open','Aç','open-next-connection',false,`data-host="${esc(c.id)}"`)}</div>`).join('')
  +`</section>`
  +((s.openLoops||[]).length?`<section class="panel-section"><h2>${t('Open loops','Açık döngüler')}</h2><p class="hint">${t('Unchecked items in your own panel note. Archived sections are not read.','Kendi panel notundaki işaretsiz maddeler. Arşivlenmiş bölümler okunmaz.')}</p><ul class="panel-list">${s.openLoops.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`:'')
  +((s.reminders||[]).length?`<section class="panel-section"><h2>${t('Reminders','Hatırlatıcılar')}</h2><p class="hint">${t('Dated items from your own reminders note. Only today and past due are listed above as needing you.','Kendi hatırlatıcı notundaki tarihli maddeler. Yukarıda seni bekleyen olarak yalnız bugün ve geçmiş tarihliler görünür.')}</p><ul class="panel-list">${s.reminders.map(x=>`<li data-due="${esc(x.due||'none')}">${esc(x.text)}${x.date?` <time>${esc(x.date)}</time>`:''}</li>`).join('')}</ul></section>`:'')
  +((s.recent||[]).length?`<details class="panel-section"><summary>${t('What changed recently','Son değişenler')}</summary><ul class="panel-list">${s.recent.slice(0,10).map(e=>`<li><time>${esc(new Date(e.at).toLocaleString(language==='tr'?'tr-TR':'en-GB'))}</time> ${esc(eventLine(e))}</li>`).join('')}</ul></details>`:'');
}
api.onVerify(async event=>{if(!challenge||event.host!==challenge.host||event.requestId!==verifyRequest)return;const message=event.message||verifyNotice;if(verifyState===event.state&&verifyNotice===message)return;verifyState=event.state;verifyNotice=message;await render();});
// The panel re-derives while it is open. Nothing is polled from a remote service.
setInterval(async()=>{if(view!=='companion'||busy)return;try{panelState=await api.state();renderPanelView();}catch(e){error(e);}},60000);

// The line a user pastes to open a Claudian conversation on a skill-file host. Same text for
// every entry point of the same provider -- the entry point changes where it is pasted, not
// what is asked for.
function manualStart(id){
 const c=connectionList.find(x=>x.id===id);
 const name=c&&(c.files||[]).some(f=>f.path.includes('claudian-memory-bridge'))?'claudian-memory-bridge':'claudian-memory';
 return t(name+' skill: read the memory protocol and my entry map before answering.',
          name+' skill: cevaplamadan önce hafıza protokolünü ve giriş haritamı oku.');
}
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
// Three different facts about one provider, and they are not interchangeable. Selected is a
// tick on this screen. Connected means Claudian installed its files last time. Verified means
// an AI actually read and wrote through them, and it goes stale when the protocol or the
// folder changes. A card that collapses them into one green mark tells the user a connection
// is working when nothing has ever proven it.
function reviewHostCard(h){
 const p=state.profile, prior=(p?.hosts||[]).find(x=>x.id===h.id);
 const on=selectedHosts.includes(h.id), req=hostRequirement(h.id);
 const verified=prior?.status==='verified'&&prior.verifiedProtocol===p.protocolVersion&&prior.verifiedVault===p.vault;
 const evidence=!prior?t('Not connected','Bağlı değil')
  :verified?t('Connected · read/write verified','Bağlı · okuma/yazma doğrulandı')
  :t('Connected · access not verified','Bağlı · erişim doğrulanmadı');
 const removing=prior&&!on;
 return '<label class="host-card" data-selected="'+on+'" data-removing="'+!!removing+'">'
  +'<span class="host-card-top"><input name="review-host" type="checkbox" value="'+esc(h.id)+'" '+(on?'checked':'')+(busy?' disabled':'')+'><strong>'+esc(h.label)+'</strong>'+providerBadge(h.id)+'</span>'
  +'<span class="host-card-kind">'+connectionKind(h.id)+'</span>'
  +'<span class="host-card-found" data-verified="'+verified+'">'+evidence+'</span>'
  +(req?'<span class="host-card-req">'+req+'</span>':'')
  +(removing?'<span class="host-card-req host-card-remove">'+t('Unticked: this connection will be removed. Your notes stay.','İşaret kaldırıldı: bu bağlantı kaldırılacak. Notların kalır.')+'</span>':'')
  +'</label>';
}
function renderReview(){
 const p=state.profile,conflicts=reviewResult?.conflicts||[];
 // The folder this screen confirms may not exist: uninstalling the program left the profile
 // behind, so a reinstall resumed it and the user was shown a notes folder they had deleted.
 // Until a real folder is settled there is nothing to review, and Apply stays closed.
 const gone=state.vaultMissing;
 // Five paragraphs stood between this screen and its consent box, and four of them repeated
 // each other or belonged on a provider card. A setup screen is not a legal article: the main
 // flow now carries state, choice, one helper line, consent and the action. What is genuinely
 // required but is not a decision -- processing, the account/permission distinction, the
 // access level -- sits one fold down. The consent sentence stays in the open.
 const hosts=state.hosts.filter(h=>!h.variantOf);
 content.innerHTML='<h1>'+t('Review your installation','Kurulumunu gözden geçir')+'</h1>'
  +'<p>'+(gone?t('Your previous notes folder is not there any more. Choose where your notes should live before connecting anything.','Önceki not klasörün artık yok. Bir şey bağlamadan önce notlarının nerede duracağını seç.')
              :t('Settings from your previous installation were found. Confirm the folder and the connections, then apply.','Önceki kurulumundan ayarlar bulundu. Klasörü ve bağlantıları onayla, sonra uygula.'))+'</p>'
  +'<h2>'+t('Notes folder','Not klasörü')+'</h2><p class="path">'+esc(p.vault)+'</p>'
  +(gone?'<div class="health-row health-warn"><div><span>'+t('Not found','Bulunamadı')+'</span><p>'+t('Nothing was deleted by this app. Point Claudian at the folder, or create it again here.','Bu uygulamadan hiçbir şey silinmedi. Klasörü göster ya da burada yeniden oluştur.')+'</p></div>'+btn('Choose folder','Klasör seç','relocate',true)+btn('Create it again','Yeniden oluştur','relocate-same')+'<span id="relocate-status" role="status"></span></div>'
        :'<div class="toolbar">'+btn('Choose another folder','Başka klasör seç','relocate')+'</div>')
  +'<h2>'+t('AI applications','AI uygulamaları')+'</h2>'
  +'<div class="host-grid">'+hosts.map(reviewHostCard).join('')+'</div>'
  +'<p class="hint">'+t('Apply repairs the ticked connections and removes the unticked ones. Your notes are never touched.','Uygula, işaretli bağlantıları onarır ve işaretsiz olanları kaldırır. Notlarına hiçbir şey yapılmaz.')+'</p>'
  +'<details class="review-details"><summary>'+t('What this changes, and what it does not','Bu neyi değiştirir, neyi değiştirmez')+'</summary>'
   +'<p>'+t('Access level for the folder above: ','Yukarıdaki klasör için erişim düzeyi: ')+t(p.access==='write'?'read, create, update and archive notes.':'read notes only.',p.access==='write'?'notları okuma, oluşturma, güncelleme ve arşivleme.':'yalnızca notları okuma.')+'</p>'
   +'<p>'+t('This applies local configuration changes on this computer. It is not acceptance of a user agreement, it signs in to no account, and it grants no cloud access — that is approved separately inside the AI itself.','Bu işlem bu bilgisayardaki yerel ayarları değiştirir. Bir kullanıcı sözleşmesi kabulü değildir, hiçbir hesaba giriş yapmaz ve bulut erişimi vermez — o izin AI uygulamasının kendisinde ayrıca onaylanır.')+'</p>'
   +'<p>'+t('When an AI reads a note, that content may be processed by its provider.','AI bir notu okuduğunda içerik o AI sağlayıcısında işlenebilir.')+'</p>'
  +'</details>'
  +'<label class="check grant-confirm"><input type="checkbox" id="grant-confirm" '+(granted?'checked':'')+'><span>'+t('Allow Claudian to apply these local connection changes.','Claudian’ın bu yerel bağlantı değişikliklerini uygulamasına izin veriyorum.')+'</span></label>'
  +(busy?'<p role="status"><span class="verify-spinner"></span> '+t('Applying your choices…','Seçimlerin uygulanıyor…')+'</p>'
  // A disabled button with no explanation reads as a broken screen. Say which box is unticked,
  // and keep the control in the viewport instead of at the bottom of a long page.
  :'<div class="sticky-actions"><p class="sticky-reason">'+(gone?t('Choose or recreate your notes folder first.','Önce not klasörünü seç veya yeniden oluştur.'):!granted?t('Tick the permission box above to continue.','Devam etmek için yukarıdaki izin kutusunu işaretle.'):t('Ready to apply.','Uygulamaya hazır.'))+'</p>'
   +((gone||!granted)?btn('Apply choices','Seçimleri uygula','review-apply',true,'disabled'):'<button data-action="review-apply" class="primary next-step">'+t('Apply choices','Seçimleri uygula')+'</button>')+'</div>')
  +(reviewResult?'<section role="status"><h2>'+t('Installation result','Kurulum sonucu')+'</h2><p>'+ (conflicts.length?t('Some modified files were preserved. Review them before considering setup complete.','Değiştirilmiş bazı dosyalar korundu. Kurulumu tamamlandı saymadan bunları kontrol et.'):t('Selected local connections and managed files were checked. Now test them in the AI.','Seçili yerel bağlantılar ve yönetilen dosyalar kontrol edildi. Şimdi AI içinde test et.'))+'</p>'+conflicts.map(f=>'<p class="path">'+esc(f)+'</p>').join('')+(conflicts.some(f=>/Protocol|CHATGPT.md|CLAUDE.md|CODEX.md/.test(f))?btn('Back up and update protocol copies','Protokol kopyalarını yedekle ve güncelle','review-protocol'):'')+'<div class="actions">'+btn('Go to connection tests','Bağlantı testlerine geç','review-done',true)+'</div></section>':'');
}
