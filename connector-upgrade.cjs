'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const store=require('./memory-store.cjs');
const mcp=require('./mcp-hosts.cjs');
async function plan(setup,profile,host){
 if(!['claude-code','codex','claude-desktop','cursor','gemini-cli'].includes(host.id))return {files:[],artifacts:host.artifacts};
 const files=[],artifacts={...(host.artifacts||{})};
 const read=async file=>{await store.ordinary(file);return fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});};
 const add=(file,before,content,kind)=>{if(content!==before)files.push({path:file,before,content,kind,host:host.id});};
 const entry=mcp.serverEntry({exe:setup.launcher,script:setup.mcpScript,dataDir:setup.dataDir});
 if(host.id!=='claude-desktop')entry.env.CLAUDIAN_HOST=host.id;
 if(host.id==='cursor')entry.type='stdio';
 artifacts.server='claudian';
 artifacts.capabilities=require('./memory-capabilities.cjs').capabilities(profile.vault,null).filter(c=>c.scope==='read'||profile.access==='write').map(c=>c.name);
 const options={exe:setup.launcher,script:path.join(path.dirname(setup.mcpScript),'memory-hook.cjs'),dataDir:setup.dataDir,access:profile.access==='write'?'write':'read'};
 if(host.id==='codex'){
  const connector=require('./codex-connector.cjs'),file=path.join(setup.codexHome,'config.toml'),before=await read(file);
  add(file,before,connector.grant(before,entry),'grant');
  const hookFile=path.join(setup.codexHome,'hooks.json'),old=await read(hookFile);
  let base=old;
  if(artifacts.hookCommand && old){
   const parsed=JSON.parse(old);
   for(const event of Object.keys(parsed.hooks||{}))parsed.hooks[event]=parsed.hooks[event].map(g=>({...g,hooks:g.hooks.filter(h=>h.command!==artifacts.hookCommand)})).filter(g=>g.hooks.length);
   base=JSON.stringify(parsed);
  }
  const hook=connector.hooks(base,options);add(hookFile,old,hook.content,'hooks');
  Object.assign(artifacts,{config:file,hooks:hookFile,hookCommand:hook.command,hookTrust:'requires-host-review'});
 }else{
  const file=host.id==='claude-code'?path.join(setup.home,'.claude.json'):host.id==='cursor'?path.join(setup.home,'.cursor','mcp.json'):host.id==='gemini-cli'?path.join(setup.home,'.gemini','settings.json'):mcp.configFile(setup.home),before=await read(file);
  let base=before;
  if(before&&artifacts.mcpEntry){
   const current=JSON.parse(before).mcpServers?.claudian;
   if(current&&JSON.stringify(current)!==JSON.stringify(entry))base=mcp.mcpRevoke(before,artifacts.mcpEntry);
  }
  const granted=mcp.mcpGrant(base,entry);add(file,before,granted.content||base,['claude-desktop','gemini-cli'].includes(host.id)?'grant':'mcp');
  Object.assign(artifacts,{config:file,mcpEntry:entry,server:'claudian'});
  if(host.id==='claude-code'){
   const lifecycle=require('./claude-lifecycle.cjs'),hookFile=path.join(setup.home,'.claude/settings.json'),old=await read(hookFile);
   const base=old&&artifacts.hookCommand?lifecycle.revoke(old,artifacts.hookCommand):old;
   add(hookFile,old,lifecycle.merge(base,options),'grant');
   Object.assign(artifacts,{hooks:hookFile,hookCommand:lifecycle.command(options)});
  }
 }
 return {files,artifacts};
}
module.exports={plan};
