'use strict';
// config.json is read, modified and written back by a dozen operations. Each individual
// write is atomic (temp file + rename), but the read-modify-write around it is not: two
// Claudian processes touching the profile at the same moment produce a last-writer-wins
// silent loss. This serialises those operations in-process and refuses to start one while
// another process holds the lock.
//
// Deliberately narrow: it guards the profile file only. Vault notes already carry their own
// expected-hash guard in memory-store.cjs and need nothing from here.
const fs=require('node:fs/promises'),path=require('node:path');
const {AsyncLocalStorage}=require('node:async_hooks');
const owners=new AsyncLocalStorage(),queues=new Map();
const STALE_AFTER=10*60*1000;
const keyFor=file=>{const key=path.resolve(file);return process.platform==='win32'?key.toLowerCase():key;};

async function exclusive(file,action) {
  const key=keyFor(file),inherited=owners.getStore();
  // A guarded operation may call another one (install -> upgrade). Re-entering is not a
  // second writer, so it must not deadlock on its own lock.
  if(inherited?.get(key)?.active)return action();
  const previous=queues.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    const lock=file+'.mutation.lock';
    await fs.mkdir(path.dirname(lock),{recursive:true});
    let handle;
    try{handle=await fs.open(lock,'wx');}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      // A lock left behind by a crash would otherwise block every profile change forever,
      // which is worse than the race it guards. No profile mutation runs for ten minutes,
      // so a lock older than that is debris and is cleared once, then retried once.
      const stale=await fs.stat(lock).then(x=>Date.now()-x.mtimeMs>STALE_AFTER).catch(()=>false);
      if(!stale)throw Error('Profile is busy in another Claudian window. Retry once it finishes; do not delete a live lock: '+lock);
      await fs.unlink(lock).catch(()=>{});
      try{handle=await fs.open(lock,'wx');}
      catch(retry){
        if(retry.code==='EEXIST')throw Error('Profile is busy in another Claudian window. Retry once it finishes; do not delete a live lock: '+lock);
        throw retry;
      }
    }
    const token={active:true},context=new Map(inherited||[]);context.set(key,token);
    try{return await owners.run(context,action);}
    finally{token.active=false;await handle.close();await fs.unlink(lock).catch(()=>{});}
  });
  queues.set(key,next);
  try{return await next;}finally{if(queues.get(key)===next)queues.delete(key);}
}

function wrap(Setup,names) {
  for(const name of names) {
    const original=Setup.prototype[name];
    if(typeof original!=='function')throw Error('Unknown profile mutation: '+name);
    Setup.prototype[name]=function(...args){return exclusive(this.configFile,()=>original.apply(this,args));};
  }
}
module.exports={exclusive,wrap};
