'use strict';
// The panel's own knowledge. Every assertion here is about a fact the application derives
// from this machine, because the defect being fixed is that it could not: "Spark verification
// is still pending" needed an AI to have been opened and to have written it down.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const state=require('../state.cjs');

test('long open-loop titles remain readable in full after disclosure',()=>{
  const title='Ayrıntılarıyla takip edilecek uzun bir iş. '.repeat(8)+'Son adım kaybolmamalı.';
  assert.deepEqual(state.openItems('- [ ] **'+title+'** · ek bağlam'),[title]);
  assert.deepEqual(state.openItems('- [ ] '+title),[title]);
});

const profile=(over={})=>({vault:'V',access:'write',storage:'markdown',protocolVersion:'2.9.0',
  hosts:[{id:'codex'},{id:'gemini'}],...over});
const ready=(over={})=>({
  profile:profile(),
  health:{hosts:[{id:'codex',label:'Codex',state:'verified',verifiedAt:'2026-09-20T00:00:00.000Z'},
                 {id:'gemini',label:'Spark',state:'verified',verifiedAt:'2026-09-20T00:00:00.000Z'}],verifiedCount:2},
  connections:[{id:'codex',status:'ready',access:{state:'granted'}},{id:'gemini',status:'ready',access:{state:'granted'}}],
  connector:{state:'online',enabled:true},
  reviews:{codex:{status:'completed'},gemini:{status:'completed'}},
  selfCheck:null,
  now:'2026-09-21T09:00:00.000Z',
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

test('ChatGPT derives transport readiness from its own tunnel, never the legacy relay',async()=>{
  const input=ready({profile:profile({hosts:[{id:'chatgpt'}]}),
    connections:[{id:'chatgpt',status:'attention',access:{state:'unavailable'}}],
    health:{hosts:[{id:'chatgpt',state:'unverified'}],verifiedCount:0},reviews:{}});
  assert.equal((await state.derive(input)).setup,'AI_SELECTED_NOT_CONNECTED');
  let result=await state.derive({...input,tunnel:{phase:'running',running:true}});
  assert.equal(result.connections[0].connected,false);
  result=await state.derive({...input,tunnel:{phase:'ready',running:true}});
  assert.equal(result.connections[0].connected,true);
  assert.equal(result.connections[0].verified,false);
  assert.equal(result.setup,'VERIFY_PENDING');
  assert.deepEqual(result.tunnel,{phase:'ready',running:true});
  result=await state.derive({...input,tunnel:{phase:'stopped',running:false}});
  assert.equal(result.setup,'AI_SELECTED_NOT_CONNECTED');
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

test('one change is one line, and a repeated level is not news',async t=>{
  const dir=await vault(t);
  const first=await state.persist(dir,await state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'}],verifiedCount:0},reviews:{}})));
  assert.deepEqual(first.events,[],'the first level has nothing to be different from');

  const same=await state.persist(dir,await state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'}],verifiedCount:0},reviews:{}})));
  assert.deepEqual(same.events,[],'the same picture twice is not an event');

  // This used to produce five lines, two pairs of which said the same thing in different
  // words -- a verification completing was both `verification_completed` and the clearing of
  // `verification_pending`. A history that says one event twice is read as two events.
  const verified=await state.persist(dir,await state.derive(ready()));
  assert.deepEqual(verified.events.map(e=>e.kind+':'+(e.attention||e.to)+(e.host?'@'+e.host:'')),
    ['setup_changed:READY',
     'attention_cleared:verification_pending@codex',
     'attention_cleared:verification_pending@gemini'],
    'the setup level once, and one line per connection whose worry left');

  const recent=await state.recent(dir);
  assert.equal(recent.length,3);
  assert.ok(recent.every(e=>e.at),'every transition carries when it happened');
});

test('a connection that drops and comes back is two transitions, and the reason survives',async t=>{
  const dir=await vault(t);
  await state.persist(dir,await state.derive(ready()));
  const down=await state.persist(dir,await state.derive(ready({connector:{state:'offline',enabled:true,lastError:'relay timeout'}})));
  const dropped=down.events.find(e=>e.attention==='connector_offline');
  assert.equal(dropped.kind,'attention_raised');
  // `detail` belongs to the worry, not to its name: losing the relay's own words would leave
  // the history saying only that something went wrong.
  assert.equal(dropped.detail,'relay timeout');
  const up=await state.persist(dir,await state.derive(ready()));
  assert.ok(up.events.some(e=>e.kind==='connection_restored'),'the good news has its own line');
  assert.ok(up.events.some(e=>e.kind==='attention_cleared'&&e.attention==='connector_offline'));
});

test('no profile is a state, not a crash',async()=>{
  const s=await state.derive({profile:null});
  assert.equal(s.setup,'AI_NOT_SELECTED');
  assert.deepEqual(s.connections,[]);
});

// --- 0.21.0: the states Claudian could not derive -------------------------------------------

test('a dated reminder is due, overdue or neither, and an unparseable one is neither',async t=>{
  const root=await vault(t,{'Hatırlatıcılar.md':`---
claudian_role: reminders
---
# Hatırlatıcılar

## Yaklaşan

- [ ] **Fatura** · **13.08.2026** · 1156,33 TL
- [ ] **Sınav** · **21 Eylül 2026**
- [ ] **Teslim** · 2026-09-25
- [ ] **Uzak iş** · 2026-12-01
- [ ] **Tarihsiz yükümlülük**
- [x] **Ödendi** · **01.09.2026**
`});
  const s=await state.derive(ready({profile:profile({vault:root}),language:'tr',now:'2026-09-21T09:00:00.000Z'}));
  assert.equal(s.today,'2026-09-21');
  const by=Object.fromEntries(s.reminders.map(r=>[r.text,r]));
  assert.equal(by['Fatura'].due,'overdue');
  assert.equal(by['Sınav'].due,'today');
  assert.equal(by['Sınav'].date,'2026-09-21');
  assert.equal(by['Teslim'].due,'soon');
  assert.equal(by['Uzak iş'].due,'later');
  assert.equal(by['Tarihsiz yükümlülük'].date,null,'a date is never invented');
  assert.equal(by['Ödendi'],undefined,'a checked box is done');

  // Only today and past due interrupt. "Remind without drowning" is the note's own rule.
  const kinds=s.attention.filter(a=>a.kind.startsWith('reminder')).map(a=>[a.kind,a.label]);
  assert.deepEqual(kinds,[['reminder_overdue','Fatura'],['reminder_due','Sınav']]);
});

test('an invalid calendar day is not a reminder that happens to be due',async t=>{
  const root=await vault(t,{'Hatırlatıcılar.md':`---
claudian_role: reminders
---
# Hatırlatıcılar

- [ ] **Bozuk tarih** · 31.02.2026
`});
  const s=await state.derive(ready({profile:profile({vault:root}),now:'2026-09-21T09:00:00.000Z'}));
  assert.equal(s.reminders[0].date,null);
  assert.equal(s.attention.some(a=>a.kind.startsWith('reminder')),false);
});

test('a named fault outranks "not verified yet", because one is broken and the other is unfinished',async()=>{
  const s=await state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'},{id:'gemini',label:'Spark',state:'verified'}],verifiedCount:1},
    reviews:{},
    selfCheck:{connections:[{id:'codex',failing:['files','server']}]}}));
  const codex=s.attention.filter(a=>a.host==='codex');
  assert.deepEqual(codex.map(a=>a.kind),['connection_broken']);
  assert.equal(codex[0].detail,'files, server','the failing layers are named');
});

test('a verification that was started and abandoned is its own state',async()=>{
  const started=await state.derive(ready({
    profile:profile({hosts:[{id:'codex',challenge:{issuedAt:'2026-09-21T08:00:00.000Z'}},{id:'gemini'}]}),
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'},{id:'gemini',label:'Spark',state:'verified'}],verifiedCount:1},
    reviews:{}}));
  const codex=started.attention.find(a=>a.host==='codex');
  assert.equal(codex.kind,'verification_unfinished');
  assert.equal(codex.detail,'2026-09-21T08:00:00.000Z');

  // Never attempted is a different sentence.
  const never=await state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'},{id:'gemini',label:'Spark',state:'verified'}],verifiedCount:1},
    reviews:{}}));
  assert.equal(never.attention.find(a=>a.host==='codex').kind,'verification_pending');
});

test('a resolved state leaves the panel, and its leaving is recorded',async t=>{
  const dir=await vault(t);
  const before=await state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'unverified'},{id:'gemini',label:'Spark',state:'unverified'}],verifiedCount:0},
    reviews:{}}));
  await state.persist(dir,before);
  assert.ok(before.attention.some(a=>a.kind==='verification_pending'&&a.host==='codex'));

  const after=await state.persist(dir,await state.derive(ready()));
  // The list is rebuilt from the world, so nothing has to be "dismissed" for it to go.
  assert.equal(after.state.attention.length,0,'a solved problem is simply not there any more');
  const cleared=after.events.filter(e=>e.kind==='attention_cleared').map(e=>e.attention);
  assert.ok(cleared.includes('verification_pending'));
  // The setup level is reported by `setup_changed`, which carries both ends, so it is not
  // also diffed as a worry.
  assert.ok(!cleared.includes('setup_incomplete'));
  assert.equal(after.events.find(e=>e.kind==='setup_changed')?.to,'READY');
});

test('attention appearing is recorded once, not on every derivation',async t=>{
  const dir=await vault(t);
  const broken=()=>state.derive(ready({
    health:{hosts:[{id:'codex',label:'Codex',state:'verified'},{id:'gemini',label:'Spark',state:'verified'}],verifiedCount:2},
    selfCheck:{connections:[{id:'codex',failing:['files']}]}}));
  await state.persist(dir,await broken());
  const second=await state.persist(dir,await broken());
  assert.deepEqual(second.events,[],'the same fault, still there, is not news again');
});

// --- 0.21.1: gaps that were claims without wires --------------------------------------------

test('the note application states are derivable, not decorative',async()=>{
  // These two lived in the engine with nothing able to set them: only the renderer learns
  // whether Obsidian is installed or running, and it never told the main process. A state the
  // panel can name and never reach is worse than one it does not offer.
  const obsidian=over=>state.derive(ready({profile:profile({storage:'obsidian'}),...over}));
  assert.equal((await obsidian({obsidian:{present:false}})).setup,'OBSIDIAN_MISSING');
  assert.equal((await obsidian({obsidian:{present:true,needsClose:true}})).setup,'OBSIDIAN_RESTART_REQUIRED');
  assert.equal((await obsidian({obsidian:{present:true,needsClose:false}})).setup,'READY');
  // Unknown is not absent: before the probe answers, nothing is claimed.
  assert.equal((await obsidian({obsidian:{}})).setup,'READY');
  // And a vault kept as plain Markdown is never asked about a note application.
  assert.equal((await state.derive(ready({obsidian:{present:false}}))).setup,'READY');
});

test('a missing folder still outranks the note application',async()=>{
  const s=await state.derive(ready({profile:profile({storage:'obsidian'}),
    obsidian:{present:false},health:{hosts:[],verifiedCount:0,vaultMissing:true}}));
  assert.equal(s.setup,'VAULT_MISSING','the first unmet condition is the one to fix');
});

test('every worry the engine can raise has words in both surfaces',async()=>{
  // The tray printed `connection_broken` while the panel said "This connection is broken".
  // One vocabulary, two renderers, and nothing that only the code can read.
  const tray=require('../runtime.cjs').describe;
  const renderer=require('node:fs').readFileSync(path.join(__dirname,'..','ui','renderer.js'),'utf8');
  const panel=renderer.slice(renderer.indexOf('function panelLabel('),renderer.indexOf('function panelLine('));
  const kinds=[...new Set([...Object.values(state.REVIEW_ATTENTION),
    'setup_incomplete','connector_offline','verification_pending','verification_stale',
    'verification_unfinished','connection_broken','authorization_waiting','reminder_due','reminder_overdue'])];
  for(const kind of kinds){
    assert.notEqual(tray(kind,'en'),kind,`the tray has no phrase for ${kind}`);
    assert.notEqual(tray(kind,'tr'),kind,`the tray has no Turkish phrase for ${kind}`);
    assert.ok(panel.includes(kind+':'),`the panel has no sentence for ${kind}`);
  }
});

test('open loops and reminders have one shape each, and it is the right one',async t=>{
  // One function returning strings or records depending on an argument is a shape nobody can
  // rely on. Open loops are undated by design; reminders are not.
  const root=await vault(t,{
    'Kontrol Paneli.md':'---\nclaudian_role: panel\n---\n\n- [ ] **Açık iş**\n',
    'Hatırlatıcılar.md':'---\nclaudian_role: reminders\n---\n\n- [ ] **Vadeli** · 2026-09-21\n'});
  const s=await state.derive(ready({profile:profile({vault:root}),now:'2026-09-21T09:00:00.000Z'}));
  assert.deepEqual(s.openLoops,['Açık iş'],'sentences');
  assert.deepEqual(s.reminders,[{text:'Vadeli',date:'2026-09-21',due:'today'}],'records');
});
