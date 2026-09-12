'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{createInterface}=require('node:readline');
test('an already running MCP process respects removal, scope reduction and vault changes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-revoke-'));
 const vault=path.join(root,'vault');await fs.mkdir(vault);await fs.writeFile(path.join(vault,'A.md'),'existing');
 const profile={vault,access:'write',hosts:[{id:'claude-code'}]};
 const write=overrides=>fs.writeFile(path.join(root,'profile.json'),JSON.stringify({...profile,...overrides}));await write({});
 const child=spawn(process.execPath,[path.join(__dirname,'../mcp-server.cjs')],{env:{...process.env,CLAUDIAN_DATA:root,CLAUDIAN_HOST:'claude-code'},stdio:['pipe','pipe','pipe'],windowsHide:true});
 child.stderr.resume();
 t.after(async()=>{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await fs.rm(root,{recursive:true,force:true});});
 let id=0;const waiting=new Map();
 createInterface({input:child.stdout}).on('line',line=>{const reply=JSON.parse(line);waiting.get(reply.id)?.(reply);});
 const call=(name,args)=>new Promise((resolve,reject)=>{
  const next=++id,timer=setTimeout(()=>reject(Error('MCP reply timed out')),5000);
  waiting.set(next,reply=>{clearTimeout(timer);waiting.delete(next);resolve(reply.result);});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method:'tools/call',params:{name,arguments:args}})+'\n');
 });
 assert.equal((await call('read_note',{note:'A'})).isError,undefined);
 await write({access:'read'});
 assert.match((await call('write_note',{note:'Blocked',body:'x',reason:'test'})).content[0].text,/revoked/);
 await assert.rejects(fs.access(path.join(vault,'Blocked.md')));
 assert.equal((await call('read_note',{note:'A'})).isError,undefined);
 await write({hosts:[]});
 assert.match((await call('read_note',{note:'A'})).content[0].text,/removed/);
 await write({vault:path.join(root,'other')});
 assert.match((await call('read_note',{note:'A'})).content[0].text,/vault changed/);
});
