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
 const core=new MemorySetup({legacy:true, home,dataDir:path.join(root,'data')});
 await core.install((await core.prepare({name:'Deniz',vault:path.join(root,'notes'),mode:'new',storage:'markdown',hosts:['claude-code'],language:'en',access:'write'})).id,true);
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

// Removing the program used to leave the profile and every file it had written inside the AI
// applications, so the next install found a profile, opened this review screen instead of
// setup, and confirmed a notes folder the user had already deleted. Setup never asked where
// notes should live and no vault was created. Measured 12.09.2026 on a clean reinstall.
test('a notes folder that is gone stops the review instead of confirming it',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-gone-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home');await fs.mkdir(home);
 const vault=path.join(root,'notes');
 const core=new MemorySetup({legacy:true, home,dataDir:path.join(root,'data')});
 await core.install((await core.prepare({name:'Deniz',vault,mode:'new',storage:'markdown',hosts:['claude-code'],language:'en',access:'write'})).id,true);

 assert.equal((await core.snapshot()).vaultMissing,false);
 await fs.rm(vault,{recursive:true,force:true});
 assert.equal((await core.snapshot()).vaultMissing,true,'the screen must be able to tell');
 await assert.rejects(review.apply(core,['claude-code']),/klasör/i);

 // Pointing at a folder again is what reopens the path; the starter notes come back with it.
 await core.relocate(vault);
 assert.equal((await core.snapshot()).vaultMissing,false);
 assert.ok(await fs.readFile(path.join(vault,'00 - Deniz (Hub).md'),'utf8'));
 assert.deepEqual((await review.apply(core,['claude-code'])).conflicts,[]);
});

// Consent is a condition of installing, not a sentence on a screen. Without it a user who
// agreed to nothing ended up with a memory server, a startup rule and a folder permission
// inside every AI application they had installed.
test('nothing is written until the permission is actually granted',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-grant-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home');await fs.mkdir(home);
 const vault=path.join(root,'notes');
 const core=new MemorySetup({legacy:true, home,dataDir:path.join(root,'data')});
 const plan=await core.prepare({name:'Deniz',vault,mode:'new',storage:'markdown',hosts:['claude-code'],language:'en',access:'write'});

 await assert.rejects(core.install(plan.id),/onaylamadan/);
 await assert.rejects(core.install(plan.id,'yes'),/onaylamadan/);
 assert.equal((await core.snapshot()).profile,null,'a refused grant installs nothing');
 await assert.rejects(fs.readFile(path.join(home,'.claude/skills/claudian-memory/SKILL.md'),'utf8'),{code:'ENOENT'});

 await core.install(plan.id,true);
 const {profile}=await core.snapshot();
 // A permission the user cannot look up afterwards is not a permission they gave.
 assert.equal(profile.grants.length,1);
 assert.equal(profile.grants[0].scope,'write');
 assert.deepEqual(profile.grants[0].hosts,['claude-code']);
 assert.ok(profile.grants[0].capabilities.includes('write_note'));
 assert.ok(Date.parse(profile.grants[0].at));
});

// A read-only grant must reach the disk as a read-only connection, not as a screen that said so.
test('a read grant installs no write capability',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-read-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home');await fs.mkdir(home);
 const core=new MemorySetup({legacy:true, home,dataDir:path.join(root,'data')});
 const plan=await core.prepare({name:'Deniz',vault:path.join(root,'notes'),mode:'new',storage:'markdown',hosts:['claude-code'],language:'en',access:'read'});
 await core.install(plan.id,true);
 const {profile}=await core.snapshot();
 assert.equal(profile.grants[0].scope,'read');
 assert.ok(!profile.grants[0].capabilities.includes('write_note'));
});

// This screen looked like a confirmation and behaved like a removal. An installation that had
// just written seven connections came back with one, because everything left unticked here was
// withdrawn without a word. Measured 13.09.2026 on a real profile: the setup log recorded all
// seven written and completed, and the profile afterwards held only Claude Code.
test('withdrawing a connection is a separate act that has to be asked for by name',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-withdraw-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home');await fs.mkdir(home);
 const core=new MemorySetup({legacy:true, home,dataDir:path.join(root,'data')});
 await core.install((await core.prepare({name:'Deniz',vault:path.join(root,'notes'),mode:'new',storage:'markdown',
   hosts:['claude-code','codex','cursor'],language:'en',access:'write'})).id,true);
 assert.equal((await core.snapshot()).profile.hosts.length,3);

 // Applying with two ticked would silently drop the third. It must refuse and name it.
 await assert.rejects(review.apply(core,['claude-code','codex'],true),error=>{
  assert.deepEqual(error.withdrawing,['cursor']);return true;
 });
 assert.equal((await core.snapshot()).profile.hosts.length,3,'nothing is removed by a refusal');

 // A confirmation that does not cover the connection is not a confirmation for it.
 await assert.rejects(review.apply(core,['claude-code','codex'],true,['gemini-cli']),/Kaldırma onayı/);
 assert.equal((await core.snapshot()).profile.hosts.length,3);

 await review.apply(core,['claude-code','codex'],true,['cursor']);
 assert.deepEqual((await core.snapshot()).profile.hosts.map(h=>h.id),['claude-code','codex']);
 assert.ok(await fs.readFile(path.join(root,'notes','00 - Deniz (Hub).md'),'utf8'),'notes are never touched');
});
