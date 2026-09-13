'use strict';
// Renaming a note must not disconnect the memory. That promise is the whole reason the role
// exists, so it is measured rather than asserted in prose: the protocol now tells the model to
// resolve by role, and this is what makes that true.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const roles=require('../roles.cjs');
const {MemorySetup}=require('../core.cjs');

async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-roles-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('a note keeps its part after the user renames it',async t=>{
 const root=await temp(t),home=path.join(root,'home');await fs.mkdir(home);
 const vault=path.join(root,'notes');
 const core=new MemorySetup({home,dataDir:path.join(root,'data')});
 await core.install((await core.prepare({name:'Deniz',vault,mode:'new',storage:'markdown',hosts:['claude-code'],language:'en'})).id,true);

 const before=await roles.resolve(vault);
 assert.equal(before.roles.entry,'00 - Deniz (Hub).md');
 assert.equal(before.roles.panel,'Control Panel.md');
 assert.equal(before.adapters['claude-code'],'Claude Code.md');

 await fs.rename(path.join(vault,'Control Panel.md'),path.join(vault,'My Open Loops.md'));
 await fs.rename(path.join(vault,'00 - Deniz (Hub).md'),path.join(vault,'Beynim.md'));

 const after=await roles.resolve(vault);
 assert.equal(after.roles.panel,'My Open Loops.md','the renamed panel is still the panel');
 assert.equal(after.roles.entry,'Beynim.md','the renamed entry map is still the entry map');
 assert.deepEqual(await roles.entryOrder(vault),['Beynim.md','Working Agreements.md','Decisions.md','My Open Loops.md','Reminders.md']);
});

// A vault written before roles existed declares nothing. It must not be read as empty.
test('an older vault is recognised by the names it was given then',async t=>{
 const vault=await temp(t);
 for(const name of ['Claudian Home.md','Claudian Decisions.md','Claudian Working agreements.md','Control Panel.md','Claudian Universal Protocol.md'])
  await fs.writeFile(path.join(vault,name),'---\ntags: [claudian]\n---\n\n# '+name+'\n');
 const {roles:found}=await roles.resolve(vault);
 assert.equal(found.entry,'Claudian Home.md');
 assert.equal(found.decisions,'Claudian Decisions.md');
 assert.equal(found.agreements,'Claudian Working agreements.md');
 assert.equal(found.protocol,'Claudian Universal Protocol.md');
});

// The entry map is named after its owner, so it cannot be found from a list of names.
test('an entry map is recognised by its shape when it carries no role',async t=>{
 const vault=await temp(t);
 await fs.writeFile(path.join(vault,'00 - Boran (Hub).md'),'# Hub\n');
 await fs.writeFile(path.join(vault,'Something else.md'),'# Else\n');
 assert.equal((await roles.resolve(vault)).roles.entry,'00 - Boran (Hub).md');
});

test('a declared role outranks any name',async t=>{
 const vault=await temp(t);
 await fs.writeFile(path.join(vault,'Control Panel.md'),'# Not the panel any more\n');
 await fs.writeFile(path.join(vault,'Açık Konular.md'),'---\nclaudian_role: panel\n---\n\n# Panel\n');
 assert.equal((await roles.resolve(vault)).roles.panel,'Açık Konular.md');
});

test('nested existing role notes are read, written and preserved during upgrade',async t=>{
 const root=await temp(t),home=path.join(root,'home');await fs.mkdir(home);
 const vault=path.join(root,'notes'),core=new MemorySetup({home,dataDir:path.join(root,'data')});
 await core.install((await core.prepare({name:'Deniz',vault,mode:'new',storage:'markdown',hosts:['claude-code'],language:'en'})).id,true);
 await fs.mkdir(path.join(vault,'Personal'));
 const old='Working Agreements.md',nested='Personal/How we work.md';
 await fs.rename(path.join(vault,old),path.join(vault,nested));
 await fs.appendFile(path.join(vault,nested),'\nKeep appointments in local time.\n');
 const context=await require('../memory-runtime.cjs').context(vault,'','write','en','claude-code');
 assert.ok(context.notes.some(n=>n.note===nested&&n.body.includes('local time')));
 const result=await require('../memory-capture.cjs').capture(vault,{kind:'agreement',text:'Show the reason for a recommendation'},'claude-code','en');
 assert.equal(result.note,nested);
 const before=await fs.readFile(path.join(vault,nested),'utf8');
 await core.upgrade();
 assert.equal(await fs.readFile(path.join(vault,nested),'utf8'),before);
 await assert.rejects(fs.access(path.join(vault,old)),{code:'ENOENT'});
});

test('a folder that is not there resolves to nothing rather than throwing',async t=>{
 const root=await temp(t);
 assert.deepEqual(await roles.resolve(path.join(root,'gone')),{roles:{},adapters:{}});
});
