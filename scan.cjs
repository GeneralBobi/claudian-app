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

Önce Claudian Home.md, Claudian Universal Protocol.md ve Claudian Record Guide.md dosyalarını oku.

Benim hakkımda zaten erişebildiğin bilgileri dikkatle gözden geçirmeni istiyorum. Yalnız bu oturumda gerçekten kullanılabilen hafızanı ve erişimine izin verdiğim bağlı kaynakları kullan. Önce hangi kaynaklara erişebildiğini kısaca belirt. Bir kaynak ek izin gerektiriyorsa veya kapsamı belirsizse okumadan önce sor. İlgisiz bilgisayar dosyalarını tarama; başka sağlayıcıların geçmiş sohbetlerine erişimin varmış gibi davranma. Faydalı bilgi yoksa en fazla üç odaklı soru sor ve yanıtımı bekle.

Kalıcı hedeflerimi, aktif projelerimi, kabul ettiğim kararları ve gerekçelerini, istikrarlı tercihlerimi, düzeltmeleri ve tekrarını önleyecek dersleri ara. Önce mevcut notları kontrol et. Beyanlarımı, gözlemleri ve belirsiz çıkarımları ayır. Hassas özellikler çıkarma; sırları, üçüncü kişilerin özel kayıtlarını, ham sohbeti veya geçici ruh hâlini kaydetme. Derin inceleme daha çok not değil, daha iyi seçim demektir.

Her konu için tek kanonik kayıt tut. Protokole göre ADD, UPDATE, INVALIDATE, DELETE veya NO_OP seç. Kaynağı, bilinen tarihleri ve belirsizliği koru. Ana harita ve ilgili notlar arasındaki bağlantıları düzenle; ilgisiz notları silme. Yazdıklarını doğrula. Bu başlangıç incelemesi sonunda gerçekten kullanılan kaynakları, değişen kayıtları ve kalan boşlukları kısaca özetle.

Bu uygulamanın kalıcı hafıza özelliği varsa oraya yalnız şu kullanım bilgisini ekle: İlgili konuşmaların başında bu seçili vaultu sessizce protokolüne göre kullan ve slash komutu bekleme. Vaultun tamamını sağlayıcının hafızasına çoğaltma. Kalıcı hafıza yoksa bunu açıkça belirt; kurulu başlangıç talimatları giriş yolu olarak kalır.

Bu başlangıç incelemesinden sonra rutin hafıza bakımını sessiz yap. Bu, kullanıcının başlattığı bir oturumdur; sürekli çalışan arka plan ajanı değildir. Türkçe yanıt ver.`:`Selected memory folder: ${JSON.stringify(profile.vault)}.
Read Claudian Home.md, Claudian Universal Protocol.md and Claudian Record Guide.md before working.

I want an initial, careful review of what you already know about me. Use only memories actually available to this session and connected sources I have authorized. First tell me briefly which sources you can access; if a source needs permission or its scope is unclear, ask before reading it. Do not scan unrelated computer files, invent access to earlier chats, or treat this request as access to other providers' accounts. If nothing useful is available, ask up to three focused questions and wait for my answers.

Look for durable goals, active projects, accepted decisions and their reasons, stable preferences, corrections and lessons that would improve future conversations. Search existing notes first. Distinguish my statements from observations and tentative interpretations. Do not infer sensitive traits or copy secrets, private third-party records, entire chats or temporary moods. Follow the protocol's admission and context rules; deeper review means better selection, not more notes.

Keep one canonical record per topic. Apply ADD, UPDATE, INVALIDATE, DELETE or NO_OP as appropriate, preserving source, known dates and uncertainty. Repair useful links to the home map and related notes. Do not delete unrelated notes. Verify your edits and give a brief completion summary of actual sources used, records updated and any gaps. Do not claim completion before writing.

If this host offers persistent memory, remember only this usage pointer there: silently use this selected vault at conversation start for relevant context, maintaining it according to its protocol, and do not wait for a slash command. Do not duplicate the whole vault into provider memory. If persistent memory is unavailable, say so; the installed startup instructions remain the entry mechanism.

After this initial review, keep routine memory maintenance quiet. This is a user-started session, not an always-running background agent.
Respond in ${profile.language==='tr'?'Turkish':'English'}.`;
const basePrompt=exports.prompt;
exports.prompt=profile=>basePrompt(profile)+'\n\n'+(profile.language==='tr'?'Uygulamanın yönettiği gerçek başlangıç dosyaları (kendi AI bağlantının dosyasını kullan):':'Actual application-managed entry files (use your own host entry):')+'\n'+(profile.hosts||[]).filter(h=>h.artifacts?.skill).map(h=>(h.label||h.id)+': '+h.artifacts.skill).join('\n');
exports.launch=async(profile,id,prompt,executablePath)=>{
 if(!profile.hosts.some(h=>h.id===id))throw new Error('This AI connection is not configured.');
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>8000)throw new Error('Invalid scan message.');
 const executable=await exports.resolve(id,executablePath);if(!executable)throw new Error('No CLI was found for this application. Paste the instruction into it instead.');
 const quote=s=>"'"+s.replace(/'/g,"''")+"'";
 const script=`Set-Location -LiteralPath ${quote(profile.vault)}\n& ${quote(executable)} ${quote(prompt)}\n`;
 // No shell interpolation of user text; PowerShell literals double embedded quotes.
 const child=spawn('powershell.exe',['-NoProfile','-NoExit','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{detached:true,stdio:'ignore',windowsHide:false});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
 return {launched:true};
};
