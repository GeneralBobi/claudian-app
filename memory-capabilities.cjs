'use strict';
const path = require('node:path');
const store = require('./memory-store.cjs');
const runtime = require('./memory-runtime.cjs');
const string = {type:'string'};
const schema = (properties, required=[]) => ({type:'object',properties,required,additionalProperties:false});
const text = value => ({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]});

function capabilities(vault, notice, options={}) {
  const actor=options.actor||'unknown';
  const dataDir=options.dataDir||path.join(vault,'.claudian','runtime');
  const tool=(name,scope,description,inputSchema,run,metadata=false)=>({name,scope,description,inputSchema,
    annotations:{readOnlyHint:scope==='read'&&!metadata,destructiveHint:false,openWorldHint:false},
    run:async args=>text(await run(args))});
  const edit=(name,operation,description,properties,required)=>tool(name,'write',description,
    schema({note:string,reason:string,...properties},['note','reason',...required]),
    args=>store.mutate(vault,{...args,operation},actor));
  return [
    tool('startup_context','read','Load shared memory and its protocol at conversation start, including greetings.',schema({topic:string}),
      ({topic})=>runtime.context(vault,topic,options.access||'read',options.language||'en')),
    tool('begin_memory_turn','read','For hosts WITHOUT a prompt hook: begin each user turn, reusing one session_id throughout this conversation. Hook-managed hosts must use the supplied turn.',schema({session_id:string}),
      ({session_id})=>{const session=session_id||require('node:crypto').randomUUID();return runtime.exclusive(dataDir,session,()=>runtime.begin(dataDir,session,actor));},true),
    tool('memory_review','read','Record completed maintenance for the current turn. UPDATED needs committed receipt IDs; NO_OP means nothing durable changed. This records operational metadata, not a user note.',
      schema({session_id:string,turn:{type:'integer',minimum:1},outcome:{type:'string',enum:['NO_OP','UPDATED','FAILED']},receipts:{type:'array',items:string}},['session_id','turn','outcome']),
      async args=>({...await runtime.review(dataDir,args,actor,vault),
        responseGuidance:args.outcome==='FAILED'
          ? 'Briefly tell the user that valuable memory maintenance failed, then answer their request.'
          : options.language==='tr'
            ? 'Hafıza işlemi tamamlandı. Bu araç sonucunu kullanıcıya özetleme. Yanıtın konusu kullanıcının işi veya sorusu olsun; notların ya da kaydın durumu olmasın. Kullanıcı açıkça kayıt durumunu sormadıysa kaydettim, güncellendi, not aldım veya benzeri başarı bildirimi yazma. Örnek: kullanıcı proje tarihini değiştirdiyse yeni tarihin işe etkisini yanıtla; kullanıcı tercih belirttiyse o tercihe uygun cevap ver.'
            : 'Maintenance complete. Do not summarize this tool result to the user. Answer the substance of their request, not the state of their notes. Unless explicitly asked about memory status, do not say saved, updated, noted or similar bookkeeping confirmations. Apply the preference or discuss the changed project decision directly.'}),true),
    tool('read_note','read','Read a complete note with its current SHA-256, required before any edit.',schema({note:string},['note']),({note})=>store.read(vault,note)),
    tool('list_notes','read','List notes recursively, excluding hidden, archived and linked paths.',schema({}),()=>store.list(vault)),
    tool('search_notes','read','Search note names and contents recursively; return matching file names and lines.',schema({query:string,limit:{type:'integer',minimum:1,maximum:100}},['query']),
      async({query,limit})=>(await store.search(vault,query,limit)).map(h=>`${h.note}:${h.line}  ${h.text}`).join('\n')||'No matches.'),
    tool('noticed','read','Read cross-note observations with their reasoning and supporting evidence.',schema({}),async()=>{
      const seen=await notice();
      if(seen.missing)return 'Not klasörü bulunamadı.';
      return seen.candidates.map(c=>`${c.title}\n  neden: ${c.why}\n  kanıt: ${c.evidence.join(' | ')}\n  üretici: ${c.producer}`).join('\n\n')||'Şu an fark edilen bir şey yok.';
    }),
    edit('write_note','create','Create a NEW note after searching for duplicates. Existing notes cannot be overwritten.',{body:string},['body']),
    edit('patch_note','patch','Replace one exact passage using the SHA-256 from read_note. Saves a backup and verified receipt.',{expected_sha256:string,old_text:string,new_text:string},['expected_sha256','old_text','new_text']),
    edit('append_note','append','Append to an existing note using its current SHA-256. Saves a backup and verified receipt.',{expected_sha256:string,body:string},['expected_sha256','body']),
    edit('archive_note','archive','Reversibly archive an obsolete note using its current SHA-256. Never use for permanent deletion.',{expected_sha256:string},['expected_sha256']),
  ];
}
module.exports={capabilities};
