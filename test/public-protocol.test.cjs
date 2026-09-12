'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const policy=require('../policy.cjs'),{MemorySetup}=require('../core.cjs');
test('public generated content contains no owner biography and has a vault-independent protocol',()=>{
 for(const language of ['tr','en']){
  const skill=policy.skill('C:/Synthetic/Vault',['Claudian Home.md'],language);
  const starter=Object.values(require('../welcome.cjs').skeleton(language,'Test User')).join('\n');
  assert.doesNotMatch(skill+starter,/KKTC|Boran|Bobby|Kıbrıs|Cyprus|quiet since childhood|küçüklüğümden beri|four-year curriculum|dört yıllık bir müfredat/i);
  assert.match(skill,/ADD/);assert.match(skill,/INVALIDATE/);
 }
});
test('protocol upgrade preserves user notes and customized protocol byte for byte',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-public-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home'),vault=path.join(root,'vault'),dataDir=path.join(root,'data');await fs.mkdir(home);
 const setup=new MemorySetup({home,dataDir});
 await setup.install((await setup.prepare({name:'Test User',vault,mode:'new',storage:'markdown',hosts:['claude-code'],language:'tr',access:'write'})).id);
 const files=['Claudian Decisions.md','Claudian Working agreements.md','Claudian Universal Protocol.md','Personal project.md'];
 const originals=new Map();for(const name of files){const body='User-owned content: '+name+'\r\nPrivate constraint and project history.\r\n';await fs.writeFile(path.join(vault,name),body);originals.set(name,body);}
 const profileFile=path.join(dataDir,'profile.json'),profile=JSON.parse(await fs.readFile(profileFile,'utf8'));
 await fs.writeFile(profileFile,JSON.stringify({...profile,protocolVersion:'1.0.0'}));
 await setup.upgrade();
 for(const [name,body]of originals)assert.equal(await fs.readFile(path.join(vault,name),'utf8'),body);
 await fs.unlink(path.join(vault,'Claudian Universal Protocol.md'));
 await setup.upgrade();
 await assert.rejects(fs.access(path.join(vault,'Claudian Universal Protocol.md')));
 for(const [name,body]of originals)if(name!=='Claudian Universal Protocol.md')assert.equal(await fs.readFile(path.join(vault,name),'utf8'),body);
});
