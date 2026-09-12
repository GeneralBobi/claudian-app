'use strict';
// Evaluate recorded synthetic Atlas sessions. Never exports model thinking or transcripts.
const fs=require('node:fs/promises'),path=require('node:path');
const store=require('../memory-store.cjs');
async function evaluate(root){
 const saved=JSON.parse(await fs.readFile(path.join(root,'summary.json'),'utf8'));
 const checks=[],turns=[];
 const check=(name,passed)=>checks.push({name,passed:!!passed});
 for(const row of saved.summary){
  const events=(await fs.readFile(path.join(root,`turn-${row.turn}.jsonl`),'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const calls=new Map();let reviewed=false,visibleBeforeReview=false;const receipts=[];
  for(const event of events){
   for(const block of Array.isArray(event.message?.content)?event.message.content:[]){
    if(block.type==='tool_use')calls.set(block.id,block.name);
    if(block.type==='text'&&event.type==='assistant'&&block.text?.trim()&&!reviewed)visibleBeforeReview=true;
    if(block.type!=='tool_result')continue;
    const content=typeof block.content==='string'?block.content:(block.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    let result;try{result=JSON.parse(content);}catch{continue;}
    if(calls.get(block.tool_use_id)==='mcp__claudian__memory_review'&&result.recorded===true&&result.turn===row.turn)reviewed=true;
    if(result.status==='committed'&&result.id)receipts.push(result);
   }
  }
  turns.push({turn:row.turn,reviewed,visibleBeforeReview,receipts:receipts.map(r=>({id:r.id,note:r.note,operation:r.operation})),exit:row.exit});
 }
 check('20 turns completed',turns.length===20&&turns.every(t=>t.exit===0));
 check('Every turn has a successful review response',turns.every(t=>t.reviewed));
 check('Memory maintenance precedes visible response text',turns.every(t=>!t.visibleBeforeReview));
 check('No success bookkeeping announcements',saved.summary.every(t=>!t.said.some(s=>/kaydet(?:tim|ti[mn]iz)|kaydedildi|güncellendi|let me search|I (?:saved|updated|read your notes)/i.test(s))));
 for(const turn of [2,3,5,13,17])check(`Durable information saved in turn ${turn}`,turns.find(t=>t.turn===turn)?.receipts.length>0);
 for(const turn of [4,6,7,8,9,10,11,12,14,15,16,19,20])check(`No filler write in turn ${turn}`,turns.find(t=>t.turn===turn)?.receipts.length===0);
 const read=async name=>{try{return (await store.read(path.join(root,'vault'),name)).body;}catch{return '';}};
 const atlas=await read('Atlas'),reminders=await read('Reminders'),index=await read('Claudian Projects');
 check('Project linked from index',index.includes('[[Atlas]]'));
 check('Both languages preserved',/Türkçe/.test(atlas)&&/İngilizce/.test(atlas));
 check('Accountless decision preserved',/hesapsız/i.test(atlas));
 check('Rejection and reason preserved',/posta/i.test(atlas)&&/oyala/i.test(atlas));
 check('Cancellation explicit',/iptal/i.test(atlas)&&/belirsiz|(?:yeni )?tarih yok/i.test(atlas));
 check('Cancelled deadline removed from reminders',!/Atlas/.test(reminders));
 const ordinary=await store.list(path.join(root,'vault'));
 const contents=await Promise.all(ordinary.filter(n=>!/^Claudian (Universal Protocol|Record Guide)/.test(n.note)).map(n=>read(n.note)));
 check('Hypothetical city not retained',!contents.some(body=>/İzmir|Izmir/.test(body)));
 const latest=new Map();
 for(const t of turns)for(const r of t.receipts)latest.set(r.note,r.id);
 const history=await store.history(path.join(root,'vault'),100);
 for(const [note,id]of latest){const receipt=history.find(r=>r.id===id);check(`Final file matches receipt: ${note}`,receipt?.afterSha256===(await store.read(path.join(root,'vault'),note)).sha256);}
 return {scenario:'atlas-20-turn-tr',host:'claude-code',method:'Controlled CLI session with explicit generated settings, skill and MCP configuration; not native app auto-discovery acceptance',session:saved.session,passed:checks.every(c=>c.passed),checks,turns,totalCostUsd:saved.summary.reduce((sum,t)=>sum+(t.cost||0),0)};
}
module.exports={evaluate};
if(require.main===module)evaluate(path.resolve(process.argv[2])).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(e=>{console.error(e.message);process.exitCode=1;});
