'use strict';
const {execFile,spawn}=require('node:child_process');
const run=require('node:util').promisify(execFile);
const fs=require('node:fs/promises');
const path=require('node:path');
// "Gemini CLI" adında bir host vardı ve CLI'ı hiç aranmıyordu: burada girişi olmadığı için
// resolve() daha PATH'e bakmadan null dönüyordu, yani altı host'un dördü değil beşi elle
// yapıştırmaya kalıyordu. Ölçüldü: gemini.cmd makinede kurulu.
const commands={'codex':'codex','claude-code':'claude','gemini-cli':'gemini'};
exports.resolve=async (id,explicit)=>{
 if(!commands[id])return null;
 if(explicit && path.isAbsolute(explicit) && /\.(exe|cmd)$/i.test(explicit)){try{if((await fs.stat(explicit)).isFile())return explicit;}catch{}}
 const home=require('node:os').homedir();
 const candidates=id==='claude-code'?[path.join(home,'.local','bin','claude.exe')]:[];
 // npm ile global kurulan CLI'lar AppData\Roaming\npm altında .cmd olarak durur ve aday
 // listesinde hiç yoktu. where.exe bazen bulur, ama uygulamanın PATH'i kullanıcının
 // kabuğuyla aynı olmak zorunda değil — o yüzden doğrudan bakılır.
 const npmGlobal=process.env.APPDATA?path.join(process.env.APPDATA,'npm'):path.join(home,'AppData','Roaming','npm');
 if(id==='codex'){const base=path.join(process.env.LOCALAPPDATA||path.join(home,'AppData','Local'),'OpenAI','Codex','bin');try{for(const entry of (await fs.readdir(base,{withFileTypes:true})).filter(e=>e.isDirectory()).reverse())candidates.push(path.join(base,entry.name,'codex.exe'));}catch{}}
 // npm kabukları en sonda: yerel bir .exe varsa o tercih edilir. PowerShell ikisini de
 // çağırabildiği için bu bir doğruluk değil, temizlik meselesi.
 for(const ext of ['.exe','.cmd'])candidates.push(path.join(npmGlobal,commands[id]+ext));
 for(const candidate of candidates){try{if((await fs.stat(candidate)).isFile())return candidate;}catch{}}
 try {const {stdout}=await run('where.exe',[commands[id]],{windowsHide:true});return stdout.split(/\r?\n/).map(x=>x.trim()).find(x=>path.isAbsolute(x)&&/\.(exe|cmd)$/i.test(x))||null;}catch{return null;}
};
exports.prompt=profile=>profile.language==='tr'?`Seçili hafıza klasörü: ${profile.vault}

Önce startup_context veya kurulu claudian-memory skill’i ile güncel uygulama protokolünü yükle; giriş haritasını ve mevcut kullanıcı kısıtlarını oku. Vault protokol kopyası silinmişse geri oluşturma.

Benim hakkımda zaten erişebildiğin bilgileri dikkatle gözden geçirmeni istiyorum. Yalnız bu oturumda gerçekten kullanılabilen hafızanı ve erişimine izin verdiğim bağlı kaynakları kullan. Önce hangi kaynaklara erişebildiğini kısaca belirt. Bir kaynak ek izin gerektiriyorsa veya kapsamı belirsizse okumadan önce sor. İlgisiz bilgisayar dosyalarını tarama; başka sağlayıcıların geçmiş sohbetlerine erişimin varmış gibi davranma. Faydalı bilgi yoksa en fazla üç odaklı soru sor ve yanıtımı bekle.

Kalıcı hedeflerimi, aktif projelerimi, kabul ettiğim kararları ve gerekçelerini, istikrarlı tercihlerimi, düzeltmeleri ve tekrarını önleyecek dersleri ara. Önce mevcut notları kontrol et. Beyanlarımı, gözlemleri ve belirsiz çıkarımları ayır. Hassas özellikler çıkarma; sırları, üçüncü kişilerin özel kayıtlarını, ham sohbeti veya geçici ruh hâlini kaydetme. Derin inceleme daha çok not değil, daha iyi seçim demektir.

Her konu için tek kanonik kayıt tut. Protokole göre ADD, UPDATE, INVALIDATE, DELETE veya NO_OP seç. Kaynağı, bilinen tarihleri ve belirsizliği koru. Ana harita ve ilgili notlar arasındaki bağlantıları düzenle; ilgisiz notları silme. Yazdıklarını doğrula. Bu başlangıç incelemesi sonunda gerçekten kullanılan kaynakları, değişen kayıtları ve kalan boşlukları kısaca özetle.

Bu uygulamanın kalıcı hafıza özelliği varsa oraya yalnız şu kullanım bilgisini ekle: Selamlaşma dahil her konuşmanın başında güncel bağlantının seçili vault’unu sessizce protokolüne göre kullan ve slash komutu bekleme. Vaultun tamamını sağlayıcının hafızasına çoğaltma. Kalıcı hafıza yoksa bunu açıkça belirt; kurulu başlangıç talimatları giriş yolu olarak kalır.

Bu başlangıç incelemesinden sonra rutin hafıza bakımını sessiz yap. Bu, kullanıcının başlattığı bir oturumdur; sürekli çalışan arka plan ajanı değildir.`:`Selected memory folder: ${JSON.stringify(profile.vault)}.
Load the current application protocol using startup_context or the installed claudian-memory skill, then read the entry map and existing user constraints. A deleted vault protocol copy is not an error; do not recreate it.

I want an initial, careful review of what you already know about me. Use only memories actually available to this session and connected sources I have authorized. First tell me briefly which sources you can access; if a source needs permission or its scope is unclear, ask before reading it. Do not scan unrelated computer files, invent access to earlier chats, or treat this request as access to other providers' accounts. If nothing useful is available, ask up to three focused questions and wait for my answers.

Look for durable goals, active projects, accepted decisions and their reasons, stable preferences, corrections and lessons that would improve future conversations. Search existing notes first. Distinguish my statements from observations and tentative interpretations. Do not infer sensitive traits or copy secrets, private third-party records, entire chats or temporary moods. Follow the protocol's admission and context rules; deeper review means better selection, not more notes.

Keep one canonical record per topic. Apply ADD, UPDATE, INVALIDATE, DELETE or NO_OP as appropriate, preserving source, known dates and uncertainty. Repair useful links to the home map and related notes. Do not delete unrelated notes. Verify your edits and give a brief completion summary of actual sources used, records updated and any gaps. Do not claim completion before writing.

If this host offers persistent memory, remember only this usage pointer there: silently use the currently connected vault at the start of every conversation, including greetings, maintaining it according to its protocol, and do not wait for a slash command. Do not duplicate the whole vault into provider memory. If persistent memory is unavailable, say so; the installed startup instructions remain the entry mechanism.

After this initial review, keep routine memory maintenance quiet. This is a user-started session, not an always-running background agent.
`;
const basePrompt=exports.prompt;
exports.commandScript=(vault,executable,instruction,id)=>{
 const quote=s=>"'"+String(s).replace(/['‘’‚‛]/g,m=>m+m)+"'";
 const argument='Read '+path.basename(instruction)+' and follow its instructions.';
 return `Set-Location -LiteralPath ${quote(vault)}\n& ${quote(executable)} ${id==='gemini-cli'?'-i ':''}${quote(argument)}\n`;
};
exports.prompt=profile=>basePrompt(profile)+'\n\n'+(profile.language==='tr'?'Uygulamanın yönettiği gerçek başlangıç dosyaları (kendi AI bağlantının dosyasını kullan):':'Actual application-managed entry files (use your own host entry):')+'\n'+(profile.hosts||[]).filter(h=>h.artifacts?.skill).map(h=>(h.label||h.id)+': '+h.artifacts.skill).join('\n');
exports.launch=async(profile,id,prompt,executablePath)=>{
 if(!profile.hosts.some(h=>h.id===id))throw new Error('This AI connection is not configured.');
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>8000)throw new Error('Invalid scan message.');
 const executable=await exports.resolve(id,executablePath);if(!executable)throw new Error('No CLI was found for this application. Paste the instruction into it instead.');
 // PowerShell ends a single-quoted string on the typographic quotes too, not only on U+0027.
 // Turkish text is full of them -- "skill'i", "AI'ın" -- so a prompt carrying one closed its
 // own string mid-sentence and everything after it was parsed as code. Measured 13.09.2026:
 // "Missing argument in parameter list" at the first semicolon after the apostrophe, on a
 // machine where the same launcher had always worked in English. Every quote the tokenizer
 // accepts is doubled, which is how PowerShell escapes them.
 const quote=s=>"'"+String(s).replace(/['‘’‚‛]/g,m=>m+m)+"'";
 // A short ASCII-only argument avoids Windows PowerShell 5.1 re-quoting embedded
 // double quotes and npm .cmd reparsing. The full instruction remains in UTF-8.
 const instruction=path.join(profile.vault,`.claudian-session-${require('node:crypto').randomUUID()}.md`);
 await fs.writeFile(instruction,prompt,{flag:'wx'});
 const script=exports.commandScript(profile.vault,executable,instruction,id);
 // No shell interpolation of user text; PowerShell literals double embedded quotes.
 // A GUI Electron parent cannot provide an interactive console through ignored stdio.
 // Ask Windows to create a visible console, and wait for that launcher to report errors.
 const encoded=Buffer.from(script,'utf16le').toString('base64');
 const launch=`$ErrorActionPreference='Stop'; $session=Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-NoExit','-EncodedCommand','${encoded}') -WindowStyle Normal -PassThru; $session.Id`;
 const result=await run('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(launch,'utf16le').toString('base64')],{windowsHide:true,timeout:15000});
 const pid=Number(result.stdout.trim());
 if(!Number.isSafeInteger(pid)||pid<=0)throw Error('AI terminal could not be opened. Copy the instruction into your AI instead.');
 return {launched:true,pid};
};
