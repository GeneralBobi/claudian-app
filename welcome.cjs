'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
exports.skeleton=(language='en')=>{
 const tr=language==='tr';
 const titles=tr?['Hafızana hoş geldin','Hakkımda','Projeler','Kararlar','Öğrenilenler']:['Welcome to your memory','About me','Projects','Decisions','Lessons'];
 const names=['Home','About me','Projects','Decisions','Lessons'];
 const result={};
 names.forEach((name,i)=>{result[`Claudian ${name}.md`]=`---\ntags: [claudian, starter]\n---\n\n# ${titles[i]}\n\n`+(i===0?(tr?'Buradan başla. Bu harita seninle birlikte gelişir.':'Start here. This map grows with you.')+'\n\n'+names.slice(1).map((n,j)=>`- [[Claudian ${n}|${titles[j+1]}]]`).join('\n'):(tr?'Henüz bilgi eklenmedi. Yalnız doğrulanmış bilgileri, kaynak ve tarihleriyle kaydet.':'No information added yet. Keep confirmed information with its source and date.')+'\n\n[[Claudian Home]]')+'\n';});
 return result;
};
exports.ensure=async(profile,assertPath)=>{
 const created=[];
 const entries=exports.skeleton(profile.language);
 if(profile.storage==='obsidian')entries['.obsidian/app.json']='{}\n';
 for(const [name,content] of Object.entries(entries)){
  const dest=path.join(profile.vault,name);await assertPath(dest);await fs.mkdir(path.dirname(dest),{recursive:true});
  try{await fs.writeFile(dest,content,{flag:'wx'});created.push(name);}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 return created;
};
exports.save=async(profile,answers,assertPath)=>{
 if(!Array.isArray(answers)||answers.length!==3||answers.some(a=>typeof a!=='string'||a.length>4000)||!answers.some(a=>a.trim()))throw new Error('Please add at least one answer.');
 const tr=profile.language==='tr';const labels=tr?['Benim için önemli olanlar','Şu an üzerinde çalıştıklarım','Nasıl destek bekliyorum']:['What matters to me','What I am working on','How I want support'];
 const file=path.join(profile.vault,`Claudian Introduction ${Date.now()}-${crypto.randomBytes(3).toString('hex')}.md`);await assertPath(file);
 await fs.writeFile(file,`---\ntags: [claudian, introduction]\nsource: user-onboarding\ncreated: ${new Date().toISOString()}\n---\n\n# ${tr?'Tanışma':'Introduction'}\n\n[[Claudian Home]] · [[Claudian About me]] · [[Claudian Projects]]\n\n`+answers.map((a,i)=>`## ${labels[i]}\n\n${a.trim()||'—'}\n`).join('\n'),{flag:'wx'});
 return path.basename(file);
};
exports.prompt=profile=>`Start an optional Claudian introduction with me in ${profile.language==='tr'?'Turkish':'English'}. The selected memory folder is ${JSON.stringify(profile.vault)}. Read the installed claudian-memory skill, its memory protocol, and Claudian Home.md. Use only information available in this session and sources I explicitly select or authorize. Do not search other profiles, private history databases or the whole computer. Explain which past context you actually have; do not claim access to other AI conversations. First ask which existing notes or exported conversations I want to include. If I have no sources, ask one question at a time about my current projects, durable preferences and how I want support. Preserve original notes; link to existing notes before making duplicates. Save concise confirmed facts with source and date, distinguish uncertainties, and never infer a diagnosis or permanent trait from passing mood. Do not store secrets or raw transcripts. Update the Claudian Home map and related notes. At the end show what was added and what remains unknown. Do not claim completion before files are written. This is one interactive session, not a background scan.`;
