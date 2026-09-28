'use strict';
const toml=require('smol-toml');
const start='# Claudian MCP connection start',end='# Claudian MCP connection end';
const same=(a,b)=>a===b||(typeof a==='string'&&typeof b==='string'&&/^[a-z]:[\\/]/i.test(a)&&/^[a-z]:[\\/]/i.test(b)&&require('node:path').win32.normalize(a).toLowerCase()===require('node:path').win32.normalize(b).toLowerCase());
function grant(previous,entry) {
  const config=toml.parse(previous||'');
  const desired={command:entry.command,args:entry.args,env:entry.env};
  const current=config.mcp_servers?.claudian;
  if(current) {
    if(same(current.command,desired.command)&&Array.isArray(current.args)&&current.args.length===desired.args.length&&current.args.every((arg,i)=>same(arg,desired.args[i]))&&Object.entries(desired.env).every(([k,v])=>same(current.env?.[k],v)))return previous;
    throw Error('A different Claudian Codex MCP connection exists; configuration preserved.');
  }
  if((previous||'').includes(start)||(previous||'').includes(end))throw Error('Incomplete Claudian MCP markers; configuration preserved.');
  const block=toml.stringify({mcp_servers:{claudian:desired}});
  const result=(previous||'')+'\n'+start+'\n'+block+end+'\n';
  toml.parse(result);return result;
}
function revoke(previous) {
  if(!previous.includes(start))return previous;
  if(previous.split(start).length!==2||previous.split(end).length!==2||previous.indexOf(end)<previous.indexOf(start))throw Error('Invalid Claudian MCP markers; configuration preserved.');
  const result=previous.replace(/\r?\n?# Claudian MCP connection start[\s\S]*?# Claudian MCP connection end\r?\n?/,'');
  toml.parse(result);return result;
}
function hooks(previous,options) {
  const config=previous?JSON.parse(previous):{};
  if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid Codex hooks; preserved.');
  const command=require('./claude-lifecycle.cjs').command(options)+' codex';
  const encoded='powershell.exe -NoProfile -EncodedCommand '+Buffer.from(command,'utf16le').toString('base64');
  const hooks={...(config.hooks||{})};
  for(const event of ['UserPromptSubmit','Stop','PostToolUse']){
    const groups=hooks[event]||[];
    if(!Array.isArray(groups))throw Error('Invalid Codex hook list; preserved.');
    if(!groups.some(g=>g.hooks?.some(h=>h.command===encoded)))hooks[event]=[...groups,{hooks:[{type:'command',command:encoded,timeout:15}]}];
  }
  return {content:JSON.stringify({...config,hooks},null,2)+'\n',command:encoded};
}
module.exports={grant,revoke,hooks};
