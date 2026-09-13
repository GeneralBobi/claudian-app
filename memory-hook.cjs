'use strict';
// Host lifecycle hook. It stores IDs and maintenance receipts, never the transcript.
const fs=require('node:fs/promises');
const runtime=require('./memory-runtime.cjs');
async function runUnlocked(event, dataDir, profile, host='claude-code') {
  if(!event.session_id||!profile?.vault)return {};
  const hook=event.hook_event_name;
  if(hook==='UserPromptSubmit') {
    const state=await runtime.begin(dataDir,event.session_id,host);
    if(profile.language==='tr')return {hookSpecificOutput:{hookEventName:hook,additionalContext:
      `[Claudian hafıza turu ${state.turn}] Oturum: ${state.session}. Seçili vault: ${profile.vault}. Kapsam: ${profile.access||'read'}.
${state.turn===1?'Cevap vermeden önce startup_context çağır.':'Aynı ortak hafıza protokolünü sürdür; konu veya karar değiştiyse ilgili notları yeniden kontrol et.'}
Kullanıcıya görünür herhangi bir metin üretmeden ÖNCE gerekli hafıza bakımını sessizce tamamla. Arama, okuma veya kayıt hazırlığını duyurma. Ardından memory_review çağır: session_id=${JSON.stringify(state.session)}, turn=${state.turn}, outcome=NO_OP/UPDATED/FAILED; UPDATED için gerçek işlem kimliklerini ekle. Kalıcı bilgi değişmediyse NO_OP doğrudur. Dolgu veya yinelenen not yazma. Başarılı hafıza işlemleri için "arayacağım", "notlara bakıyorum", "kaydediyorum" veya "kaydedildi" deme. Kayda değer kayıt başarısız olduysa tek kısa cümleyle bildir. Kontrolden sonra kullanıcıya yalnız bir cevap ver; "Başka?" veya uydurma takip mesajı ekleme.`}};
    return {hookSpecificOutput:{hookEventName:hook,additionalContext:
      `[Claudian memory turn ${state.turn}] Session: ${state.session}. Selected vault: ${profile.vault}. Scope: ${profile.access||'read'}.
${state.turn===1?'Call startup_context before answering.':'Continue the SAME shared-memory protocol; recheck relevant notes when the subject or a decision changes.'}
Before writing ANY user-visible response text, silently complete necessary memory maintenance, then call memory_review with session_id=${JSON.stringify(state.session)}, turn=${state.turn}, outcome=NO_OP/UPDATED/FAILED and receipt IDs for updates. NO_OP is correct when nothing durable changed. Never write filler or duplicate facts. Report an actual failed valuable save in one short sentence; do not announce success. Never say "kaydediyorum", "kaydedildi", "saved" or "I read your notes". After memory_review, answer the user once; do not append "Başka?" or invented follow-up messages.`}};
  }
  if(hook==='Stop') {
    const state=await runtime.load(dataDir,event.session_id);
    if(!state.turn||runtime.isReviewed(state))return {};
    if(host==='codex'){
      // Codex Stop continuations create a new user prompt. Observe failure rather than
      // recursively starting new memory turns from our own reminder.
      state.outcome='UNREVIEWED';state.failedAt=new Date().toISOString();await runtime.save(dataDir,state);
      return {systemMessage:'Claudian: memory maintenance was not verified for this turn. Check the connection and hook trust in /hooks.'};
    }
    if(state.blockedTurn===state.turn) {
      state.outcome='UNREVIEWED';state.failedAt=new Date().toISOString();await runtime.save(dataDir,state);
      return {systemMessage:'Claudian: this response ended without a memory review. Automatic maintenance is not verified for this turn.'};
    }
    state.blockedTurn=state.turn;await runtime.save(dataDir,state);
    return {decision:'block',reason:`Claudian memory review missing for session ${state.session}, turn ${state.turn}. Complete maintenance and call memory_review now. Save only durable information; NO_OP is valid. Your visible answer has already been delivered: use tools only, do not repeat the answer, invent a user message, or ask for another task. If memory tools are unavailable, briefly report the failure. Do not loop or fabricate a write.`};
  }
  if(hook==='PostToolUse' && !String(event.tool_name||'').startsWith('mcp__claudian__')) {
    const state=await runtime.load(dataDir,event.session_id);
    if(!state.turn)return {};
    state.toolCount=(state.toolCount||0)+1;
    if(state.toolCount%12===0)state.checkpoint=(state.checkpoint||0)+1;
    await runtime.save(dataDir,state);
    if(state.toolCount%12===0)return {hookSpecificOutput:{hookEventName:hook,additionalContext:`Claudian checkpoint: this task is continuing. Maintain any durable decisions, corrections or verified lessons that have emerged since the last review now; do not wait for task completion. Session ${state.session}, turn ${state.turn}. No filler notes.`}};
  }
  return {};
}
async function run(event,dataDir,profile,host='claude-code'){
 if(!event.session_id||!profile?.vault)return {};
 return runtime.exclusive(dataDir,event.session_id,()=>runUnlocked(event,dataDir,profile,host));
}
if(require.main===module){
  let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);
  process.stdin.on('end',async()=>{try{
    if(!input.trim()){process.stdout.write('{}');return;}
    input=input.replace(/^\uFEFF/,'');
    const dir=process.argv[2];const profile=JSON.parse(await fs.readFile(require('node:path').join(dir,'profile.json'),'utf8'));
    process.stdout.write(JSON.stringify(await run(JSON.parse(input),dir,profile,process.argv[3]||'claude-code')));
  }catch(e){process.stderr.write('Claudian maintenance hook failed: '+e.message+'\n');process.exitCode=1;}});
}
module.exports={run};
