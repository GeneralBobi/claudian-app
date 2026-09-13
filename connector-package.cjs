'use strict';
// Generate provider packages from the SAME application protocol. No personal
// vault notes, personas, credentials or second policy implementation are bundled.
const fs=require('node:fs/promises'),path=require('node:path');
const policy=require('./policy.cjs');
const {random}=require('./remote-auth.cjs');
const json=value=>JSON.stringify(value,null,2)+'\n';
function entries({provider,url,language='en',version=require('./package.json').version}) {
  if(!['chatgpt','claude-desktop'].includes(provider))throw Error('Unsupported provider');
  const endpoint=new URL(url);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('An HTTPS MCP endpoint is required');
  const name='claudian-memory';
  const skill=`---\nname: claudian-memory\ndescription: Use the connected Claudian shared memory at conversation start, including greetings, and maintain durable notes throughout the conversation.\n---\n# Claudian memory\n\n${require('./memory-runtime.cjs').instructionsFor(language)}\n\nUse the Claudian connector's startup_context to resolve the selected vault and read the user's customizations. Do not guess a local path. Read the adapter for this AI if present. Use begin_memory_turn once per user turn, reuse its session_id throughout this conversation, and finish maintenance with memory_review. These are the same tools and policy used by the desktop application. If the connector is missing or access fails, say so briefly; a skill cannot grant access. Never claim this preference was stored in the provider's own memory unless that provider confirms it.\n\n${policy.protocol(language)}`;
  const files={'skills/claudian-memory/SKILL.md':skill,'.mcp.json':json({mcpServers:{claudian:{type:'http',url}}})};
  if(provider==='claude-desktop')files['.claude-plugin/plugin.json']=json({name,version,description:'Shared memory using your Claudian device connection',author:{name:'Claudian'}});
  else files['.codex-plugin/plugin.json']=json({name,version,description:'Shared memory using your Claudian device connection',author:{name:'Claudian'},skills:'./skills/',mcpServers:'./.mcp.json',interface:{displayName:'Claudian Core',shortDescription:'Shared memory across your AI conversations',longDescription:'Use your selected Claudian vault through an authorized device connection. The same application protocol guides reading, writing and memory maintenance.',developerName:'Claudian',category:'Productivity',capabilities:[],defaultPrompt:'Use my connected Claudian memory.'}});
  return files;
}
// ZIP STORE: no extra runtime or shell interpolation required in the installed app.
function zip(files) {
  const parts=[],central=[];let offset=0;
  const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
  for(const [name,text]of Object.entries(files)) {
    const n=Buffer.from(name),data=Buffer.from(text),c=crc(data),local=Buffer.alloc(30),dir=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(c,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);
    dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(0x800,8);dir.writeUInt16LE(33,14);dir.writeUInt32LE(c,16);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);
    parts.push(local,n,data);central.push(dir,n);offset+=local.length+n.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,directory,end]);
}
async function write(directory,options) {
  const files=entries(options),output=path.join(directory,'claudian-'+options.provider+'-'+random().slice(0,8)),folder=path.join(output,'claudian-memory');
  await fs.mkdir(folder,{recursive:true});
  for(const [name,body]of Object.entries(files)){const target=path.join(folder,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,body,{flag:'wx'});}
  const archive=path.join(output,'claudian-memory'+(options.provider==='claude-desktop'?'.plugin':'.zip'));await fs.writeFile(archive,zip(files),{flag:'wx'});
  return {archive,folder,files:Object.keys(files)};
}
function desktopEntries({launcher,mcpScript,dataDir,version=require('./package.json').version,language='en'}) {
  for(const value of [launcher,mcpScript,dataDir])if(typeof value!=='string'||!path.isAbsolute(value)||/[\x00-\x1f]/.test(value))throw Error('Absolute installation paths are required');
  const manifest={manifest_version:'0.3',name:'claudian-memory',display_name:'Claudian Core',version,
    description:language==='tr'?'Claudian uygulamasında seçtiğin ortak hafızayı kullanır.':'Use the shared memory selected in your Claudian application.',
    author:{name:'Claudian'},tools_generated:true,compatibility:{platforms:['win32']},
    server:{type:'node',entry_point:'server.cjs',mcp_config:{command:'node',args:['${__dirname}/server.cjs']}}};
  const server=`'use strict';
const {spawn}=require('node:child_process');
const config=require('./installation.json');
const child=spawn(config.launcher,[config.mcpScript],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',CLAUDIAN_DATA:config.dataDir,CLAUDIAN_HOST:'claude-desktop'}});
process.stdin.pipe(child.stdin);child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
child.stdin.on('error',()=>{});
child.on('error',()=>{process.stderr.write('Claudian could not start. Repair its desktop connection in Claudian.\\n');process.exitCode=1;process.stdin.destroy();});
child.on('exit',code=>{process.exitCode=code??1;process.stdin.destroy();});
process.stdin.on('end',()=>child.kill());
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill();process.exit(0);});
`;
  return {'manifest.json':json(manifest),'server.cjs':server,'installation.json':json({launcher,mcpScript,dataDir})};
}
async function writeDesktop(directory,options) {
  const files=desktopEntries(options);
  await fs.mkdir(directory,{recursive:true});
  const archive=path.join(directory,'claudian-memory-'+random().slice(0,8)+'.mcpb');
  await fs.writeFile(archive,zip(files),{flag:'wx'});
  return {archive,files:Object.keys(files)};
}
module.exports={entries,zip,write,desktopEntries,writeDesktop};

// Only an enabled extension bound to this installation is current.
module.exports.desktopStatus=async(home,dataDir,installation)=>{
 const root=path.dirname(require('./mcp-hosts.cjs').configFile(home));
 const dirs=await fs.readdir(path.join(root,'Claude Extensions'),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
 for(const dir of dirs.filter(e=>e.isDirectory())){
  const base=path.join(root,'Claude Extensions',dir.name);
  try{
   const manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'));
   if(manifest.name!=='claudian-memory')continue;
   const config=JSON.parse(await fs.readFile(path.join(base,'installation.json'),'utf8'));
   const settings=JSON.parse(await fs.readFile(path.join(root,'Claude Extensions Settings',dir.name+'.json'),'utf8'));
   const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
   const wrapper=await fs.readFile(path.join(base,'server.cjs'),'utf8');
   const expected=desktopEntries({...config})['server.cjs'];
   if(same(config.dataDir,dataDir)&&(!installation||(same(config.launcher,installation.launcher)&&same(config.mcpScript,installation.mcpScript)))&&wrapper===expected)return {current:settings.isEnabled===true,installed:true,enabled:settings.isEnabled===true,version:manifest.version};
  }catch{}
 }
 return {current:false};
};

// Official Claude custom connector install link; it only prefills, never grants access.
module.exports.providerLink=(provider,endpoint)=>{
 if(require('./web-providers.cjs').isWeb(provider))return require('./web-providers.cjs').providers[provider].setup;
 if(provider==='chatgpt')return 'https://chatgpt.com/plugins';
 if(provider!=='claude-desktop')throw Error('Unknown provider');
 const url=new URL('https://claude.ai/customize/connectors');
 url.search=new URLSearchParams({modal:'add-custom-connector',connectorName:'Claudian',connectorUrl:endpoint}).toString();
 return url.href;
};
module.exports.setupHelp=(provider,endpoint)=>require('./web-providers.cjs').isWeb(provider)?require('./web-providers.cjs').guide(provider,endpoint):`Help me connect my Claudian memory to ${provider==='chatgpt'?'ChatGPT':'Claude'}. This is a setup task I requested.
Name: Claudian — This device
MCP server URL: ${endpoint}
Authentication: OAuth (do not request or paste an API key).
This is my device connection, not the old https://claudian.app/api/mcp service. Keep my existing connections and notes. Reuse an existing connection if its URL matches; do not duplicate it.
If you have browser/computer tools, open the provider's connection setup and fill the name, URL and OAuth fields. Otherwise guide me one screen and one action at a time, based on what I see. Do not claim to have operated the UI without tools.
In ChatGPT the current entry is Plugins → Create app; some versions use Settings → Apps → Developer mode. In Claude use ${provider==='claude-desktop'?module.exports.providerLink(provider,endpoint):'Settings → Connectors'}.
When the provider asks for permission, show what access is requested. Compare the pairing code with Claudian's AI connections screen and follow the applicable approval rules. Claudian and this computer must remain running.
After connecting, help me run the connection test from Claudian and report only actual tool results. A copied instruction or sign-in page is not proof of read/write access. Do not ask profile, project or preference questions. Never ask me to send passwords or authentication tokens in chat.`;
