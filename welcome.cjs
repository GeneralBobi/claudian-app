'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const starter=require('./starter.cjs');
// The starter memory is shaped like the vault this product was learned from: an entry map, a
// note about the system itself, the graph explained, a real panel, a tools register, and one
// adapter per connected application. The previous starter was nine flat notes; it was a place
// to put things and not a place to find them, and no agent could be consistent in it.
//
// How each application reaches this memory, in its own words. A user who cannot see the
// mechanism cannot tell a working connection from a decorative one.
const MECHANISM={
 gemini:{tr:'Gemini web içinde Spark özel uygulaması ve cihaz OAuth bağlantısı kullanılır. Gemini CLI veya Antigravity kanıtları bu bağlantıyı doğrulamaz. Spark yoksa yalnız elle paylaşılan bağlam kullanılabilir.',en:'Uses a Spark custom app and device OAuth in Gemini web. CLI or Antigravity receipts do not verify this connection. Without Spark, only manually shared context is available.'},
 perplexity:{tr:'Perplexity özel uzak connector üzerinden OAuth ve Streamable HTTP kullanır. Hesap bağlantısı ve gerçek araç çağrısı ayrıca doğrulanır.',en:'Uses a private remote Perplexity connector with OAuth and Streamable HTTP. Account connection and actual tool calls require separate verification.'},
 'claude-code':{tr:'Yerel Claudian sunucusuna bağlanır ve yetenekleri adlarıyla çağırır. Başlangıç kuralı ve tur kancaları bu uygulamanın kendi ayar dosyasında durur; not klasörü erişimi de oradan verilir.',
                en:'Connects to the local Claudian server and calls its capabilities by name. The startup rule and turn hooks live in this application’s own settings file, and folder access is granted there too.'},
 codex:{tr:'Yerel Claudian sunucusuna bağlanır. Not klasörü, sanal alanın yazılabilir kökleri arasına eklenir; tur kancaları uygulamanın kendi güven onayını bekler.',
        en:'Connects to the local Claudian server. The notes folder is added to the sandbox’s writable roots, and turn hooks wait for this application’s own trust approval.'},
 cursor:{tr:'Yerel Claudian sunucusuna bağlanır. Not klasörünün ajanın çalışma alanına eklenmesi tek elle adımdır.',
         en:'Connects to the local Claudian server. Adding the notes folder to the agent workspace is a single manual step.'},
 'gemini-cli':{tr:'Yerel Claudian sunucusuna bağlanır ve not klasörü bağlam dizinleri arasına eklenir.',
               en:'Connects to the local Claudian server, and the notes folder is added to its context directories.'},
 'claude-desktop':{tr:'Yerel Claudian sunucusuna bağlanır. Bu uygulama skill dosyası okumaz; yetenekler adlarıyla çağrılır.',
                   en:'Connects to the local Claudian server. This application reads no skill file; capabilities are called by name.'},
 antigravity:{tr:'Bağlam dosyası üzerinden okur. Bu yüzeyde yerel sunucu bağlantısı doğrulanmadı.',
              en:'Reads through its context file. A local server connection has not been verified on this surface.'},
 'antigravity-cli':{tr:'Bağlam dosyası üzerinden okur. Bu yüzeyde yerel sunucu bağlantısı doğrulanmadı.',
                    en:'Reads through its context file. A local server connection has not been verified on this surface.'},
 chatgpt:{tr:'Yerel bir süreç başlatamaz; bağlantı yalnız genel bir web adresinden kurulabilir. Bu kurulum ChatGPT hesabına bağlanmadı.',
          en:'Cannot start a local process; it connects only over a public web address. This installation has not connected a ChatGPT account.'},
};
// hosts selects which adapter notes are written. Roles, not filenames, are what the protocol
// and the skill resolve, so any of these may be renamed by the user without breaking.
exports.skeleton=(language='en',name='',hosts=[],labels={})=>{
 const {notes,names}=starter.notes(language,String(name||'').trim());
 const result={...notes};
 for(const host of hosts){
  const mechanism=MECHANISM[host];
  if(!mechanism)continue;
  const {file,body}=starter.adapter(language,host,{label:labels[host]||host,mechanism},names);
  result[file]=body;
 }
 return result;
};
exports.names=(language,name)=>starter.notes(language,String(name||'').trim()).names;
exports.ROLES=starter.ROLES;

exports.ensure=async(profile,assertPath)=>{
 const created=[];
 const entries=exports.skeleton(profile.language,profile.name,(profile.hosts||[]).map(h=>h.id),Object.fromEntries((profile.hosts||[]).map(h=>[h.id,h.label])));
 if(profile.storage==='obsidian')entries['.obsidian/app.json']='{}\n';
 for(const [name,content] of Object.entries(entries)){
  const dest=path.join(profile.vault,name);await assertPath(dest);await fs.mkdir(path.dirname(dest),{recursive:true});
  try{await fs.writeFile(dest,content,{flag:'wx'});created.push(name);}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 return created;
};
exports.save=async(profile,answers,assertPath)=>{
 const names=exports.names(profile.language,profile.name);
 if(!Array.isArray(answers)||answers.length!==3||answers.some(a=>typeof a!=='string'||a.length>4000)||!answers.some(a=>a.trim()))throw new Error('Please add at least one answer.');
 const tr=profile.language==='tr';const labels=tr?['Benim için önemli olanlar','Şu an üzerinde çalıştıklarım','Nasıl destek bekliyorum']:['What matters to me','What I am working on','How I want support'];
 const file=path.join(profile.vault,`Claudian Introduction ${Date.now()}-${crypto.randomBytes(3).toString('hex')}.md`);await assertPath(file);
 await fs.writeFile(file,`---\ntags: [claudian, introduction]\nsource: user-onboarding\ncreated: ${new Date().toISOString()}\n---\n\n# ${tr?'Tanışma':'Introduction'}\n\n${[names.entry,names.about,names.projects].filter(Boolean).map(n=>'[['+n.slice(0,-3)+']]').join(' · ')}\n\n`+answers.map((a,i)=>`## ${labels[i]}\n\n${a.trim()||'—'}\n`).join('\n'),{flag:'wx'});
 return path.basename(file);
};
exports.prompt=profile=>`Start an optional Claudian introduction with me in ${profile.language==='tr'?'Turkish':'English'}. The selected memory folder is ${JSON.stringify(profile.vault)}. Read the installed claudian-memory skill, its memory protocol, and Claudian Home.md. Use only information available in this session and sources I explicitly select or authorize. Do not search other profiles, private history databases or the whole computer. Explain which past context you actually have; do not claim access to other AI conversations. First ask which existing notes or exported conversations I want to include. If I have no sources, ask one question at a time about my current projects, durable preferences and how I want support. Preserve original notes; link to existing notes before making duplicates. Save concise confirmed facts with source and date, distinguish uncertainties, and never infer a diagnosis or permanent trait from passing mood. Do not store secrets or raw transcripts. Update the Claudian Home map and related notes. At the end show what was added and what remains unknown. Do not claim completion before files are written. This is one interactive session, not a background scan.`;
