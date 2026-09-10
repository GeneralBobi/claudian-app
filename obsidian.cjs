'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
exports.register=async(registryFile,vault,{running=false,assertPath=async()=>{}}={})=>{
 await assertPath(registryFile);
 const before=await fs.readFile(registryFile,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 const registry=before===null?{}:JSON.parse(before);
 const norm=p=>path.resolve(p).replace(/[\\/]+$/,'').toLowerCase();
 const existing=Object.entries(registry.vaults||{}).find(([,v])=>v.path&&norm(v.path)===norm(vault));
 if(existing)return {id:existing[0],registered:true};
 if(running)return {needsClose:true,registered:false};
 const id=crypto.randomBytes(8).toString('hex');
 registry.vaults={...(registry.vaults||{}),[id]:{path:path.resolve(vault),ts:Date.now(),open:true}};
 await fs.mkdir(path.dirname(registryFile),{recursive:true});
 if(before!==null)await fs.writeFile(registryFile+'.claudian-'+Date.now()+'.bak',before,{flag:'wx'});
 const tmp=registryFile+'.'+crypto.randomUUID()+'.tmp';
 try{
  await fs.writeFile(tmp,JSON.stringify(registry),{flag:'wx'});
  const current=await fs.readFile(registryFile,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(current!==before)throw new Error('Obsidian settings changed. Close Obsidian and retry.');
  await fs.rename(tmp,registryFile);
 }finally{await fs.rm(tmp,{force:true});}
 return {id,registered:true};
};
