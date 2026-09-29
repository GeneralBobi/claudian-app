'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {random,hash}=require('./remote-auth.cjs');
const {RemoteHttp}=require('./remote-http.cjs');
// 1.1.0 (madde 9): the first relay address was a workers.dev name that carried a person's name. It and relay.claudian.app
// are the same relay worker and the same device mailbox. A device registered under the old name moves to the new address
// for its own polling and for every new connection; the old address keeps answering, as itself, for the connectors an AI
// app added under it (their grants, tokens and OAuth metadata stay bound to the old address). Retiring the old address
// is a separate, later step, taken only after those connectors have been re-added.
const RELAY_ALIASES={'https://claudian-device-relay.boranbirtanir.workers.dev':'https://relay.claudian.app'};
// 1.8.0: the one address every user adds to an AI app; it forwards to this device and stores no content.
const GATEWAY='https://mcp.claudian.app';
class RemoteConnector {
  constructor({dataDir,profile,safeStorage,fetch:request=fetch,allowLoopback=false}) {
    Object.assign(this,{dataDir,profile,safeStorage,request,allowLoopback});
    this.file=path.join(dataDir,'remote-device.json');this.state={enabled:false};this.connection='stopped';this.lastError=null;this.controller=null;this.attempt=0;
  }
  async load() {
    try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const moved=RELAY_ALIASES[this.state.relay];
    if(moved){this.state={...this.state,relay:moved,previousRelay:this.state.relay};await this.save();}
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
  async start(value=this.state.relay) {
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
    this.http=await new RemoteHttp({dataDir:this.dataDir,profile:this.profile,base:relay+'/d/'+this.state.device,
      previousBase:this.state.previousRelay?this.state.previousRelay+'/d/'+this.state.device:null}).load();
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
        this.connection='online';this.lastError=null;this.attempt=0;
        await Promise.all(value.requests.map(async req=>{
          if(typeof req.id!=='string')return;
          const response=await this.http.handle(req);
          const sent=await this.request(endpoint+'/__device/reply',{method:'POST',headers,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),body:JSON.stringify({id:req.id,...response})});
          if(!sent.ok&&sent.status!==410)throw Error('Relay delivery failed: '+sent.status);
        }));
      }catch(e){
        if(controller.signal.aborted)break;
        this.connection='offline';this.lastError=e.message;
        // A fixed retry interval synchronises every device in the field: when the relay comes
        // back they all reconnect on the same beat. Back off, and spread the herd with jitter.
        const wait=this.backoff();
        await new Promise(resolve=>{const end=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',end);resolve();};const timer=setTimeout(end,wait);controller.signal.addEventListener('abort',end,{once:true});});
      }
    }
  }
  // 3s, 6s, 12s ... capped at 60s, each with up to +-25% jitter. The cap keeps a device that
  // has been offline for hours from taking minutes to notice the relay is back.
  backoff() {
    const step=Math.min(3000*2**this.attempt++,60000);
    return Math.round(step*(0.75+Math.random()*0.5));
  }
  async stop({persist=true}={}) {
    this.controller?.abort();await this.running;this.controller=null;this.connection='stopped';this.attempt=0;
    if(persist){this.state.enabled=false;await this.save();}
    return this.status();
  }
  status() {
    const s={state:this.connection,relay:this.state.relay||'',lastError:this.lastError,enabled:this.state.enabled,urls:this.http?Object.fromEntries(['chatgpt','claude-desktop','gemini','perplexity'].map(h=>[h,this.http.auth.resource(h)])):{},requests:this.http?.auth.requests()||[],grants:this.http?.auth.grants()||[]};
    s.progress=Object.fromEntries(['chatgpt','gemini','perplexity'].map(h=>[h,require('./cloud-progress.cjs').progress(s,h)]));return s;
  }
  async approve(id,allowed) {if(!this.http)throw Error('Remote connection is stopped');await this.http.auth.approve(id,allowed);return this.status();}
  /* 1.8.0 · the shared address mcp.claudian.app (planning/PUBLIC-GATEWAY.md, section 3). The AI app's browser page shows a
     code; the user types it here. The device proves itself with its key (the gateway checks sha256(key) = device id,
     like the relay), sees who is asking, and decides. On approval the device mints the authorization code itself. */
  secretKey() {
    if(!this.state.credential||!this.state.device)throw Error('Uzak bağlantı açık değil: önce Bağlantılar\'dan bir AI bağla.');
    return this.safeStorage.decryptString(Buffer.from(this.state.credential,'base64'));
  }
  async gatewayCall(gateway,pathname,body) {
    const r=await this.request(gateway.replace(/\/$/,'')+pathname,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{authorization:'Bearer '+this.secretKey(),'content-type':'application/json'},body:JSON.stringify({cihaz:this.state.device,...body})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(j.hata||`mcp.claudian.app ${r.status}`);
    return j;
  }
  async gatewayClaim(code,gateway=GATEWAY) {
    if(!this.http)throw Error('Uzak bağlantı kapalı: önce Bağlantılar\'dan bir AI bağla.');
    const clean=String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(clean.length!==8)throw Error('Kod 8 karakter olmalı.');
    const t=await this.gatewayCall(gateway,'/v1/sahiplen',{kod:clean});
    (this.gatewayPending||=new Map()).set(t.talep,{...t,gateway,expires:Date.now()+300000});
    // The app's name is its own claim; the redirect host is what the gateway checked.
    return {talep:t.talep,ad:t.ad,yonlendirme:t.yonlendirme,kapsam:t.kapsam,host:t.host};
  }
  async gatewayDecide(talep,allowed,host) {
    const t=this.gatewayPending?.get(talep);
    if(!t||t.expires<Date.now())throw Error('İstek süresi doldu; AI uygulamasında yeniden bağlan.');
    this.gatewayPending.delete(talep);
    if(!allowed){await this.gatewayCall(t.gateway,'/v1/onay',{talep,red:true});return this.status();}
    const r=await this.http.primary.approveGateway({gateway:t.gateway,name:t.ad,host:host||t.host,scope:t.kapsam,challenge:t.challenge});
    await this.gatewayCall(t.gateway,'/v1/onay',{talep,kod:r.code,istemci:r.client_id,kaynak:r.resource,host:host||t.host});
    return this.status();
  }
  async revoke(id) {if(!this.http)throw Error('Remote connection is stopped');await this.http.auth.revoke(id);return this.status();}
  // "Remove everything" (0.29): every AI loses its grant, then the device stops polling. The
  // grants file is read even when the connection is stopped, so a stopped device is not left
  // with live tokens that would work again on the next start.
  async resetAll() {
    let revoked=0;
    const http=this.http||(this.state.device?await new RemoteHttp({dataDir:this.dataDir,profile:this.profile,base:(this.state.relay||'https://relay.invalid')+'/d/'+this.state.device}).load():null);
    if(http)for(const g of http.auth.grants())if(!g.revoked){await http.auth.revoke(g.id);revoked++;}
    await this.stop();
    return {revoked};
  }
}
RemoteConnector.RELAY_ALIASES=RELAY_ALIASES;
module.exports={RemoteConnector};
