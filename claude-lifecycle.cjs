'use strict';
const path=require('node:path');
const quote=value=>"'"+value.replace(/'/g,"''")+"'";
function command({exe,script,dataDir}) {
  return `$ProgressPreference='SilentlyContinue'; $env:ELECTRON_RUN_AS_NODE='1'; $OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::In.ReadToEnd() | & ${quote(exe)} ${quote(script)} ${quote(dataDir)}`;
}
function merge(previous,options) {
  const config=previous?JSON.parse(previous):{};
  if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid Claude settings; preserved.');
  if(config.disableAllHooks===true)throw Error('Claude hooks are disabled. Enable hooks before installing continuous memory.');
  const hooks={...(config.hooks||{})},cmd=command(options);
  for(const event of ['UserPromptSubmit','Stop','PostToolUse']) {
    const groups=hooks[event]||[];
    if(!Array.isArray(groups))throw Error('Invalid Claude hook list; preserved.');
    if(groups.some(g=>g.hooks?.some(h=>h.command===cmd)))continue;
    if(groups.some(g=>g.hooks?.some(h=>h.command?.includes('memory-hook.cjs'))))throw Error('Another Claudian lifecycle hook exists. Reconcile it before connecting a second vault.');
    hooks[event]=[...groups,{hooks:[{type:'command',shell:'powershell',command:cmd,timeout:15}]}];
  }
  const permissions={...(config.permissions||{})};
  const names=require('./memory-capabilities.cjs').capabilities('',null).filter(c=>c.scope==='read'||options.access==='write').map(c=>'mcp__claudian__'+c.name);
  permissions.allow=[...new Set([...(permissions.allow||[]),...names])];
  return JSON.stringify({...config,hooks,permissions},null,2)+'\n';
}
function revoke(previous,cmd) {
  const config=JSON.parse(previous),hooks={...(config.hooks||{})};
  for(const event of ['UserPromptSubmit','Stop','PostToolUse'])if(Array.isArray(hooks[event])){
    hooks[event]=hooks[event].map(g=>({...g,hooks:g.hooks.filter(h=>h.command!==cmd)})).filter(g=>g.hooks.length);
    if(!hooks[event].length)delete hooks[event];
  }
  const permissions={...(config.permissions||{})};
  permissions.allow=(permissions.allow||[]).filter(s=>!s.startsWith('mcp__claudian__'));
  return JSON.stringify({...config,hooks,permissions},null,2)+'\n';
}
module.exports={command,merge,revoke};
