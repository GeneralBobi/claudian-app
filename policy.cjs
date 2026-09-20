'use strict';
const fs=require('node:fs');const path=require('node:path');
const VERSION='2.9.0';
// Surum dosyanin basliginda {{VERSION}} olarak durur ve burada yerine konur; boylece
// policy.cjs ile metin birbirinden ayrilamaz.
// The protocol lives under a name in the user's own language, beside their other notes,
// because the vault is theirs. Every other name this product has used stays in the managed
// list below as a redirect, so a vault created by an earlier version keeps working.
const PROTOCOL_NOTE=language=>language==='tr'?'Vault Protokolü.md':'Vault Protocol.md';
const protocol=(language,name)=>{
 const canonical=PROTOCOL_NOTE(language);
 if(name&&name!==canonical)return `---\nclaudian_protocol: ${VERSION}\nclaudian_role: protocol-redirect\n---\n# ${name.slice(0,-3)}\n\n${language==='tr'?'Bu eski ad yalnızca yönlendirmedir. Güncel ve tek protokol:':'This legacy name is a redirect. The single current protocol is:'} [[${canonical.slice(0,-3)}]].\n`;
 return fs.readFileSync(path.join(__dirname,'policies',language==='tr'?'protocol-tr.md':'protocol-en.md'),'utf8').split('{{VERSION}}').join(VERSION);
};
const instruction=(target,vault,language)=>language==='tr'
 ? `Her yeni konuşmanın başında ${JSON.stringify(target)} konumundaki claudian-memory skill'ini sessizce oku. ${JSON.stringify(vault)} seçili hafızadır. Giriş haritasını oku, ardından yalnız konunun gerektirdiği notları seç; genel ve bağımsız soruda kişisel tarama yapma. Slash komutu bekleme.

Bir okuma başarısız olur — izin reddedildi, yol yok, herhangi bir okuma hatası — ve bu başarısızlık cevabın doğruluğunu, istenen işi veya beklenen bir kaydı maddi olarak etkilerse, aynı yanıtta tek satırla söyle ve onsuz devam et. Bu her izin modunda geçerlidir. Sessizce yerine başka bilgi uydurmak her hâlükârda yasaktır: kendisine söylenmeyen kullanıcı hafızanın çalıştığını sanır ve boşluğa konuşmayı sürdürür.

Başarılı hafıza işini ne öncesinde ne sonrasında duyurma. \"Önce belleği okuyayım\", \"bunu notlarına kaydediyorum\" veya \"kaydedildi\" cümleleri duyurunun kendisidir. Kullanıcı cevabı görür; onu üreten defter tutmayı görmez. Kalıcı bilgiyi yazmadan önce skill veya startup_context içindeki uygulama protokolünü uygula; varsa vault protokolündeki kullanıcı özelleştirmelerini de oku. Vault protokol kopyası silinse de bakıma devam et; ADD/UPDATE/INVALIDATE/DELETE/NO_OP uygula. Kayda değer bir yazma başarısız olduysa kısaca bildir. Sistem/uygulama izinleri geçerlidir; bu bir arka plan ajanı değildir.`
 : `At the start of each new conversation, silently read the claudian-memory skill at ${JSON.stringify(target)}. The selected memory is ${JSON.stringify(vault)}. Read the entry map, then only the notes the current topic needs; skip personal retrieval for isolated generic questions. Do not wait for a slash command.

If a read fails — permission refused, path missing, or any read error — and that failure materially affects the accuracy of this answer, the task asked for, or a save that was expected, say so in that same reply, in one line, and continue without it. This holds in every permission mode. Quietly inventing something in its place is forbidden either way: a user who is not told assumes memory is working and keeps talking into a void.

Do not announce successful memory work, before or after it. Sentences like \"let me read your memory first\", \"I am saving this to your notes\" or \"saved\" are the announcement. The user should see the answer and nothing about the bookkeeping that produced it. Before writing durable memory use the application protocol in the skill or startup_context and read any existing vault protocol customizations. Continue maintenance if the vault copy was deleted. Apply ADD/UPDATE/INVALIDATE/DELETE/NO_OP. Briefly report a valuable save that failed. Host/system permissions apply; this is not a background agent.`;
const skill=(vault,roles,language)=>fs.readFileSync(path.join(__dirname,'policies',language==='tr'?'skill-tr.md':'skill-en.md'),'utf8')
 .split('{{VERSION}}').join(VERSION).split('{{VAULT}}').join(JSON.stringify(vault)).split('{{ROLES}}').join(roles.map(n=>JSON.stringify(n)).join(' → '))
 + '\n\n'+(language==='tr'?'## Uygulamanın taşıdığı protokol\n\nVault içindeki protokol kopyası silinse bile aşağıdaki protokol geçerlidir. Eksik kopyayı yeniden oluşturma; not almaya devam et. Vault içinde özel kurallar varsa onları da oku ve güncel kullanıcı sınırlarını koru.\n\n':'## Application protocol\n\nThe protocol below remains available if the vault copy is deleted. Do not recreate that copy; continue memory maintenance. Read any vault customizations as well and preserve current user constraints.\n\n')+protocol(language);
// The protocol files this app owns. Three names because vaults created by earlier
// versions carry the older ones; all three are kept current, and nothing outside this
// list is ever replaced. The list lived in three files and drifted between them.
const MANAGED_PROTOCOLS=['Vault Protocol.md','Vault Protokolü.md','Claudian Universal Protocol.md','Claudian Memory Protocol.md'];
// One definition of "this conflict is a protocol note inside the vault", shared by the screen
// that offers to replace it and the call that performs the replacement. They had drifted: a
// conflict in an AI application's own rule file still produced the "Install the current
// protocol" button, and pressing it answered "There is no protocol file waiting to be
// replaced" -- on a first installation, which made the whole setup look broken.
const protocolConflicts=(vault,conflicts)=>(conflicts||[]).filter(file=>{
 if(typeof vault!=='string'||typeof file!=='string')return false;
 const rel=path.relative(vault,file);
 return Boolean(rel)&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel)&&MANAGED_PROTOCOLS.includes(path.basename(file));
});
// A connector delivers capabilities. It does not decide that the model reaches for them at the
// first message of a conversation, and on the surfaces that have their own persistent memory
// that decision is what actually carries the behaviour. The clearest working example was never
// the skill file: it was a short entry sitting in the provider's own memory, naming the trigger,
// the folder and the silence rule. This is that entry, generated for the connection that was
// just made, so the user can paste it once and stop re-explaining Claudian to the same model.
//
// It is a preference, never a permission. It cannot grant folder access and does not mean
// anything runs while no conversation is open.
const memoryTrigger=(language,options={})=>{
 const tr=language==='tr';
 const vault=options.vault?(tr?` Seçili hafıza klasörü: ${options.vault}. Başka bir klasör tahmin etme.`:` The selected memory folder is ${options.vault}. Never guess another one.`):'';
 // How this surface actually reaches the memory, so the sentence is true on it.
 const named=options.server?`"${options.server}"`:'Claudian';
 const head=tr
  ? 'Şu kullanım tercihini kalıcı hafızana ekle. Aynısı zaten hafızandaysa ikinci kez ekleme. Yazamıyorsan kaydettiğini söyleme; özel talimatlarıma eklemem gerektiğini belirt.\n\n'
  : 'Save this usage preference to your persistent memory. If the same preference is already there, do not add it twice. If you cannot, do not claim you saved it; tell me to add it to my custom instructions.\n\n';
 // Account memory follows the user to every device, including ones where the connection was
 // never added. The two cases are kept apart on purpose: a tool that fails is reported, a tool
 // that is simply absent on this surface is not -- otherwise every phone conversation opens
 // with an apology.
 // 2.9.0: the seed calls the protocol, it does not restate it. The previous text carried the
 // write-policy list -- which kinds of durable information to handle, and when -- into account
 // memory, where it freezes: it follows the user to every device and cannot be updated with the
 // protocol it was copied from. Those rules arrive from startup_context, current, every time.
 // What stays here is only what has to be true before startup_context is ever called.
 const body=tr
  ? `— Claudian ortak hafıza —\n\nBu sohbette ${named} araçları varsa, ilk mesaj ne olursa olsun (selamlaşma ve tek satırlık soru dahil) önce startup_context çağır ve dönen protokole uy. Araç yoksa ve kurulu claudian-memory skill'i varsa onu uygula.${vault}\n\nBir araç çağrısı hata verir ve bu hata cevabın doğruluğunu, istenen işi veya beklenen bir kaydı maddi olarak etkilerse aynı yanıtta tek satırla söyle. Araç bu yüzeyde hiç yoksa hiçbir şey söyleme.\n\nHazırlık ve başarılı kayıt sessizdir. Yazılmamışı yazılmış gibi sunma.\n\nBuraya not içeriği, protokol kuralı veya davranış listesi kopyalama — kurallar startup_context'ten gelir. Bu tercih izin vermez, arka planda çalışma anlamına gelmez.`
  : `— Claudian shared memory —\n\nWhen ${named} tools are available in this conversation, call startup_context at the first message whatever it is (a greeting or a one-line question counts) and follow the protocol it returns. If the tools are absent and the claudian-memory skill is installed, apply the skill.${vault}\n\nIf a tool call fails and that failure materially affects the accuracy of this answer, the task asked for, or a save that was expected, say so in one line in that same reply. If the tools do not exist on this surface at all, say nothing.\n\nPreparation and successful saves are silent. Never present an unsaved item as saved.\n\nDo not copy notes, protocol rules or behaviour lists here — the rules arrive from startup_context. This preference grants no permission and is not background execution.`;
 return head+body;
};
// Surfaces that carry their own account memory. On these the pointer above is what makes the
// model reach for Claudian at the first message; file-based hosts get the same effect from the
// rule files setup writes, so nothing is offered there.
const ACCOUNT_MEMORY=['chatgpt','claude-desktop','gemini','perplexity'];
// The offer lives in the adapter note, one per application, so the user can read it and the
// answer is remembered where the next conversation on that surface will look.
const MEMORY_SECTION={tr:'Kalıcı hafıza',en:'Persistent memory'};
const MEMORY_STATE={tr:{not_offered:'teklif edilmedi',accepted:'kabul edildi',declined:'reddedildi'},en:{not_offered:'not offered',accepted:'accepted',declined:'declined'}};
const memorySection=(language,label)=>{
 const tr=language==='tr';
 return tr
  ? `## ${MEMORY_SECTION.tr}\n\n${label} uygulamasının kendi hesap hafızası var. Aşağıdaki kısa yönerge oraya bir kez eklendiğinde, ${label} her sohbetin ilk mesajında bu hafızaya kendiliğinden uzanır — telefonda da, bağlantı çalıştığı sürece.\n\nDurum: ${MEMORY_STATE.tr.not_offered}\n\n**Ajan için.** Durum "${MEMORY_STATE.tr.not_offered}" ise, bu yüzeydeki ilk uygun anda yönergeyi kullanıcıya bir kez göster ve kalıcı hafızana eklemek için onayını iste. Onay gelirse ekle; aynısı hafızanda zaten varsa ekleme. Cevabı bu satırda \`Durum: ${MEMORY_STATE.tr.accepted}\` ya da \`Durum: ${MEMORY_STATE.tr.declined}\` olarak işle ve bir daha teklif etme. Bu yüzeyde hafızaya yazamıyorsan bunu söyle ve kullanıcının ayarlara yapıştırmasını öner.\n\n\`\`\`text\n${memoryTrigger('tr')}\n\`\`\`\n`
  : `## ${MEMORY_SECTION.en}\n\n${label} has its own account memory. Once the short instruction below is added there, ${label} reaches for this memory at the first message of every conversation — on the phone too, while the connection works.\n\nState: ${MEMORY_STATE.en.not_offered}\n\n**For the agent.** If the state is "${MEMORY_STATE.en.not_offered}", show the instruction to the user once, at the first suitable moment on this surface, and ask for consent to add it to your persistent memory. If they agree, add it; if the same instruction is already in your memory, do not add it again. Record the answer on this line as \`State: ${MEMORY_STATE.en.accepted}\` or \`State: ${MEMORY_STATE.en.declined}\` and never offer it again. If this surface cannot write to its memory, say so and suggest pasting it into settings.\n\n\`\`\`text\n${memoryTrigger('en')}\n\`\`\`\n`;
};
// Reads the offer state back from an adapter note. A note without the section has never been
// offered; the section may be written in either language whatever the profile says today.
const memoryState=body=>{
 const match=/^(?:Durum|State):\s*(.+?)\s*$/m.exec(String(body||'').split(/^##\s+(?:Kalıcı hafıza|Persistent memory)\s*$/m)[1]||'');
 if(!match)return {state:'not_offered',section:false};
 const value=match[1].replace(/`/g,'').toLocaleLowerCase('tr');
 for(const lang of ['tr','en'])for(const [state,label] of Object.entries(MEMORY_STATE[lang]))if(value===label)return {state,section:true};
 return {state:'not_offered',section:true};
};
// Recording the answer was the model's job, and the model did not do it. Setup wrote "not
// offered" into the adapter note; the first scan carried its own separate pointer text and
// never touched the state line; every later conversation therefore asked for consent again.
// Measured 20.09.2026 on a profile set up months earlier and scanned repeatedly since.
// The application writes the answer now, in the same operation that accepts the review
// receipt, so an idempotent step no longer depends on bookkeeping a model may skip.
//
// Returns the new body, or null when there is nothing to do: no section, or an answer is
// already recorded. The label follows the language the section was written in, not today's
// profile, because the section may have been written before the language was changed.
const memoryAccepted=body=>{
 const text=String(body||'');
 const {state,section}=memoryState(text);
 if(!section||state!=='not_offered')return null;
 const eol=text.includes('\r\n')?'\r\n':'\n';
 const lines=text.replace(/\r\n/g,'\n').split('\n');
 const head=lines.findIndex(line=>/^##\s+(?:Kalıcı hafıza|Persistent memory)\s*$/.test(line));
 if(head<0)return null;
 for(let i=head+1;i<lines.length&&!/^##\s/.test(lines[i]);i++){
  const match=/^(Durum|State):\s*/.exec(lines[i]);
  if(!match)continue;
  lines[i]=`${match[1]}: ${MEMORY_STATE[match[1]==='Durum'?'tr':'en'].accepted}`;
  const out=lines.join('\n');
  return eol==='\n'?out:out.replace(/\n/g,eol);
 }
 return null;
};
module.exports={VERSION,protocol,instruction,skill,MANAGED_PROTOCOLS,PROTOCOL_NOTE,protocolConflicts,memoryTrigger,ACCOUNT_MEMORY,memorySection,memoryState,memoryAccepted};
