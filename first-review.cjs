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
 const prompt=require('./scan.cjs').prompt({...p,hosts:p.hosts.filter(h=>h.id===host)}).replace(web?/^[^\n]*\n/:/$^/,'')+'\n\n'+
 (web?'Use only Claudian MCP in this web conversation. Call read_first_review and submit_first_review to return your actual report, even when no notes changed. If tools are missing, stop and report that the connection is unavailable. Do not use local files or another AI application. Do not ask personal onboarding questions.':`Return the review report to Claudian even when no notes changed. Use read_first_review and submit_first_review if available. Otherwise write the following JSON structure to ${output}:\n${receipt}\nReplace summary with your actual report. Use status completed when the review is finished (an empty vault is valid), needs_input if the review itself is blocked awaiting the user, or failed on an access/error failure. Do not claim success without doing the review. This receipt does not require inventing or changing user notes.`);
 await ordinary(input);await fs.writeFile(input,prompt,{flag:'wx'});
 const r={id,nonce,host,vault:p.vault,protocol:p.protocolVersion,input,output,inputHash:digest(prompt),issuedAt:new Date().toISOString()};
 await save(dataDir,host,r);return {host,prompt,id};
};
exports.read=async(dataDir,vault,host)=>{const r=await active(dataDir,vault,host);return {request_id:r.id,value:r.nonce,instruction:await fs.readFile(r.input,'utf8')};};
exports.submit=async(dataDir,vault,host,args)=>{if((await profileFor(dataDir,vault,host)).access!=='write')throw Error('This connection has read-only access.');const r=await active(dataDir,vault,host);report(args,r);await fs.writeFile(r.output,JSON.stringify(args),{flag:'wx'});if(require('./cloud-progress.cjs').webOnly(host)){r.mcpSubmitted=true;await save(dataDir,host,r);}return {submitted:true};};
exports.status=async(dataDir,vault,host)=>{
 let r;try{r=await load(dataDir,vault,host);}catch(e){if(e.code==='ENOENT')return {status:'not_started'};if(/earlier configuration/.test(e.message))return {status:'stale'};throw e;}
 if(r.result)return r.result;
 if(require('./cloud-progress.cjs').webOnly(host)&&!r.mcpSubmitted)return {status:Date.now()-Date.parse(r.issuedAt)>24*60*60*1000?'expired':'waiting',issuedAt:r.issuedAt};
 if(Date.now()-Date.parse(r.issuedAt)>24*60*60*1000)return {status:'expired'};
 try{
  await active(dataDir,vault,host);
  const stat=await fs.stat(r.output);if(stat.size>64000)throw Error('Review response too large');
  const value=JSON.parse(await fs.readFile(r.output,'utf8'));
  r.result=report(value,r);await save(dataDir,host,r);return r.result;
 }catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return {status:'waiting',issuedAt:r.issuedAt};return {status:'invalid',message:e.message};}
};
// The UI and MCP server run in separate processes. Serialize receipt acceptance
// with replacing a request so an old report cannot overwrite the new request.
for(const name of ['begin','read','submit','status']){
 const operation=exports[name];
 exports[name]=(dataDir,profileOrVault,host,...args)=>require('./memory-runtime.cjs').exclusive(dataDir,'first-review-'+host,()=>operation(dataDir,profileOrVault,host,...args));
}
