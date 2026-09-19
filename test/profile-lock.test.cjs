'use strict';
// config.json is read, changed and written back by a dozen operations. Each write was already
// atomic; the read-modify-write around it was not, so two Claudian windows touching the
// profile at the same moment silently lost one of the two changes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const lock=require('../profile-lock.cjs');

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-lock-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'config.json');
  await fs.writeFile(file,JSON.stringify({count:0}));
  return {root,file};
}
const bump=file=>async()=>{
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  await new Promise(r=>setTimeout(r,15));           // the window where the old code lost writes
  await fs.writeFile(file,JSON.stringify({count:value.count+1}));
};

test('concurrent profile changes are serialised instead of overwriting each other',async t=>{
  const {file}=await fixture(t);
  await Promise.all([1,2,3,4,5].map(()=>lock.exclusive(file,bump(file))));
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).count,5,'every change survived');
});

test('a guarded operation may call another one without deadlocking on its own lock',async t=>{
  const {file}=await fixture(t);
  await lock.exclusive(file,async()=>{
    await lock.exclusive(file,bump(file));          // install -> upgrade, in miniature
    await lock.exclusive(file,bump(file));
  });
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).count,2);
});

test('the lock is released even when the operation throws',async t=>{
  const {file}=await fixture(t);
  await assert.rejects(lock.exclusive(file,async()=>{throw Error('boom');}),/boom/);
  await lock.exclusive(file,bump(file));
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).count,1);
  assert.equal(await fs.access(file+'.mutation.lock').then(()=>true,()=>false),false);
});

test('a live lock from another process is refused by name, not silently ignored',async t=>{
  const {file}=await fixture(t);
  const held=await fs.open(file+'.mutation.lock','wx');
  t.after(()=>held.close());
  await assert.rejects(lock.exclusive(file,bump(file)),/busy in another Claudian window/);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).count,0,'nothing was written past the lock');
});

test('a lock left behind by a crash is cleared instead of blocking the profile forever',async t=>{
  const {file}=await fixture(t);
  const lockPath=file+'.mutation.lock';
  await fs.writeFile(lockPath,'');
  const old=new Date(Date.now()-11*60*1000);
  await fs.utimes(lockPath,old,old);
  await lock.exclusive(file,bump(file));
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).count,1,'the profile is usable again');
});
