'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {random,hash}=require('./remote-auth.cjs');
const {RemoteHttp}=require('./remote-http.cjs');
const DEFAULT_RELAY='https://claudian-device-relay.boranbirtanir.workers.dev';
class RemoteConnector {
  constructor({dataDir,profile,safeStorage,fetch:request=fetch,allowLoopback=false}) {
    Object.assign(this,{dataDir,profile,safeStorage,request,allowLoopback});
    this.file=path.join(dataDir,'remote-device.json');this.state={enabled:false};this.connection='stopped';this.lastError=null;this.controller=null;
  }
  async load() {
    try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(this.state.enabled)await this.start(this.state.relay).catch(e=>{this.connection='offline';this.lastError=e.message;});
    return this;
  }
  async save() {
    await fs.mkdir(this.dataDir,{recursive:true});
    const tmp=this.file+'.'+random()+'.tmp';
    try{await fs.writeFile(tmp,JSON.stringify(this.state),{flag:'wx',mode:0o600});await fs.rename(tmp,this.file);}finally{await fs.rm(tmp,{force:true});}
  }
  relayUrl(value) {
    let url;try{url=new URL(value);}catch{throw Error('No relay service is configured. Use the local Claude Desktop extension, or enter the address supplied by your Claudian service administrator.');}
    if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(this.allowLoopback&&url.protocol==='http:'&&url.hostname==='127.0.0.1')))throw Error('A trusted HTTPS relay URL is required.');
    return url.href.replace(/\/$/,'');
  }
  async start(value=DEFAULT_RELAY) {
    if(this.controller)throw Error('Disconnect the current relay before changing it.');
    const relay=this.relayUrl(value),profile=await this.profile();
    if(!profile?.vault)throw Error('Select your vault in Claudian first.');
    await fs.access(profile.vault);
    if(!this.safeStorage.isEncryptionAvailable())throw Error('Operating system credential protection is unavailable.');
    const health=await this.request(relay+'/health',{redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!health.ok||(await health.json()).service!=='claudian-device-relay')throw Error('Claudian relay did not answer.');
    // The device key is never stored in plaintext and never passed on a command line.
    const secret=this.state.credential?this.safeStorage.decryptString(Buffer.from(this.state.credential,'base64')):random();
    if(this.state.relay&&this.state.relay!==relay&&this.state.credential)throw Error('Revoke the existing device before changing its relay.');
    this.state={...this.state,relay,device:hash(secret),credential:this.safeStorage.encryptString(secret).toString('base64'),enabled:true};
    this.http=await new RemoteHttp({dataDir:this.dataDir,profile:this.profile,base:relay+'/d/'+this.state.device}).load();
    const connected=await this.request(this.http.auth.base+'/__device/connect',{method:'POST',headers:{authorization:'Bearer '+secret},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!connected.ok)throw Error('Device registration failed: '+connected.status);
    await this.save();
    this.controller=new AbortController();this.connection='connecting';this.lastError=null;
    const controller=this.controller;
    this.running=this.run(secret,controller).finally(()=>{if(this.controller===controller)this.controller=null;});
    return this.status();
  }
  async run(secret,controller) {
    const headers={authorization:'Bearer '+secret,'content-type':'application/json'};
    const endpoint=this.state.relay+'/d/'+this.state.device;
    while(!controller.signal.aborted) {
      try {
        const poll=await this.request(endpoint+'/__device/poll',{method:'POST',headers,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
        if(!poll.ok)throw Error('Relay response: '+poll.status);
        const value=await poll.json();
        if(!Array.isArray(value.requests)||value.requests.length>8)throw Error('Invalid relay response');
        this.connection='online';this.lastError=null;
        await Promise.all(value.requests.map(async req=>{
          if(typeof req.id!=='string')return;
          const response=await this.http.handle(req);
          const sent=await this.request(endpoint+'/__device/reply',{method:'POST',headers,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),body:JSON.stringify({id:req.id,...response})});
          if(!sent.ok&&sent.status!==410)throw Error('Relay delivery failed: '+sent.status);
        }));
      }catch(e){
        if(controller.signal.aborted)break;
        this.connection='offline';this.lastError=e.message;
        await new Promise(resolve=>{const end=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',end);resolve();};const timer=setTimeout(end,3000);controller.signal.addEventListener('abort',end,{once:true});});
      }
    }
  }
  async stop({persist=true}={}) {
    this.controller?.abort();await this.running;this.controller=null;this.connection='stopped';
    if(persist){this.state.enabled=false;await this.save();}
    return this.status();
  }
  status() { return {state:this.connection,relay:this.state.relay||'',lastError:this.lastError,enabled:this.state.enabled,urls:this.http?Object.fromEntries(['chatgpt','claude-desktop','gemini','perplexity'].map(h=>[h,this.http.auth.resource(h)])):{},requests:this.http?.auth.requests()||[],grants:this.http?.auth.grants()||[]}; }
  async approve(id,allowed) {if(!this.http)throw Error('Remote connection is stopped');await this.http.auth.approve(id,allowed);return this.status();}
  async revoke(id) {if(!this.http)throw Error('Remote connection is stopped');await this.http.auth.revoke(id);return this.status();}
}
module.exports={RemoteConnector};
