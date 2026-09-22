'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn, execFile} = require('node:child_process');

// Credentials belong to this OS user, never to the installation or checkout.
class SecureTunnel {
  constructor({dataDir, safeStorage, profile, executable=process.execPath, launch=spawn}) {
    this.dir=path.join(dataDir,'secure-tunnel'); this.dataDir=dataDir;
    this.storage=safeStorage; this.profile=profile; this.executable=executable; this.launch=launch;
    this.settings={}; this.child=null; this.phase='stopped'; this.queue=Promise.resolve();
  }
  exclusive(fn) { const next=this.queue.then(fn); this.queue=next.catch(()=>{}); return next; }
  async load() {
    try { this.settings=JSON.parse(await fs.readFile(path.join(this.dir,'settings.json'),'utf8')); }
    catch(e) { if(e.code!=='ENOENT') this.phase='configuration-error'; }
    return this;
  }
  status() {
    return {tunnelId:this.settings.tunnelId||'',binary:this.settings.binary||'',hasKey:!!this.settings.key,
      autoStart:this.settings.autoStart===true,phase:this.phase,running:!!this.child};
  }
  async inspect() {
    if(this.child){
      try{
        const url=new URL((await fs.readFile(path.join(this.dir,'health.url'),'utf8')).trim());
        if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)throw Error('Invalid health URL');
        const response=await fetch(new URL('/readyz',url),{redirect:'error',signal:AbortSignal.timeout(1500)});
        if(this.child)this.phase=response.ok?'ready':'running';
      }catch{if(this.child&&this.phase==='ready')this.phase='running';}
    }
    return this.status();
  }
  async persist(settings) {
    await fs.mkdir(this.dir,{recursive:true,mode:0o700});
    const file=path.join(this.dir,'settings.json'),temp=file+'.tmp';
    await fs.writeFile(temp,JSON.stringify(settings),{mode:0o600}); await fs.rename(temp,file);
    this.settings=settings;
  }
  save(input) { return this.exclusive(async()=>{
    if(this.child) throw Error('Stop the tunnel before changing its settings.');
    if(!this.storage.isEncryptionAvailable() || this.storage.getSelectedStorageBackend?.()==='basic_text')
      throw Error('OS encrypted storage is unavailable. No key was saved.');
    const tunnelId=String(input.tunnelId||'').trim(),binary=String(input.binary||'');
    if(!/^tunnel_[a-z0-9]{32}$/.test(tunnelId))throw Error('Enter your OpenAI tunnel ID.');
    if(!path.isAbsolute(binary)||path.basename(binary).toLowerCase()!=='tunnel-client.exe')throw Error('Select the official tunnel-client.exe.');
    if(!(await fs.stat(binary)).isFile())throw Error('Tunnel client was not found.');
    const key=String(input.apiKey||'').trim();
    if(key && (!key.startsWith('sk-') || /\s/.test(key)))throw Error('Enter the complete API key without spaces.');
    if(!key && !this.settings.key)throw Error('Enter your own API key.');
    await this.persist({tunnelId,binary,autoStart:input.autoStart===true,
      key:key?this.storage.encryptString(key).toString('base64'):this.settings.key});
    this.phase='stopped'; return this.status();
  }); }
  start() { return this.exclusive(async()=>{
    if(this.child)return this.status();
    const profile=await this.profile();
    if(!profile?.vault||!profile.hosts?.some(h=>h.id==='chatgpt'))throw Error('Select ChatGPT in Claudian connections first.');
    if(!this.settings.key||!this.storage.isEncryptionAvailable())throw Error('Save your tunnel and key first.');
    let key; try{key=this.storage.decryptString(Buffer.from(this.settings.key,'base64'));}
    catch{throw Error('This OS account cannot unlock the key. Enter it again.');}
    // Use a minimal environment: no inherited API keys, proxy settings or debug logging.
    const env={}; for(const k of ['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[k])env[k]=process.env[k];
    Object.assign(env,{CONTROL_PLANE_API_KEY:key,ELECTRON_RUN_AS_NODE:'1',CLAUDIAN_DATA:this.dataDir,CLAUDIAN_HOST:'chatgpt'});
    const quote=s=>'"'+s.replaceAll('\\','/')+'"';
    const command=quote(this.executable)+' '+quote(path.join(__dirname,'secure-tunnel-entry.cjs'));
    const config=path.join(this.dir,'runtime.json');
    const healthFile=path.join(this.dir,'health.url');await fs.rm(healthFile,{force:true});
    // JSON is valid YAML. The file contains an environment reference, never a credential.
    await fs.writeFile(config,JSON.stringify({config_version:1,control_plane:{base_url:'https://api.openai.com',tunnel_id:this.settings.tunnelId,api_key:'env:CONTROL_PLANE_API_KEY'},health:{listen_addr:'127.0.0.1:0',url_file:healthFile},admin_ui:{open_browser:false},log:{level:'error',format:'json'},mcp:{commands:[{channel:'main',command}]}}),{mode:0o600});
    this.phase='starting';
    const child=this.launch(this.settings.binary,['run','--config',config],{env,cwd:this.dir,windowsHide:true,shell:false,stdio:['ignore','ignore','ignore']});
    this.child=child;
    child.once('spawn',()=>{if(this.child===child)this.phase='running';});
    child.once('error',()=>{if(this.child===child){this.child=null;this.phase='failed';}});
    child.once('exit',code=>{if(this.child===child){this.child=null;this.phase=code===0?'stopped':'failed';}});
    return this.status();
  }); }
  stop() { return this.exclusive(async()=>{
    const child=this.child;
    if(child){
      if(process.platform==='win32'&&child.pid)await new Promise((resolve,reject)=>execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},error=>{
        if(error&&child.exitCode===null)reject(Error('Could not stop the tunnel.'));else resolve();
      }));
      else child.kill();
      this.child=null;
    }
    this.phase='stopped';return this.status();
  }); }
  async forget(){await this.stop();return this.exclusive(async()=>{await this.persist({});return this.status();});}
}
module.exports={SecureTunnel};
