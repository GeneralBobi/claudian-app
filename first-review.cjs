'use strict';
// A receipt proves that the AI returned a report for this request, not that its
// conclusions are true or that future conversations will maintain memory.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {ordinary,digest}=require('./memory-store.cjs');
const file=(dataDir,host)=>{if(!/^[a-z-]+$/.test(host))throw Error('Invalid review host');return path.join(dataDir,'reviews',host+'.json');};
async function profileFor(dataDir,vault,host){
 await ordinary(path.join(dataDir,'profile.json'));const p=JSON.parse(await fs.readFile(path.join(dataDir,'profile.json'),'utf8'));
 if(path.resolve(p.vault)!==path.resolve(vault)||!p.hosts.some(h=>h.id===host))throw Error('Review connection changed');
 return p;
}
async function save(dataDir,host,value){
 const target=file(dataDir,host);await ordinary(target);await fs.mkdir(path.dirname(target),{recursive:true});
 const tmp=target+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value),{flag:'wx'});await fs.rename(tmp,target);
}
async function load(dataDir,vault,host){
 const p=await profileFor(dataDir,vault,host),target=file(dataDir,host);await ordinary(target);
 const r=JSON.parse(await fs.readFile(target,'utf8'));
 if(r.vault!==vault||r.protocol!==p.protocolVersion)throw Error('Review belongs to an earlier configuration');
 if(!/^[a-f0-9-]{36}$/.test(r.id)||r.host!==host)throw Error('Invalid review request');
 const expected=path.join(vault,`.claudian-review-${host}-${r.id}.md`);
 if(r.input!==expected||r.output!==expected.replace(/\.md$/,'-response.json'))throw Error('Invalid review destination');
 return r;
}
function report(value,r){
 if(value.request_id!==r.id||value.value!==r.nonce||!['completed','needs_input','failed'].includes(value.status))throw Error('Review response does not match');
 if(typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>12000)throw Error('Review summary is missing or too long');
 return {status:value.status,summary:value.summary,receivedAt:new Date().toISOString()};
}
async function active(dataDir,vault,host){
 const r=await load(dataDir,vault,host);
 const age=Date.now()-Date.parse(r.issuedAt);
 if(r.result||!Number.isFinite(age)||age<0||age>24*60*60*1000)throw Error('Review expired or already completed. Start a new review.');
 await ordinary(r.input);await ordinary(r.output);
 if(digest(await fs.readFile(r.input,'utf8'))!==r.inputHash)throw Error('Review instruction changed');
 return r;
}
exports.begin=async(dataDir,p,host)=>{
 await profileFor(dataDir,p.vault,host);
 const id=crypto.randomUUID(),nonce=crypto.randomBytes(16).toString('hex');
 const input=path.join(p.vault,`.claudian-review-${host}-${id}.md`),output=input.replace(/\.md$/,'-response.json');
 const receipt=JSON.stringify({request_id:id,value:nonce,status:'completed',summary:'Your actual sources, changes and remaining gaps'});
 const web=require('./cloud-progress.cjs').webOnly(host);
 // A web host could not complete a review at all. The nonce existed only behind
 // read_first_review, that call is blocked by provider policy on at least one surface, and
 // submit_first_review requires the nonce -- so the deterministic path was structurally
 // impossible and the only thing that came back was prose, which is not a receipt. The token
 // now travels inside the instruction the user pastes. It is still single use (the response
 // file is created with wx), still expires with the request, still scoped to this device's
 // review record, and the tool call still arrives over this host's authenticated grant. What
 // it no longer does is prove, by itself, that the model ran a scan -- so submit() now also
 // requires that the grant has actually called Claudian.
 const token=web?`\n\nClaudian first review token for this request:\nrequest_id: ${id}\nvalue: ${nonce}\nCall submit_first_review with exactly these two values, your status and your actual summary. Do not alter them and do not write them into a note. If read_first_review is available you may use it instead; the values are the same.`:'';
 const prompt=require('./scan.cjs').prompt({...p,hosts:p.hosts.filter(h=>h.id===host)}).replace(web?/^[^\n]*\n/:/$^/,'')+'\n\n'+
 (web?'Use only Claudian MCP in this web conversation. Call submit_first_review to return your actual report, even when no notes changed. If tools are missing, stop and report that the connection is unavailable. Do not use local files or another AI application. Do not ask personal onboarding questions.'+token:`Return the review report to Claudian even when no notes changed. Use read_first_review and submit_first_review if available. Otherwise write the following JSON structure to ${output}:\n${receipt}\nReplace summary with your actual report. Use status completed when the review is finished (an empty vault is valid), needs_input if the review itself is blocked awaiting the user, or failed on an access/error failure. Do not claim success without doing the review. This receipt does not require inventing or changing user notes.`);
 await ordinary(input);await fs.writeFile(input,prompt,{flag:'wx'});
 const r={id,nonce,host,vault:p.vault,protocol:p.protocolVersion,input,output,inputHash:digest(prompt),issuedAt:new Date().toISOString()};
 await save(dataDir,host,r);return {host,prompt,id};
};
exports.read=async(dataDir,vault,host)=>{const r=await active(dataDir,vault,host);return {request_id:r.id,value:r.nonce,instruction:await fs.readFile(r.input,'utf8')};};
// The shared persistent memory is initialized here, once, and by the application rather than
// by the model: a completed first review is the point at which setup consent plus a real scan
// have both happened. Idempotent by construction -- an adapter note that already records an
// answer returns null and nothing is written, so a second surface cannot open a second root
// and a re-run cannot overwrite what is there. A failed or blocked review writes nothing.
async function initializeProviderMemory(vault,host,actor){
 const policy=require('./policy.cjs');
 if(!policy.ACCOUNT_MEMORY.includes(host))return {initialized:false,reason:'no account memory on this surface'};
 const {adapters}=await require('./roles.cjs').resolve(vault);
 const note=adapters[host];
 if(!note)return {initialized:false,reason:'no adapter note'};
 const store=require('./memory-store.cjs');
 const current=await store.read(vault,note);
 const next=policy.memoryAccepted(current.body);
 if(next===null)return {initialized:false,reason:'already recorded'};
 const receipt=await store.mutate(vault,{note,operation:'patch',expected_sha256:current.sha256,
  old_text:current.body,new_text:next,reason:'first-review:persistent-memory-accepted'},actor);
 return {initialized:true,note,receipt:receipt.id};
}
// Proof that this grant did Claudian work, not proof that the work was any good. A report is
// accepted only from a conversation that actually read through Claudian; a provider that
// merely echoes the token back without ever loading context cannot close a review.
const SCAN_EVIDENCE=['startup_context','read_first_review','read_note','list_notes','search_notes','noticed','begin_memory_turn'];
exports.submit=async(dataDir,vault,host,args,activity)=>{
 if((await profileFor(dataDir,vault,host)).access!=='write')throw Error('This connection has read-only access.');
 const r=await active(dataDir,vault,host);
 // A web submission is recorded on the request itself, and active() only knows about the
 // parsed result, so a retry used to get past it and fail on the response file with a raw
 // EEXIST. Retry safety means the second attempt is told what happened, not handed errno.
 if(r.mcpSubmitted)throw Error('Review expired or already completed. Start a new review.');
 report(args,r);
 if(require('./cloud-progress.cjs').webOnly(host)){
  const seen=typeof activity==='function'?(activity()||{}):null;
  // No evidence channel at all (a local transport) is not the same as an empty one.
  if(seen&&!SCAN_EVIDENCE.some(name=>seen[name])){
   r.rejected={at:new Date().toISOString(),reason:'no-scan-evidence'};await save(dataDir,host,r);
   throw Error('This conversation has not read anything through Claudian. Run the review first, then submit its result.');
  }
 }
 await fs.writeFile(r.output,JSON.stringify(args),{flag:'wx'});
 if(require('./cloud-progress.cjs').webOnly(host)){r.mcpSubmitted=true;await save(dataDir,host,r);}
 // The receipt is the primary outcome and is already durable. Initialization is reported,
 // never allowed to fail the submission that proved the review happened.
 let memory={initialized:false,reason:'not attempted'};
 if(args.status==='completed'){try{memory=await initializeProviderMemory(vault,host,'first-review');}
  catch(error){memory={initialized:false,error:error.message};}}
 return {submitted:true,persistentMemory:memory};
};
exports.initializeProviderMemory=initializeProviderMemory;
exports.status=async(dataDir,vault,host)=>{
 let r;try{r=await load(dataDir,vault,host);}catch(e){if(e.code==='ENOENT')return {status:'not_started'};if(/earlier configuration/.test(e.message))return {status:'stale'};throw e;}
 // An installation that completed its review before this existed would never be asked again and
 // never recorded either, so it would keep offering consent forever. Idempotent, so a profile
 // that already answered -- yes or no -- is untouched, and a read-only connection writes nothing.
 if(r.result?.status==='completed'){try{await initializeProviderMemory(vault,host,'first-review');}catch{}}
 if(r.result)return r.result;
 // A rejected report is an outcome, not silence. Without this the screen kept saying
 // "waiting for the AI report" for a full day after Claudian had already refused one.
 if(r.rejected)return {status:'invalid',message:'A report was returned without evidence of a real review. Start the review again.',receivedAt:r.rejected.at};
 if(require('./cloud-progress.cjs').webOnly(host)&&!r.mcpSubmitted)return {status:Date.now()-Date.parse(r.issuedAt)>24*60*60*1000?'expired':'waiting',issuedAt:r.issuedAt};
 if(Date.now()-Date.parse(r.issuedAt)>24*60*60*1000)return {status:'expired'};
 try{
  await active(dataDir,vault,host);
  const stat=await fs.stat(r.output);if(stat.size>64000)throw Error('Review response too large');
  const value=JSON.parse(await fs.readFile(r.output,'utf8'));
  r.result=report(value,r);await save(dataDir,host,r);
  // A review returned through the response file rather than submit() lands here. Same rule.
  if(r.result.status==='completed'){try{await initializeProviderMemory(vault,host,'first-review');}catch{}}
  return r.result;
 }catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return {status:'waiting',issuedAt:r.issuedAt};return {status:'invalid',message:e.message};}
};
// The UI and MCP server run in separate processes. Serialize receipt acceptance
// with replacing a request so an old report cannot overwrite the new request.
for(const name of ['begin','read','submit','status']){
 const operation=exports[name];
 exports[name]=(dataDir,profileOrVault,host,...args)=>require('./memory-runtime.cjs').exclusive(dataDir,'first-review-'+host,()=>operation(dataDir,profileOrVault,host,...args));
}
