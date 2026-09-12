'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const review=require('../setup-review.cjs'),{MemorySetup}=require('../core.cjs');
test('reinstall asks again while ordinary restart remembers review',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-review-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 assert.equal(await review.pending(root,'install-1',null),false);
 assert.equal(await review.pending(root,'install-1',{}),true);
 await review.acknowledge(root,'install-1');assert.equal(await review.pending(root,'install-1',{}),false);
 assert.equal(await review.pending(root,'install-2',{}),true);
});
test('reinstall repairs selected connector and preserves user notes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-repair-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home');await fs.mkdir(home);
 const core=new MemorySetup({home,dataDir:path.join(root,'data')});
 await core.install((await core.prepare({name:'Deniz',vault:path.join(root,'notes'),mode:'new',storage:'markdown',hosts:['claude-code'],language:'en',access:'write'})).id);
 const note=path.join(root,'notes','My decision.md');await fs.writeFile(note,'User-owned decision.');
 await fs.unlink(path.join(home,'.claude.json'));
 const result=await review.apply(core,['claude-code']);assert.deepEqual(result.conflicts,[]);
 assert.ok(JSON.parse(await fs.readFile(path.join(home,'.claude.json'),'utf8')).mcpServers.claudian);
 assert.equal(await fs.readFile(note,'utf8'),'User-owned decision.');
 await assert.rejects(review.apply(core,[]));
 const controller=new AbortController();controller.abort();await core.challenge('claude-code');
 assert.equal((await core.watchVerification('claude-code',()=>{},{signal:controller.signal})).state,'cancelled');
});
test('Codex accepts equivalent Windows launcher paths without replacing user config',()=>{
 const {grant}=require('../codex-connector.cjs');
 const env={CLAUDIAN_DATA:'C:/Users/Example/Data',CLAUDIAN_HOST:'codex'};
 const first=grant('',{command:'C:/Apps/Claudian.exe',args:['C:/Apps/app.asar/mcp-server.cjs'],env});
 assert.equal(grant(first,{command:'C:\\Apps\\Claudian.exe',args:['C:\\Apps\\app.asar\\mcp-server.cjs'],env:{...env,CLAUDIAN_DATA:'C:\\Users\\Example\\Data'}}),first);
});
