'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const store=require('../memory-store.cjs'),runtime=require('../memory-runtime.cjs'),hook=require('../memory-hook.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-runtime-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const vault=path.join(root,'vault');await fs.mkdir(vault);return {root,vault,data:path.join(root,'data')};}
test('stale edits cannot erase user changes; successful changes have recoverable evidence',async t=>{
  const {vault}=await fixture(t);
  const created=await store.mutate(vault,{operation:'create',note:'Projects/A',body:'Deadline: Monday',reason:'User commitment'},'claude-code');
  assert.equal(created.status,'committed');
  const old=await store.read(vault,'Projects/A');
  await fs.appendFile(path.join(vault,'Projects/A.md'),'User edit\n');
  await assert.rejects(store.mutate(vault,{operation:'patch',note:'Projects/A',expected_sha256:old.sha256,old_text:'Monday',new_text:'Friday',reason:'Correction'},'claude-code'),/changed/);
  const current=await store.read(vault,'Projects/A');
  const receipt=await store.mutate(vault,{operation:'patch',note:'Projects/A',expected_sha256:current.sha256,old_text:'Monday',new_text:'Friday',reason:'Correction'},'claude-code');
  assert.equal(await fs.readFile(path.join(vault,receipt.backup),'utf8'),current.body);
  assert.match((await store.read(vault,'Projects/A')).body,/Friday\nUser edit/);
  assert.deepEqual((await store.search(vault,'Friday')).map(h=>h.note),['Projects/A.md']);
  await assert.rejects(store.mutate(vault,{operation:'create',note:'Projects/A',body:'Overwrite',reason:'Duplicate'},'claude-code'),/already exists/);
  const fresh=await store.read(vault,'Projects/A');
  const archived=await store.mutate(vault,{operation:'archive',note:'Projects/A',expected_sha256:fresh.sha256,reason:'Retired'},'claude-code');
  assert.equal((await store.list(vault)).length,0);
  assert.equal(await fs.readFile(path.join(vault,archived.archived),'utf8'),fresh.body);
});
test('junction reads and writes never reach an external folder',async t=>{
  const {root,vault}=await fixture(t);const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.md'),'private');
  await fs.symlink(outside,path.join(vault,'linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(store.read(vault,'linked/secret'),/links|junctions/);
  await assert.rejects(store.mutate(vault,{operation:'create',note:'linked/new',body:'x',reason:'Test'}),/links|junctions/);
  assert.deepEqual(await store.list(vault),[]);
});
test('forty turns remain checked; a late missing review is detected without an infinite stop loop',async t=>{
  const {vault,data}=await fixture(t),profile={vault,access:'write'};
  for(let turn=1;turn<=40;turn++){
    const start=await hook.run({session_id:'long-session',hook_event_name:'UserPromptSubmit'},data,profile);
    assert.match(start.hookSpecificOutput.additionalContext,new RegExp(`turn ${turn}`));
    if(turn===37){
      const blocked=await hook.run({session_id:'long-session',hook_event_name:'Stop'},data,profile);assert.equal(blocked.decision,'block');
      const released=await hook.run({session_id:'long-session',hook_event_name:'Stop'},data,profile);assert.equal(released.decision,undefined);
      assert.equal((await runtime.load(data,'long-session')).outcome,'UNREVIEWED');
    }else{
      await runtime.review(data,{session_id:'long-session',turn,outcome:'NO_OP'},'claude-code',vault);
      assert.deepEqual(await hook.run({session_id:'long-session',hook_event_name:'Stop'},data,profile),{});
    }
  }
  const status=(await runtime.status(data))[0];
  assert.equal(status.failedTurns,1);
  assert.equal(status.history.find(t=>t.turn===37).outcome,'UNREVIEWED');
});
test('review rejects fabricated receipts, stale turns and a different host',async t=>{
  const {vault,data}=await fixture(t);await runtime.begin(data,'s','claude-code');
  const args={session_id:'s',turn:1,outcome:'UPDATED',receipts:['invented']};
  await assert.rejects(runtime.review(data,args,'claude-code',vault),/committed receipts/);
  await assert.rejects(runtime.review(data,{...args,outcome:'NO_OP'},'codex',vault),/different connection/);
  const receipt=await store.mutate(vault,{operation:'create',note:'Decision',body:'A real decision',reason:'User chose it'},'claude-code');
  assert.equal((await runtime.review(data,{...args,receipts:[receipt.id]},'claude-code',vault)).recorded,true);
  await runtime.begin(data,'s','claude-code');
  await assert.rejects(runtime.review(data,args,'claude-code',vault),/Stale turn/);
});
test('startup returns constraints and open loops, and marks large required notes explicitly',async t=>{
 const {vault}=await fixture(t);
 for(const name of ['Claudian Home.md','Claudian Decisions.md','Claudian Working agreements.md','Control Panel.md','Reminders.md','Claudian Universal Protocol.md'])await fs.writeFile(path.join(vault,name),name==='Claudian Decisions.md'?'x'.repeat(12001):'Content of '+name);
 const context=await runtime.context(vault);
 assert.equal(context.notes.length,5);
 assert.equal(context.notes.find(n=>n.note==='Claudian Decisions.md').requiresFullRead,true);
 assert.equal(context.notes.find(n=>n.note==='Reminders.md').body,'Content of Reminders.md');
 assert.deepEqual(context.missing,[]);
});
test('a long running turn receives a checkpoint without waiting for a final answer',async t=>{
 const {vault,data}=await fixture(t),profile={vault};
 await hook.run({session_id:'long-task',hook_event_name:'UserPromptSubmit'},data,profile);
 for(let n=1;n<=12;n++){
   const output=await hook.run({session_id:'long-task',hook_event_name:'PostToolUse',tool_name:'Bash'},data,profile);
   if(n===12)assert.match(output.hookSpecificOutput.additionalContext,/do not wait/);
   else assert.deepEqual(output,{});
 }
});
test('deleting the vault protocol leaves an application protocol and keeps personal notes intact',async t=>{
 const {vault}=await fixture(t);await fs.writeFile(path.join(vault,'My decisions.md'),'My private decision');
 const context=await runtime.context(vault,'','write','tr');
 assert.equal(context.protocol.source,'application');assert.match(context.protocol.body,/INVALIDATE/);
 assert.equal(context.vaultProtocol,null);
 assert.equal(await fs.readFile(path.join(vault,'My decisions.md'),'utf8'),'My private decision');
 await assert.rejects(fs.access(path.join(vault,'Claudian Universal Protocol.md')));
 const customized='My additional privacy constraint';await fs.writeFile(path.join(vault,'Claudian Universal Protocol.md'),customized);
 const next=await runtime.context(vault);assert.equal(next.vaultProtocol.body,customized);
 assert.equal(next.protocol.source,'application');
});
test('an early review cannot cover a later long-task checkpoint',async t=>{
 const {vault,data}=await fixture(t),profile={vault};
 await hook.run({session_id:'checkpoint',hook_event_name:'UserPromptSubmit'},data,profile);
 await runtime.review(data,{session_id:'checkpoint',turn:1,outcome:'NO_OP'},'claude-code',vault);
 for(let n=0;n<12;n++)await hook.run({session_id:'checkpoint',hook_event_name:'PostToolUse',tool_name:'Bash'},data,profile);
 assert.equal((await runtime.status(data))[0].pending,true);
 assert.equal((await hook.run({session_id:'checkpoint',hook_event_name:'Stop'},data,profile)).decision,'block');
 await runtime.review(data,{session_id:'checkpoint',turn:1,outcome:'NO_OP'},'claude-code',vault);
 assert.equal((await runtime.status(data))[0].pending,false);
 assert.deepEqual(await hook.run({session_id:'checkpoint',hook_event_name:'Stop'},data,profile),{});
});
