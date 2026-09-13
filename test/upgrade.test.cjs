'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {MemorySetup,hash}=require('../core.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-upgrade-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const core=new MemorySetup({legacy:true, home:root,dataDir:path.join(root,'data')});const input={name:'User',vault:path.join(root,'notes'),mode:'new',storage:'obsidian',language:'en',hosts:['codex','cursor']};await core.install((await core.prepare(input)).id,true);let profile=(await core.snapshot()).profile;profile.protocolVersion='1.2.0';for(const f of profile.files.filter(f=>f.type==='skill')){await fs.writeFile(f.path,'old owned skill');f.hash=hash('old owned skill');}await fs.writeFile(core.configFile,JSON.stringify(profile));return {core,profile,root};}
test('owned legacy skill migrates once and keeps notes and hosts',async t=>{const {core,profile}=await fixture(t);const note=path.join(profile.vault,'About Me.md');await fs.writeFile(note,'My own facts');const result=await core.upgrade();assert.ok(result.changed>0);assert.equal(await fs.readFile(note,'utf8'),'My own facts');assert.ok(!result.conflicts.includes(note));assert.equal((await core.snapshot()).profile.hosts.length,2);assert.match(await fs.readFile(profile.hosts[0].artifacts.skill,'utf8'),/INVALIDATE/);assert.equal((await core.upgrade()).changed,0);});
test('custom skill is preserved automatically; explicit repair backs it up',async t=>{const {core,profile}=await fixture(t);const file=profile.hosts[0].artifacts.skill;await fs.writeFile(file,'My custom instructions');assert.ok((await core.upgrade()).conflicts.includes(file));assert.equal(await fs.readFile(file,'utf8'),'My custom instructions');assert.equal((await core.upgrade('codex')).conflicts.length,0);assert.match(await fs.readFile(file,'utf8'),new RegExp(require('../policy.cjs').VERSION));assert.match(await fs.readFile(file,'utf8'),/claudian_role/);const dirs=await fs.readdir(path.join(core.dataDir,'upgrades'));let backup=false;for(const dir of dirs){const journal=JSON.parse(await fs.readFile(path.join(core.dataDir,'upgrades',dir,'journal.json')));backup ||=journal.changes.some(c=>c.before==='My custom instructions');}assert.ok(backup);});
test('repair recreates missing skill and preserves external rule edits on later removal',async t=>{const {core,profile}=await fixture(t);const {skill,rule}=profile.hosts[0].artifacts;await fs.unlink(skill);await fs.appendFile(rule,'\nUnrelated user instruction.\n');await core.upgrade('codex');assert.match(await fs.readFile(skill,'utf8'),/name: claudian-memory/);await core.removeHost('codex');assert.match(await fs.readFile(rule,'utf8'),/Unrelated user instruction/);assert.doesNotMatch(await fs.readFile(rule,'utf8'),/claudian:memory:start/);});
test('malformed rule blocks are not guessed or destroyed by repair',async t=>{const {core,profile}=await fixture(t);const file=profile.hosts[0].artifacts.rule;await fs.writeFile(file,'User rules\n<!-- claudian:memory:start -->\nbroken');const before=await fs.readFile(file,'utf8');assert.ok((await core.upgrade('codex')).conflicts.includes(file));assert.equal(await fs.readFile(file,'utf8'),before);});
test('new protocol defines no-op, invalidation, forgetting and silent failure boundary',async t=>{const {profile}=await fixture(t);const text=await fs.readFile(path.join(profile.vault,'Vault Protocol.md'),'utf8');for(const term of ['NO_OP','INVALIDATE','valid_from','user_statement','forget/delete','failed save'])assert.ok(text.includes(term),term);});

// An upgrade that renames anything must not hand the user a second copy of every note. A note
// is missing only when its ROLE is unfilled; checking the filename would have given a vault
// from an earlier version two entry maps, two panels and two sets of agreements at once.
test('upgrading a vault written under the old names adds no second copy',async t=>{
 const {core,profile}=await fixture(t);
 const vault=profile.vault;
 // Rewind the vault to what an earlier version produced: old names, no roles declared.
 for(const name of await fs.readdir(vault))if(name.endsWith('.md'))await fs.rm(path.join(vault,name));
 const legacy={'Claudian Home.md':'# Home\n','Claudian Decisions.md':'# Decisions\n',
  'Claudian Working agreements.md':'# Agreements\n','Control Panel.md':'# Panel\n',
  'Reminders.md':'# Reminders\n','Claudian Universal Protocol.md':'# Old protocol\n'};
 for(const [name,body] of Object.entries(legacy))await fs.writeFile(path.join(vault,name),body);

 await core.upgrade();
 const after=await fs.readdir(vault);

 for(const name of Object.keys(legacy))assert.ok(after.includes(name),name+' must survive the upgrade');
 assert.ok(!after.some(n=>/^00 - /.test(n)),'no second entry map');
 assert.ok(!after.includes('Decisions.md'),'no second decisions note');
 assert.ok(!after.includes('Working Agreements.md'),'no second agreements note');
 assert.deepEqual(after.filter(n=>/Protocol/i.test(n)),['Claudian Universal Protocol.md']);
 // The role now lives in the note the user already had, so the next session resolves it.
 const roles=(await require('../roles.cjs').resolve(vault)).roles;
 assert.equal(roles.entry,'Claudian Home.md');
 assert.equal(roles.protocol,'Claudian Universal Protocol.md');
});
