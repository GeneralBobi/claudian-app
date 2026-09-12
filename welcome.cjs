'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
// One entry map, one protocol file, and the same three properties on every note.
// Measured 11.09.2026: the previous starter shipped three competing entry maps and
// two byte-identical protocol files, and half the notes carried no type/updated
// field - so the agent could not tell a note's kind or freshness, and never
// refreshed a date that did not exist.
const front = (tags, language) => `---\ntags: [${tags.join(', ')}]\n${language === 'tr' ? 'tür' : 'type'}: `;
const head = (tags, kind, language) => front(tags, language) + `${kind}\n${language === 'tr' ? 'güncellenme' : 'updated'}: ${new Date().toISOString().slice(0, 10)}\n---\n\n`;

exports.skeleton = (language = 'en', name = '') => {
  const tr = language === 'tr';
  // Working agreements is the note the user never asks for and the one that changes behaviour
  // most: their own sentence about how to work with them, captured from real friction.
  const leaves = tr
    ? [['Claudian About me', 'Hakkımda'], ['Claudian Projects', 'Projeler'], ['Claudian Decisions', 'Kararlar'], ['Claudian Lessons', 'Öğrenilenler'], ['Claudian Working agreements', 'Çalışma anlaşmaları']]
    : [['Claudian About me', 'About me'], ['Claudian Projects', 'Projects'], ['Claudian Decisions', 'Decisions'], ['Claudian Lessons', 'Lessons'], ['Claudian Working agreements', 'Working agreements']];
  const result = {};

  // The single entry map. Everything else is reached from here.
  result['Claudian Home.md'] = head(['claudian', 'home'], tr ? 'giriş' : 'home', language)
    + (tr ? `# ${name ? name + ' — hafıza' : 'Hafızan'}\n\nBuradan başla. Bu harita seninle birlikte gelişir.\n\n## Başlangıç\n\nÖnce bu haritayı oku, sonra yalnız konuyla ilgili notları. Kalıcı bir şey yazmadan önce [[Claudian Universal Protocol]] dosyasını oku.\n\n## Açık uçlar\n\n[[Control Panel|Açık konular]] · [[Reminders|Tarihli konular]]\n\n## Nöronlar\n\n`
              : `# ${name ? name + ' — memory' : 'Your memory'}\n\nStart here. This map grows with you.\n\n## Start\n\nRead this map first, then only the notes the topic needs. Before writing anything durable, read [[Claudian Universal Protocol]].\n\n## Open ends\n\n[[Control Panel|Open topics]] · [[Reminders|Dated topics]]\n\n## Neurons\n\n`)
    + leaves.map(([file, label]) => `- [[${file}|${label}]]`).join('\n')
    + `\n\n---\n${tr ? 'Yöntem' : 'Method'}: [[Claudian Universal Protocol]] · [[Claudian Record Guide]]\n`;

  for (const [file, label] of leaves) {
    const agreement = file === 'Claudian Working agreements';
    result[`${file}.md`] = head(agreement ? ['claudian', tr ? 'yöntem' : 'method'] : ['claudian'], tr ? (agreement ? 'yöntem' : 'nöron') : (agreement ? 'method' : 'neuron'), language)
      + `# ${label}\n\n[[Claudian Home]]\n`
      + (agreement ? (tr ? `\nKullanıcının kendi cümleleriyle, nasıl çalışılacağına dair kalıcı talimatlar. Sorularak değil, gerçek sürtünmeden birikir: bir düzeltme, bir ret, bir \"öyle değil\" geldiğinde o cümle gerekçesiyle buraya yazılır.\n\nUydurulmaz. Tek seferlik bir yorum kalıcı kurala çevrilmez. Yeni bir düzeltme eskisiyle çelişirse yenisi aktif bölümde eskisinin yerini alır.\n` : `\nDurable instructions about how to work with this person, in their own words. These accumulate from real friction rather than from being asked for: when a correction, a rejection, or a \"not like that\" arrives, that sentence is recorded here with its reason.\n\nNever invented. A single passing remark does not become a standing rule. When a later correction contradicts an earlier one, the new one replaces the old in the active section.\n`) : '');
  }

  result['Control Panel.md'] = head(['claudian', 'panel'], tr ? 'ajanda' : 'agenda', language)
    + (tr ? '# Açık konular\n\nTarihi olmayan açık döngüler. Kapananlar buradan çıkarılır.\n\n[[Claudian Home]]\n'
          : '# Open topics\n\nUndated open loops. Closed items leave this list.\n\n[[Claudian Home]]\n');

  result['Reminders.md'] = head(['claudian', 'panel'], tr ? 'ajanda' : 'agenda', language)
    + (tr ? '# Tarihli konular\n\nTarihi olan işler. Tarih uydurulmaz; bilinmiyorsa yazılmaz.\n\n[[Claudian Home]]\n'
          : '# Dated topics\n\nWork with a date. Dates are never invented; unknown stays unknown.\n\n[[Claudian Home]]\n');

  result['Claudian Record Guide.md'] = head(['claudian', tr ? 'yöntem' : 'method'], tr ? 'yöntem' : 'method', language)
    + (tr ? `# Kayıt rehberi\n\n[[Claudian Home]] · [[Claudian Universal Protocol]]\n\n## Özellikler\n\nHer not üç alan taşır: \`tags\`, \`tür\`, \`güncellenme\`. Bunlar süs değil erişim sinyalidir — notun türünden ve tazeliğinden seçilebilmesini sağlar. Bir notu düzenleyen aynı düzenlemede \`güncellenme\` alanını da tazeler.\n\n## Bir kararın izi\n\nKarar ve gerekçe aynı kayıtta durur. Değişen karar aktif bölümde değiştirilir; önceki gerekçe, tekrarını önlüyorsa bağlayıcı olmayan tarihçeye iner.\n\n## Bir iddianın izi\n\nKaynak, kaydedilme tarihi, geçerlilik ve durum iddianın yanında durur. Çıkarım ile kullanıcı beyanı ayrı şeylerdir.\n\n## Okunur hâle getirme\n\nKullanıcının kendi cümlesi \`>\` alıntı şeridinde korunur — damıtılmış özet onun yerine geçmez. Durum ve karşılaştırma tablo olur. Komut çıktısı, log ve kod kanıt olarak fence içinde durur. Her maddenin başında kalın bir tez cümlesi olur; gerisi onu açar.\n\n## Bağlantıların görevi\n\nAna harita yönlendirir; içerik tek kanonik notta yaşar. Birleştirme ve silme sırasında bağlantılar da onarılır.\n`
          : `# Record guide\n\n[[Claudian Home]] · [[Claudian Universal Protocol]]\n\n## Properties\n\nEvery note carries three fields: \`tags\`, \`type\`, \`updated\`. They are not decoration but retrieval signal - they let a note be chosen by its kind and its freshness. Whoever edits a note refreshes \`updated\` in the same edit.\n\n## A decision trail\n\nKeep the decision and its reason in one record. Replace a reversed decision in the active section; move the earlier reason into non-binding history when it prevents repeating a mistake.\n\n## A claim trail\n\nKeep source, recorded date, validity and status beside the claim. An inference and a user statement are different things.\n\n## Making it readable\n\nPreserve the user's own sentence in a \`>\` quote strip - a distilled summary does not replace it. State and comparison become a table. Command output, logs and code stay in a fence as evidence. Each item opens with a bold claim; the rest explains it.\n\n## Links with a purpose\n\nThe home map routes; content lives in one canonical note. Repair links when merging or removing.\n`);

  return result;
};

exports.ensure=async(profile,assertPath)=>{
 const created=[];
 const entries=exports.skeleton(profile.language,profile.name);
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
