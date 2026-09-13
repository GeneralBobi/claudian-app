'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {MemorySetup}=require('../core.cjs');
async function fixture(t,language='en'){const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-manage-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const home=path.join(root,'home');await fs.mkdir(home);const core=new MemorySetup({legacy:true, home,dataDir:path.join(root,'data')});const input={name:'Deniz',vault:path.join(root,'notes'),mode:'new',storage:'obsidian',hosts:['codex','cursor','gemini-cli','antigravity','antigravity-cli'],language};await core.install((await core.prepare(input)).id,true);return{core,input,home};}
for(const language of ['en','tr'])test(language+' protocol and skill generation',async t=>{const{core,input,home}=await fixture(t,language);assert.match(await fs.readFile(path.join(input.vault,require('../policy.cjs').PROTOCOL_NOTE(language)),'utf8'),language==='en'?/# Claudian Universal Memory Protocol/:/# Claudian Evrensel Hafıza Protokolü/);assert.match(await fs.readFile(path.join(home,'.agents/skills/claudian-memory/SKILL.md'),'utf8'),language==='en'?/# Claudian memory/:/# Claudian memory/);await core.preferences(language);assert.equal((await core.preferences()).language,language);});
test('remove every host preserves notes, shared references and supports reconnect',async t=>{const{core,input}=await fixture(t);const before=await fs.readFile(path.join(input.vault,'00 - Deniz (Hub).md'),'utf8');for(const id of input.hosts){await core.removeHost(id);for(const h of await core.connections())assert.equal(h.status,'ready');}assert.equal((await core.snapshot()).profile.hosts.length,0);assert.equal(await fs.readFile(path.join(input.vault,'00 - Deniz (Hub).md'),'utf8'),before);await core.install((await core.prepare({...input,mode:'existing',action:'extend'})).id,true);assert.equal((await core.connections()).length,5);assert.equal((await core.checkFiles()).vault,'ready');assert.ok(!(await fs.readdir(input.vault)).some(n=>n.startsWith('.claudian-access')));});
test('legacy profile paths and user additions survive removal',async t=>{const{core,home}=await fixture(t);const profile=JSON.parse(await fs.readFile(core.configFile));profile.hosts.forEach(h=>delete h.artifacts);await fs.writeFile(core.configFile,JSON.stringify(profile));const rule=path.join(home,'.codex/AGENTS.md');await fs.appendFile(rule,'\n# My new instructions\nKeep me.\n');await core.removeHost('codex');assert.match(await fs.readFile(rule,'utf8'),/Keep me/);assert.doesNotMatch(await fs.readFile(rule,'utf8'),/claudian:memory:start/);});
test('modified skill fails safely without changing profile',async t=>{const{core,home}=await fixture(t);await core.removeHost('codex');await core.removeHost('cursor');await core.removeHost('gemini-cli');await core.removeHost('antigravity');const skill=path.join(home,'.gemini/antigravity-cli/skills/claudian-memory.md');await fs.appendFile(skill,'\nPersonal edit');await assert.rejects(core.removeHost('antigravity-cli'),/modified/);assert.equal((await core.snapshot()).profile.hosts.length,1);assert.match(await fs.readFile(skill,'utf8'),/Personal edit/);});

// A rule file this app created and that holds nothing else must not survive removal. The next
// install finds a startup rule without a Claudian marker, refuses, and blames the user for a
// file we left behind. Measured 12.09.2026: ~/.claude/rules/claudian-memory.md, 0 bytes.
test('removal leaves no empty rule husk, but keeps a rule the user also wrote in',async t=>{
 const{core,home}=await fixture(t);
 const cursorRule=path.join(home,'.cursor/rules/claudian-memory.mdc');
 assert.ok(await fs.readFile(cursorRule,'utf8'));
 await core.removeHost('cursor');
 await assert.rejects(fs.readFile(cursorRule,'utf8'),{code:'ENOENT'},'a husk holding only our front matter must go');

 const shared=path.join(home,'.codex/AGENTS.md');
 await fs.appendFile(shared,'\n# Mine\nKeep this.\n');
 await core.removeHost('codex');
 assert.match(await fs.readFile(shared,'utf8'),/Keep this/,'a file the user wrote in stays');
});

// Claudian's working files do not belong in the user's notes folder. Verification challenges
// and pre-write copies were hidden from the in-app list but never collected, so they kept
// piling up where the user actually looks. Cleaning by hand is not a mechanism.
test('residue is swept out of the vault, and a live challenge is not',async t=>{
 const{core,input}=await fixture(t);
 const stale='.claudian-check-codex-3dcb460d-ed77-4dab-bd36-2025f1ecc739.md';
 const reply='.claudian-check-codex-3dcb460d-ed77-4dab-bd36-2025f1ecc739-response.md';
 const backup='Vault Protocol.md.claudian-1789197903805.bak';
 const mine='00 - Deniz (Hub).md';
 for(const name of [stale,reply,backup])await fs.writeFile(path.join(input.vault,name),'residue\n');

 await core.challenge('cursor');
 const live=(await core.snapshot()).profile.hosts.find(h=>h.id==='cursor').challenge.input;
 const swept=await core.sweepResidue();

 assert.deepEqual(swept.sort(),[stale,reply,backup].sort());
 for(const name of [stale,reply,backup])await assert.rejects(fs.readFile(path.join(input.vault,name),'utf8'),{code:'ENOENT'});
 assert.ok(await fs.readFile(live,'utf8'),'an issued challenge is still waiting for an answer');
 assert.ok(await fs.readFile(path.join(input.vault,mine),'utf8'),'real notes are untouched');
 // Nothing is destroyed: residue is recoverable from the application's own removals folder.
 const bin=path.join(core.dataDir,'removals');
 const found=(await fs.readdir(bin,{recursive:true})).filter(n=>n.includes('claudian-1789197903805'));
 assert.equal(found.length,1);
});

// The "(yours ...)" copies this application produced hold its own text, so they are residue
// too. A copy holding something Claudian cannot generate is a real user version and stays.
test('generated protocol copies are collected, a user version is kept',async t=>{
 const{core,input}=await fixture(t);
 const policy=require('../policy.cjs');
 const ours=path.join(input.vault,'Claudian Universal Protocol (yours 2026-09-12).md');
 const theirs=path.join(input.vault,'Claudian Universal Protocol (yours 2026-09-11).md');
 await fs.writeFile(ours,policy.protocol('tr'));
 await fs.writeFile(theirs,policy.protocol('en')+'\n\nMy own addition.\n');

 const swept=await core.sweepResidue();

 assert.deepEqual(swept,[path.basename(ours)]);
 await assert.rejects(fs.readFile(ours,'utf8'),{code:'ENOENT'});
 assert.match(await fs.readFile(theirs,'utf8'),/My own addition/);
});

// What the uninstaller now runs before deleting the program. Leaving these behind is what made
// a reinstall resume a dead profile instead of asking where notes should live.
test('withdrawing every connection leaves nothing of Claudian in the home folder',async t=>{
 const{core,home,input}=await fixture(t);
 const written=(await core.snapshot()).profile.files.map(f=>f.path).filter(f=>!f.startsWith(input.vault));
 assert.ok(written.length>=5,'the fixture must actually have written into the home folder');

 for(const id of input.hosts)await core.removeHost(id);

 for(const file of written){
  const body=await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(body===null)continue;
  assert.doesNotMatch(body,/claudian:memory:start/,file+' still carries a Claudian block');
  assert.doesNotMatch(body,/claudian-memory/,file+' still points at a Claudian skill');
 }
 const config=await fs.readFile(path.join(home,'.claude.json'),'utf8').catch(()=>'{}');
 assert.ok(!JSON.parse(config).mcpServers?.claudian,'the memory server entry is withdrawn');
 assert.ok(await fs.readFile(path.join(input.vault,'00 - Deniz (Hub).md'),'utf8'),'notes are never touched');
});
