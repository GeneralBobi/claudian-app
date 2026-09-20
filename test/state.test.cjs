'use strict';
// The panel's own knowledge. Every assertion here is about a fact the application derives
// from this machine, because the defect being fixed is that it could not: "Spark verification
// is still pending" needed an AI to have been opened and to have written it down.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const state=require('../state.cjs');

const profile=(over={})=>({vault:'V',access:'write',storage:'markdown',protocolVersion:'2.9.0',
  hosts:[{id:'codex'},{id:'gemini'}],...over});
const ready=(over={})=>({
  profile:profile(),
  health:{hosts:[{id:'codex',label:'Codex',state:'verified',verifiedAt:'2026-09-20T00:00:00.000Z'},
                 {id:'gemini',label:'Spark',state:'verified',verifiedAt:'2026-09-20T00:00:00.000Z'}],verifiedCount:2},
  connections:[{id:'codex',status:'ready',access:{state:'granted'}},{id:'gemini',status:'ready',access:{state:'granted'}}],
  connector:{state:'online',enabled:true},
  reviews:{codex:{status:'completed'},gemini:{status:'completed'}},
  ...over});

async function vault(t,notes={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-state-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const [name,body] of Object.entries(notes)) await fs.writeFile(path.join(root,name),body,'utf8');
  return root;
}

test('a finished installation asks for nothing',async()=>{
  const s=await state.derive(ready());
  assert.equal(s.setup,'READY');
  assert.deepEqual(s.attention,[],'nothing is waiting, and the panel says so by being empty');
  assert.equal(s.verificationSkipped,false);
  assert.ok(s.updatedAt,'the panel always states when it was derived');
});

test('a skipped check is quiet and still says it was skipped',async()=>{
  // "Nothing is waiting" and "nothing has been proven" are different sentences, and the panel
  // used to print the first while every connection underneath read "access not verified".
  const s=await state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'},{id:'gemini',label:'Spark',state:'unverified'}],
            verifiedCount:0,skippedAt:'2026-09-20T00:00:00.000Z'},
    reviews:{}}));
  assert.equal(s.setup,'READY','a deliberate skip is honoured, not nagged');
  assert.deepEqual(s.attention,[],'and it does not manufacture attention either');
  assert.equal(s.verificationSkipped,true,'but the panel can say why it is quiet');
});

test('a pending verification is derived, not reported by an AI',async()=>{
  const s=await state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'},{id:'gemini',label:'Spark',state:'unverified'}],verifiedCount:0},
    reviews:{}}));
  assert.equal(s.setup,'VERIFY_PENDING');
  const kinds=s.attention.map(a=>a.kind);
  assert.ok(kinds.includes('setup_incomplete'));
  assert.deepEqual(s.attention.filter(a=>a.kind==='verification_pending').map(a=>a.host),['codex','gemini']);
  // Named, not counted: the panel has to be able to open the thing it is talking about.
  assert.equal(s.attention.find(a=>a.kind==='verification_pending').label,'Codex');
});

test('a review that was refused or superseded is attention, with its reason',async()=>{
  const s=await state.derive(ready({reviews:{
    codex:{status:'completed'},
    gemini:{status:'superseded',from:'2.8.0',to:'2.9.0'}}}));
  const item=s.attention.find(a=>a.kind==='first_review_superseded');
  assert.ok(item,'a superseded review is not silence');
  assert.equal(item.host,'gemini');
  assert.equal(item.detail,'2.8.0 → 2.9.0','both versions travel with it');
});

test('a cloud connection nobody has set up yet is unfinished, not broken',async()=>{
  // Reading "access unavailable" on a remote host as a failure made a fresh install accuse
  // itself of a fault the user had simply not got to yet.
  const s=await state.derive(ready({
    connections:[{id:'codex',status:'ready',access:{state:'granted'}},
                 {id:'gemini',status:'attention',access:{state:'unavailable'}}],
    health:{hosts:[{id:'codex',label:'Codex',state:'verified'}],verifiedCount:1}}));
  assert.equal(s.setup,'READY');
  assert.equal(s.attention.some(a=>a.kind==='setup_incomplete'),false);
  // A local connection in the same state is a real fault.
  const broken=await state.derive(ready({
    connections:[{id:'codex',status:'attention',access:{state:'unavailable'}}],
    health:{hosts:[],verifiedCount:0}}));
  assert.equal(broken.setup,'CONNECTION_FAILED');
});

test('open loops come from the active part of the panel note only',async t=>{
  const root=await vault(t,{'Kontrol Paneli.md':`---
claudian_role: panel
---
# Panel

- [ ] **Bir açık iş** uzun açıklama burada
- [x] tamamlanmış

## Kapanan

> **⚠ Arşiv — yürürlükte değil (31.08.2026)**
> Bu bölüm tarihsel kayıttır.

- [ ] arşivdeki kutu
`});
  const s=await state.derive(ready({profile:profile({vault:root}),language:'tr'}));
  // An unchecked box inside an archived section is not a task. That rule is the protocol's,
  // and the panel has to obey it without a model in the loop.
  assert.deepEqual(s.openLoops,['Bir açık iş']);
});

test('only changes are recorded, and a repeated level is not news',async t=>{
  const dir=await vault(t);
  const first=await state.persist(dir,await state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'}],verifiedCount:0},reviews:{}})));
  assert.deepEqual(first.events,[],'the first level has nothing to be different from');

  const same=await state.persist(dir,await state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'}],verifiedCount:0},reviews:{}})));
  assert.deepEqual(same.events,[],'the same picture twice is not an event');

  const verified=await state.persist(dir,await state.derive(ready()));
  const kinds=verified.events.map(e=>e.kind);
  assert.ok(kinds.includes('verification_completed'));
  assert.ok(kinds.includes('setup_changed'));
  assert.ok(kinds.includes('first_review_completed'));

  const recent=await state.recent(dir);
  assert.ok(recent.length>=3);
  assert.ok(recent.every(e=>e.at),'every transition carries when it happened');
});

test('a connection that drops and comes back is two transitions, in order',async t=>{
  const dir=await vault(t);
  await state.persist(dir,await state.derive(ready()));
  const down=await state.persist(dir,await state.derive(ready({connector:{state:'offline',enabled:true,lastError:'relay timeout'}})));
  assert.equal(down.events.find(e=>e.kind==='connection_changed')?.detail,'relay timeout');
  const up=await state.persist(dir,await state.derive(ready()));
  assert.ok(up.events.some(e=>e.kind==='connection_restored'));
});

test('no profile is a state, not a crash',async()=>{
  const s=await state.derive({profile:null});
  assert.equal(s.setup,'AI_NOT_SELECTED');
  assert.deepEqual(s.connections,[]);
});
