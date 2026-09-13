'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const review=require('../first-review.cjs');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const vault=path.join(root,'Boran Birtanır notes'),dataDir=path.join(root,'data');await fs.mkdir(vault);await fs.mkdir(dataDir);
 const p={vault,access:'write',protocolVersion:'2.8.0',language:'tr',hosts:[{id:'codex'}]};
 await fs.writeFile(path.join(dataDir,'profile.json'),JSON.stringify(p));return {p,vault,dataDir};
}
test('review report survives reload and preserves an empty-vault NO_OP summary',async t=>{
 const {p,vault,dataDir}=await fixture(t);await review.begin(dataDir,p,'codex');
 const r=await review.read(dataDir,vault,'codex');
 assert.doesNotMatch(r.instruction,/Türkçe yanıt ver|Respond in English/);
 await review.submit(dataDir,vault,'codex',{request_id:r.request_id,value:r.value,status:'completed',summary:'Read the entry notes. No durable facts; no notes changed.'});
 const a=await review.status(dataDir,vault,'codex');assert.equal(a.status,'completed');assert.ok(a.receivedAt);
 assert.deepEqual(await review.status(dataDir,vault,'codex'),a);
 await assert.rejects(review.submit(dataDir,vault,'codex',r),/already completed/);
});
test('review rejects another host, stale request and tampered instructions',async t=>{
 const {p,vault,dataDir}=await fixture(t);await review.begin(dataDir,p,'codex');const old=await review.read(dataDir,vault,'codex');
 await assert.rejects(review.read(dataDir,vault,'claude-code'),/connection changed/);
 await review.begin(dataDir,p,'codex');await assert.rejects(review.submit(dataDir,vault,'codex',{...old,status:'completed',summary:'wrong request'}),/does not match/);
 const r=JSON.parse(await fs.readFile(path.join(dataDir,'reviews','codex.json')));await fs.appendFile(r.input,'tampered');
 await assert.rejects(review.read(dataDir,vault,'codex'),/instruction changed/);
});
test('partial file waits and blocked report stays blocked',async t=>{
 const {p,vault,dataDir}=await fixture(t);await review.begin(dataDir,p,'codex');
 const r=JSON.parse(await fs.readFile(path.join(dataDir,'reviews','codex.json')));await fs.writeFile(r.output,'{');
 assert.equal((await review.status(dataDir,vault,'codex')).status,'waiting');
 await fs.writeFile(r.output,JSON.stringify({request_id:r.id,value:r.nonce,status:'needs_input',summary:'Folder permission is needed.'}));
 assert.equal((await review.status(dataDir,vault,'codex')).status,'needs_input');
});
