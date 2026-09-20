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

// --- 0.19.2: the web handshake --------------------------------------------------------------
// A web host could not finish a first review at all. The nonce lived only behind
// read_first_review, Spark's policy blocked that call, and submit_first_review needs the
// nonce -- so the deterministic path was structurally impossible. What came back was a
// free-form Markdown report that read like success while the desktop waited a full day.
async function webFixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-web-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const vault=path.join(root,'notes'),dataDir=path.join(root,'data');await fs.mkdir(vault);await fs.mkdir(dataDir);
 const p={vault,access:'write',protocolVersion:'2.9.0',language:'en',hosts:[{id:'gemini'}]};
 await fs.writeFile(path.join(dataDir,'profile.json'),JSON.stringify(p));return {p,vault,dataDir};
}
const scanned=()=>({startup_context:'2026-09-20T10:00:00.000Z'});

test('a web review can be completed without the call its provider blocks',async t=>{
 const {p,vault,dataDir}=await webFixture(t);
 const begun=await review.begin(dataDir,p,'gemini');
 // The token travels inside the instruction the user pastes, so submit_first_review is
 // reachable on its own.
 assert.match(begun.prompt,/Claudian first review token/);
 assert.match(begun.prompt,/request_id: [0-9a-f-]{36}/);
 const id=/request_id: ([0-9a-f-]{36})/.exec(begun.prompt)[1];
 const value=/value: ([0-9a-f]{32})/.exec(begun.prompt)[1];
 assert.equal(id,begun.id);
 assert.equal((await review.status(dataDir,vault,'gemini')).status,'waiting');
 await review.submit(dataDir,vault,'gemini',{request_id:id,value,status:'completed',summary:'Read the entry map. Nothing durable to record.'},scanned);
 const done=await review.status(dataDir,vault,'gemini');
 assert.equal(done.status,'completed');
 assert.equal(done.summary,'Read the entry map. Nothing durable to record.');
});

test('a token echoed back without any Claudian reading behind it does not close a review',async t=>{
 const {p,vault,dataDir}=await webFixture(t);
 const begun=await review.begin(dataDir,p,'gemini');
 const value=/value: ([0-9a-f]{32})/.exec(begun.prompt)[1];
 // The grant exists and the conversation can talk, but it never read anything through
 // Claudian. A report from there is an assertion, not a review.
 await assert.rejects(review.submit(dataDir,vault,'gemini',
  {request_id:begun.id,value,status:'completed',summary:'I reviewed everything.'},()=>({})),
  /has not read anything through Claudian/);
 // And the screen says so, rather than waiting twenty-four hours for a report already refused.
 const after=await review.status(dataDir,vault,'gemini');
 assert.equal(after.status,'invalid');
 assert.match(after.message,/without evidence of a real review/);
});

test('the token is single use and still bound to its own request',async t=>{
 const {p,vault,dataDir}=await webFixture(t);
 const first=await review.begin(dataDir,p,'gemini');
 const firstValue=/value: ([0-9a-f]{32})/.exec(first.prompt)[1];
 await review.submit(dataDir,vault,'gemini',{request_id:first.id,value:firstValue,status:'completed',summary:'First pass.'},scanned);
 await assert.rejects(review.submit(dataDir,vault,'gemini',{request_id:first.id,value:firstValue,status:'completed',summary:'Again.'},scanned),/already completed/);
 // A token from a previous request cannot close the next one.
 await review.begin(dataDir,p,'gemini');
 await assert.rejects(review.submit(dataDir,vault,'gemini',{request_id:first.id,value:firstValue,status:'completed',summary:'Stale.'},scanned),/does not match/);
});

test('a read-only web connection cannot submit a review at all',async t=>{
 const {p,vault,dataDir}=await webFixture(t);
 const begun=await review.begin(dataDir,p,'gemini');
 const value=/value: ([0-9a-f]{32})/.exec(begun.prompt)[1];
 await fs.writeFile(path.join(dataDir,'profile.json'),JSON.stringify({...p,access:'read'}));
 await assert.rejects(review.submit(dataDir,vault,'gemini',{request_id:begun.id,value,status:'completed',summary:'x'},scanned),/read-only/);
});

test('a local host keeps the old contract: no token in the prompt, no evidence channel',async t=>{
 const {p,vault,dataDir}=await fixture(t);
 const begun=await review.begin(dataDir,p,'codex');
 assert.doesNotMatch(begun.prompt,/Claudian first review token/,'a local host reads the request through the tool');
 const r=await review.read(dataDir,vault,'codex');
 await review.submit(dataDir,vault,'codex',{request_id:r.request_id,value:r.value,status:'completed',summary:'Local pass.'});
 assert.equal((await review.status(dataDir,vault,'codex')).status,'completed');
});

// --- 0.20.0: the reason a web review never came back ----------------------------------------
// Measured on a real profile. A Spark review was issued at 09:50 under protocol 2.8.0 and read
// successfully at 09:56. That afternoon the 0.19.1 upgrade rewrote the vault protocol to
// 2.9.0, which invalidated the in-flight request. Every later call failed the configuration
// check, and because only successful calls were recorded, the device had no trace of the
// attempts: the screen said "waiting for the AI report" for the rest of the day, and the model
// received a bare configuration error after doing the whole scan.
test('an application update that moves the protocol supersedes an in-flight review, and says so',async t=>{
 const {p,vault,dataDir}=await webFixture(t);
 await review.begin(dataDir,p,'gemini');
 assert.equal((await review.status(dataDir,vault,'gemini')).status,'waiting');

 // The upgrade rewrites the protocol note and the profile alongside it.
 await fs.writeFile(path.join(dataDir,'profile.json'),JSON.stringify({...p,protocolVersion:'3.0.0'}));

 const after=await review.status(dataDir,vault,'gemini');
 assert.equal(after.status,'superseded','not "stale", and certainly not "waiting"');
 assert.equal(after.from,'2.9.0');
 assert.equal(after.to,'3.0.0');

 // And the model is told what happened instead of being handed a bare configuration error.
 await assert.rejects(review.read(dataDir,vault,'gemini'),err=>{
  assert.match(err.message,/superseded by a Claudian update/);
  assert.match(err.message,/2\.9\.0/);
  assert.match(err.message,/3\.0\.0/);
  assert.match(err.message,/Nothing you did was wrong/);
  return true;
 });
 await assert.rejects(review.submit(dataDir,vault,'gemini',
  {request_id:'x',value:'y',status:'completed',summary:'z'},()=>({startup_context:'now'})),
  /superseded by a Claudian update/);
});

test('a moved notes folder is a different failure with a different sentence',async t=>{
 const {p,vault,dataDir}=await webFixture(t);
 await review.begin(dataDir,p,'gemini');
 const moved=vault+'-elsewhere';
 await fs.mkdir(moved,{recursive:true});
 await fs.writeFile(path.join(dataDir,'profile.json'),JSON.stringify({...p,vault:moved}));
 const after=await review.status(dataDir,moved,'gemini');
 assert.equal(after.status,'stale');
 await assert.rejects(review.read(dataDir,moved,'gemini'),/different notes folder/);
});

test('a review issued under the current protocol is untouched by the distinction',async t=>{
 const {p,vault,dataDir}=await webFixture(t);
 const begun=await review.begin(dataDir,p,'gemini');
 const value=/value: ([0-9a-f]{32})/.exec(begun.prompt)[1];
 await review.submit(dataDir,vault,'gemini',
  {request_id:begun.id,value,status:'completed',summary:'Read the entry map.'},()=>({startup_context:'now'}));
 assert.equal((await review.status(dataDir,vault,'gemini')).status,'completed');
});
