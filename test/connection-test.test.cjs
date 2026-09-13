'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {MemorySetup}=require('../core.cjs');
const probe=require('../connection-test.cjs');
test('MCP connection challenge completes without allowing ordinary tools to access hidden notes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-probe-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home'),dataDir=path.join(root,'data'),vault=path.join(root,'vault');await fs.mkdir(home);
 const core=new MemorySetup({home,dataDir});await core.install((await core.prepare({name:'Test',vault,mode:'new',storage:'markdown',hosts:['claude-code'],access:'write',language:'en'})).id,true);
 assert.match((await core.challenge('claude-code')).prompt,/read_connection_test/);
 const read=await probe.read(dataDir,vault,'claude-code');
 await assert.rejects(require('../memory-store.cjs').read(vault,read.test_id),/protected/);
 await assert.rejects(probe.read(dataDir,vault,'codex'),/No active/);
 await assert.rejects(probe.submit(dataDir,vault,'claude-code',{test_id:read.test_id,value:'wrong'}),/match/);
 const value=read.content.match(/[a-f0-9]{36}/)[0];
 await probe.submit(dataDir,vault,'claude-code',{test_id:read.test_id,value});assert.equal((await core.verify('claude-code')).verified,true);
 await assert.rejects(probe.submit(dataDir,vault,'claude-code',{test_id:read.test_id,value}),/EEXIST/);
 await core.challenge('claude-code');const p=(await core.snapshot()).profile;
 p.access='read';await fs.writeFile(core.configFile,JSON.stringify(p));
 const next=await probe.read(dataDir,vault,'claude-code');
 await assert.rejects(probe.submit(dataDir,vault,'claude-code',{test_id:next.test_id,value:next.content.match(/[a-f0-9]{36}/)[0]}),/read-only/);
 p.access='write';p.hosts[0].challenge.output=path.join(root,'escape.md');await fs.writeFile(core.configFile,JSON.stringify(p));
 await assert.rejects(probe.read(dataDir,vault,'claude-code'),/destination/);
});
test('provider memory pointer carries no personal location and does not claim account access',()=>{
 const {memoryTrigger}=require('../policy.cjs');for(const lang of ['tr','en']){const s=memoryTrigger(lang);assert.match(s,/startup_context/);assert.doesNotMatch(s,/Boran|SecondBrain|Desktop|Kled/);assert.ok(s.length<1500);}
});

// Generated for the connection it belongs to. The generic form must never carry a path; the
// form generated for a real connection is expected to, because naming the folder is what stops
// the model guessing an old one.
test('the provider-memory instruction names the connection and the folder it was made for',()=>{
 const {memoryTrigger}=require('../policy.cjs');
 const made=memoryTrigger('en',{vault:'C:/Users/Someone/Notes',server:'claudian'});
 assert.match(made,/"claudian"/);
 assert.match(made,/C:\/Users\/Someone\/Notes/);
 assert.match(made,/startup_context/);
 assert.match(made,/never say/i,'silence is the behaviour it exists to carry');
 assert.match(made,/grants no permission/i,'a preference is not a permission');
 assert.ok(made.length<1800);
 // Without a connection it stays generic, so it can be shown before anything is installed.
 assert.doesNotMatch(memoryTrigger('en'),/C:\//);
});
