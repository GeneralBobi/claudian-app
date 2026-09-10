'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');const policy=require('./policy.cjs');
module.exports=(Setup,{hash,assertOrdinaryPath,json,atomicJson})=>{
 Setup.prototype.upgrade=async function(repairHost){
  if(this.running)throw new Error('Please wait for the current operation.');
  this.running=true;const applied=[];
  try{
   const profile=await json(this.configFile);if(!profile)return {changed:0,conflicts:[]};
   if(repairHost&&!profile.hosts.some(h=>h.id===repairHost))throw new Error('Connection not found.');
   const desired=new Map(),conflicts=[],roles=['Claudian Home.md','CLAUDIAN.md','Control Panel.md','Reminders.md'];
   const add=(file,content,kind,force=false)=>desired.set(file,{path:file,content,kind,force});
   if(!repairHost){
    add(path.join(profile.vault,'Claudian Universal Protocol.md'),policy.protocol(profile.language),'note');
    for(const [name,content] of Object.entries(require('./welcome.cjs').skeleton(profile.language)))add(path.join(profile.vault,name),content,'note');
    for(const name of ['Vault Protocol.md','Claudian Memory Protocol.md'])if(profile.files.some(f=>f.path===path.join(profile.vault,name)))add(path.join(profile.vault,name),policy.protocol(profile.language),'note');
   }
   for(const host of profile.hosts.filter(h=>!repairHost||h.id===repairHost)){
    const files=await this.hostPaths(profile,host.id);
    add(files.skill,policy.skill(profile.vault,roles,profile.language),'skill',!!repairHost);
    if(desired.has(files.rule))continue;
    await assertOrdinaryPath(files.rule);
    const before=await fs.readFile(files.rule,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    const start='<!-- claudian:memory:start -->',end='<!-- claudian:memory:end -->';
    const block=`${start}\n## Claudian shared memory\n\n${policy.instruction(files.skill,profile.vault,profile.language)}\n${end}`;
    let content;
    if(before?.includes(start)||before?.includes(end)){
     if(before.split(start).length!==2||before.split(end).length!==2||before.indexOf(end)<before.indexOf(start)){conflicts.push(files.rule);continue;}
     content=before.replace(/<!-- claudian:memory:start -->[\s\S]*?<!-- claudian:memory:end -->/,block);
    }else content=(before??(host.id==='cursor'?'---\ndescription: Claudian conversation memory\nalwaysApply: true\n---\n':''))+'\n'+block+'\n';
    add(files.rule,content,'rule',!!repairHost);
   }
   const changes=[];
   for(const item of desired.values()){
    await assertOrdinaryPath(item.path);
    const before=await fs.readFile(item.path,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(before===item.content)continue;
    const owned=profile.files.find(f=>f.path===item.path);
    if(before!==null&&(!owned||(!item.force&&owned.hash!==hash(before)))){
     if(item.kind!=='note'||/Protocol\.md$/.test(item.path))conflicts.push(item.path);
     continue;
    }
    changes.push({...item,before});
   }
   const id=crypto.randomUUID(),backupDir=path.join(this.dataDir,'upgrades',id);
   if(changes.length){await assertOrdinaryPath(backupDir);await fs.mkdir(backupDir,{recursive:true});await atomicJson(path.join(backupDir,'journal.json'),{changes,profile,createdAt:new Date().toISOString()});}
   const updatedFiles=new Map(profile.files.map(f=>[f.path,f]));
   for(const [index,item] of changes.entries()){
    await assertOrdinaryPath(item.path);const current=await fs.readFile(item.path,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(current!==item.before)throw new Error('A file changed during upgrade. Retry after reviewing it.');
    const backup=item.before===null?null:path.join(backupDir,index+'.bak');if(backup)await fs.writeFile(backup,item.before,{flag:'wx'});
    await fs.mkdir(path.dirname(item.path),{recursive:true});
    if(item.before===null)await fs.writeFile(item.path,item.content,{flag:'wx'});
    else{const tmp=item.path+'.'+id+'.tmp';try{await fs.writeFile(tmp,item.content,{flag:'wx'});if(await fs.readFile(item.path,'utf8')!==item.before)throw new Error('File changed during upgrade.');await fs.rename(tmp,item.path);}finally{await fs.rm(tmp,{force:true});}}
    applied.push(item);
    const owned=updatedFiles.get(item.path);
    let restore=owned?.backup||null;
    if(item.kind==='rule'){
     restore=path.join(backupDir,index+'-without-claudian.md');
     await fs.writeFile(restore,item.content.replace(/\r?\n?<!-- claudian:memory:start -->[\s\S]*?<!-- claudian:memory:end -->\r?\n?/,''),{flag:'wx'});
    }
    updatedFiles.set(item.path,{...owned,path:item.path,type:item.kind,hash:hash(item.content),backup:restore});
   }
   if(JSON.stringify(await json(this.configFile))!==JSON.stringify(profile))throw new Error('Profile changed during upgrade.');
   await atomicJson(this.configFile,{...profile,files:[...updatedFiles.values()],protocolVersion:repairHost||conflicts.length?profile.protocolVersion:policy.VERSION,migration:repairHost?profile.migration:{target:policy.VERSION,conflicts,backup:changes.length?backupDir:null}});
   return {changed:changes.length,conflicts};
  }catch(e){for(const item of applied.reverse()){const current=await fs.readFile(item.path,'utf8').catch(()=>null);if(current===item.content){if(item.before===null)await fs.unlink(item.path);else await fs.writeFile(item.path,item.before);}}throw e;}finally{this.running=false;}
 };
};
