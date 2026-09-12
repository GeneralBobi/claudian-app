'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');const policy=require('./policy.cjs');
module.exports=(Setup,{hash,assertOrdinaryPath,json,atomicJson})=>{
 Setup.prototype.upgrade=async function(repairHost,options={}){
  if(this.running)throw new Error('Please wait for the current operation.');
  this.running=true;const applied=[];
  try{
   const profile=await json(this.configFile);if(!profile)return {changed:0,conflicts:[]};
   if(repairHost&&!profile.hosts.some(h=>h.id===repairHost))throw new Error('Connection not found.');
   const desired=new Map(),conflicts=[],roles=['Claudian Home.md'],updatedHosts=new Map(profile.hosts.map(h=>[h.id,h]));
   const add=(file,content,kind,force=false)=>desired.set(file,{path:file,content,kind,force});
   if(!repairHost){
    add(path.join(profile.vault,'Claudian Universal Protocol.md'),policy.protocol(profile.language),'note');
    // Starter content belongs to the user after setup. Upgrades only fill missing notes.
    for(const [name,content] of Object.entries(require('./welcome.cjs').skeleton(profile.language,profile.name))){
      const file=path.join(profile.vault,name);await assertOrdinaryPath(file);
      try{await fs.access(file);}catch(e){if(e.code!=='ENOENT')throw e;add(file,content,'note');}
    }
    for(const name of policy.MANAGED_PROTOCOLS.filter(n=>n!=='Claudian Universal Protocol.md'))if(profile.files.some(f=>f.path===path.join(profile.vault,name)))add(path.join(profile.vault,name),policy.protocol(profile.language,name),'note');
   }
   for(const host of profile.hosts.filter(h=>!repairHost||h.id===repairHost)){
    const files=await this.hostPaths(profile,host.id);
    try {
      const connector=await require('./connector-upgrade.cjs').plan(this,profile,host);
      for(const item of connector.files)desired.set(item.path,{...item,mergeSafe:true});
      updatedHosts.set(host.id,{...host,artifacts:connector.artifacts});
    }catch(error){conflicts.push(host.id+': '+error.message);}
   // MCP ile baglanan konaklarin skill dosyasi ve baslangic kurali YOKTUR; yetenekleri
   // adlariyla cagrilir. Burada onlari atlamamak, yukseltmenin tamamini patlatiyordu --
   // yani tek bir MCP baglantisi eklemek, butun kurulumun protokol guncellemesini
   // kiriyordu. Olculdu 12.09.2026, gercek bir profilde.
   if(!files.skill)continue;
    add(files.skill,policy.skill(profile.vault,roles,profile.language).replace('name: claudian-memory',files.skill.includes('claudian-memory-bridge')?'name: claudian-memory-bridge':'name: claudian-memory'),'skill',!!repairHost);
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
    // Deleting a vault protocol copy is allowed; the application/skill still supplies it.
    if(before===null&&owned&&item.kind==='note'&&policy.MANAGED_PROTOCOLS.includes(path.basename(item.path))&&!options.restoreMissingProtocols)continue;
    if(item.mergeSafe && before!==item.before)throw Error("Connector changed while preparing upgrade.");
    if(before!==null&&!item.mergeSafe&&(!owned||(!item.force&&owned.hash!==hash(before)))){
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
    // What removal should put back depends on whether the file existed before Claudian.
    //
    // If it pre-existed, the user's own edits must survive, so the restore copy is the
    // current content minus our block. If WE created it, there is nothing to put back and
    // restore stays null, which makes removal delete the file.
    //
    // Writing the stripped copy unconditionally was a trap: a rule file this app created --
    // Cursor's .mdc, which we open with our own front matter -- came back after removal as
    // a husk holding only that front matter. The next install then found a startup rule with
    // no Claudian marker and refused to continue, blaming the user for a file we left behind.
    if(item.kind==='rule'&&owned?.backup){
     restore=path.join(backupDir,index+'-without-claudian.md');
     await fs.writeFile(restore,item.content.replace(/\r?\n?<!-- claudian:memory:start -->[\s\S]*?<!-- claudian:memory:end -->\r?\n?/,''),{flag:'wx'});
    }
    updatedFiles.set(item.path,{...owned,path:item.path,type:item.kind,host:item.host||owned?.host,hash:hash(item.content),backup:restore});
   }
   if(JSON.stringify(await json(this.configFile))!==JSON.stringify(profile))throw new Error('Profile changed during upgrade.');
   await atomicJson(this.configFile,{...profile,hosts:[...updatedHosts.values()],files:[...updatedFiles.values()],protocolVersion:repairHost||conflicts.length?profile.protocolVersion:policy.VERSION,migration:repairHost?profile.migration:{target:policy.VERSION,conflicts,backup:changes.length?backupDir:null}});
   // The recorded version is a claim about the disk, so verify it against the disk.
   // Measured 11.09.2026 on a real profile: protocolVersion said 2.1.0 while all three
   // protocol files still carried 2.0.0, and every later launch believed it was current.
   const stale=[];
   for(const name of policy.MANAGED_PROTOCOLS){
    const expected=policy.protocol(profile.language,name);
    const target=path.join(profile.vault,name);
    if(!profile.files.some(f=>f.path===target))continue;
    const current=await fs.readFile(target,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(current!==null&&current!==expected)stale.push(target);
   }
   if(stale.length&&!repairHost){
    const recorded=await json(this.configFile);
    await atomicJson(this.configFile,{...recorded,protocolVersion:profile.protocolVersion,migration:{target:policy.VERSION,conflicts:[...new Set([...conflicts,...stale])],backup:recorded.migration?.backup??null}});
   }
   return {changed:changes.length,conflicts:[...new Set([...conflicts,...stale])]};
  }catch(e){for(const item of applied.reverse()){const current=await fs.readFile(item.path,'utf8').catch(()=>null);if(current===item.content){if(item.before===null)await fs.unlink(item.path);else await fs.writeFile(item.path,item.before);}}throw e;}finally{this.running=false;}
 };
};
