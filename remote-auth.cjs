'use strict';
// OAuth grants belong to this device, the selected vault and one AI surface.
// Only hashes of bearer credentials are persisted. Browser requests cannot approve
// themselves: approval is an operation of the local desktop application.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const scopes = ['claudian.read', 'claudian.write'];
// offline_access is a refresh signal, not an access right. It is advertised and accepted so
// that a client asking for it is not rejected with invalid_scope, but it is stripped before
// any permission decision and never stored on a grant.
const OFFLINE = 'offline_access';
const advertised = [...scopes, OFFLINE];
const hosts = ['chatgpt', 'claude-desktop', 'gemini', 'perplexity'];
const fail = (message, status=400) => Object.assign(new Error(message), {status});

class RemoteAuth {
  constructor({dataDir, profile, base, now=Date.now}) {
    this.file=path.join(dataDir,'remote-grants.json'); this.profile=profile;
    this.base=base.replace(/\/$/,''); this.now=now; this.pending=new Map(); this.codes=new Map();
    this.state={clients:{},grants:{},tokens:{}}; this.tail=Promise.resolve();
  }
  async load() {
    try { this.state=JSON.parse(await fs.readFile(this.file,'utf8')); }
    catch(e) { if(e.code!=='ENOENT')throw e; }
    return this;
  }
  async exclusive(fn) {
    const next=this.tail.catch(()=>{}).then(fn); this.tail=next; return next;
  }
  async save() {
    const temp=this.file+'.'+random()+'.tmp';
    await fs.mkdir(path.dirname(this.file),{recursive:true});
    try { await fs.writeFile(temp,JSON.stringify(this.state),{flag:'wx',mode:0o600}); await fs.rename(temp,this.file); }
    finally { await fs.rm(temp,{force:true}); }
  }
  resource(host) { if(!hosts.includes(host))throw fail('Unknown AI connection'); return this.base+'/'+host+'/mcp'; }
  metadata() { return {issuer:this.base,authorization_endpoint:this.base+'/oauth/authorize',token_endpoint:this.base+'/oauth/token',registration_endpoint:this.base+'/oauth/register',revocation_endpoint:this.base+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none','client_secret_post'],scopes_supported:advertised,authorization_response_iss_parameter_supported:true}; }
  async register(input) {
    return this.exclusive(async()=>{
      if(Object.keys(this.state.clients).length>=100)throw fail('Client registration limit reached',429);
      if(!Array.isArray(input.redirect_uris)||!input.redirect_uris.length||input.redirect_uris.length>8)throw fail('redirect_uris required');
      for(const value of input.redirect_uris) {
        let u; try { u=new URL(value); } catch { throw fail('Invalid redirect URI'); }
        if(value.length>2048||u.username||u.password||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname))))throw fail('HTTPS or loopback redirect required');
      }
      const method=input.token_endpoint_auth_method||'none';
      if(!['none','client_secret_post'].includes(method))throw fail('Unsupported client authentication');
      const client_id=random(), secret=method==='none'?null:random();
      this.state.clients[client_id]={name:String(input.client_name||'AI application').slice(0,100),redirects:[...new Set(input.redirect_uris)],method,secretHash:secret&&hash(secret)};
      await this.save();
      return {client_id,...(secret?{client_secret:secret,client_secret_expires_at:0}:{}),redirect_uris:input.redirect_uris,token_endpoint_auth_method:method,grant_types:['authorization_code','refresh_token'],response_types:['code']};
    });
  }
  client(input) {
    const client=this.state.clients[input.client_id];
    if(!client)throw fail('invalid_client',401);
    if(client.secretHash&&hash(String(input.client_secret||''))!==client.secretHash)throw fail('invalid_client',401);
    return client;
  }
  clean() {
    for(const [id,p] of this.pending)if(p.expires<=this.now())this.pending.delete(id);
    for(const [id,c] of this.codes)if(c.expires<=this.now())this.codes.delete(id);
  }
  async begin(input) {
    this.clean();
    const client=this.state.clients[input.client_id];
    if(!client||!client.redirects.includes(input.redirect_uri))throw fail('Invalid client or redirect URI');
    if(input.response_type!=='code'||input.code_challenge_method!=='S256'||!/^[-_A-Za-z0-9]{43}$/.test(input.code_challenge||''))throw fail('Authorization code with S256 PKCE required');
    if(typeof input.state!=='string'||input.state.length>2048)throw fail('Invalid state');
    const host=hosts.find(h=>this.resource(h)===input.resource);
    if(!host)throw fail('invalid_target');
    const asked=[...new Set(String(input.scope||scopes[0]).split(' ').filter(Boolean))];
    if(!asked.includes(scopes[0])||asked.some(s=>!advertised.includes(s)))throw fail('invalid_scope');
    const requested=asked.filter(s=>s!==OFFLINE);
    const p=await this.profile();
    if(!p?.hosts?.some(h=>h.id===host))throw fail('Enable this AI in Claudian first',403);
    if(requested.includes(scopes[1])&&p.access!=='write')throw fail('Write access is disabled in Claudian',403);
    if(this.pending.size>=8)throw fail('Too many pending connection requests',429);
    const id=random();
    const request={id,code:crypto.randomBytes(3).toString('hex').toUpperCase(),host,clientId:input.client_id,name:client.name,redirect:input.redirect_uri,state:input.state,challenge:input.code_challenge,resource:input.resource,scope:requested.join(' '),vault:p.vault,expires:this.now()+300000,status:'pending'};
    this.pending.set(id,request); return request;
  }
  requests() { this.clean(); return [...this.pending.values()].filter(p=>p.status==='pending').map(({id,code,host,name,redirect,scope,vault,expires})=>({id,code,host,name,redirect,scope,vault,expires})); }
  async approve(id,allowed) {
    return this.exclusive(async()=>{
      this.clean(); const r=this.pending.get(id);
      if(!r||r.status!=='pending')throw fail('Connection request expired');
      if(!allowed){r.status='denied';return;}
      const p=await this.profile();
      if(p.vault!==r.vault||!p.hosts.some(h=>h.id===r.host)||(r.scope.includes(scopes[1])&&p.access!=='write'))throw fail('The selected vault or permissions changed');
      const grantId=random();
      this.state.grants[grantId]={id:grantId,host:r.host,clientId:r.clientId,name:r.name,redirect:r.redirect,resource:r.resource,scope:r.scope,vault:r.vault,authorizedAt:new Date(this.now()).toISOString(),revoked:false};
      await this.save(); r.grantId=grantId; r.status='approved';
    });
  }
  complete(id) {
    this.clean(); const r=this.pending.get(id); if(!r)throw fail('Connection request expired',410);
    if(r.status==='pending')return null;
    const url=new URL(r.redirect); url.searchParams.set('state',r.state);
    // RFC 9207: the issuer is returned on success and on failure, so a client cannot be
    // tricked into accepting a code minted by a different authorization server.
    url.searchParams.set('iss',this.base);
    if(r.status==='denied')url.searchParams.set('error','access_denied');
    else {
      const code=random();this.codes.set(hash(code),{grantId:r.grantId,clientId:r.clientId,redirect:r.redirect,challenge:r.challenge,resource:r.resource,expires:this.now()+60000});url.searchParams.set('code',code);
    }
    this.pending.delete(id); return url.href;
  }
  async validGrant(id) {
    const grant=this.state.grants[id], p=await this.profile();
    if(!grant||grant.revoked||!p||p.vault!==grant.vault||!p.hosts?.some(h=>h.id===grant.host))throw fail('invalid_token',401);
    return {grant,profile:p};
  }
  async token(input) {
    return this.exclusive(async()=>{
      this.clean(); this.client(input); let grantId;
      if(input.grant_type==='authorization_code') {
        const key=hash(String(input.code||'')), c=this.codes.get(key);
        if(!c||c.clientId!==input.client_id||c.redirect!==input.redirect_uri||c.resource!==input.resource||!/^[-._~A-Za-z0-9]{43,128}$/.test(input.code_verifier||'')||crypto.createHash('sha256').update(input.code_verifier).digest('base64url')!==c.challenge)throw fail('invalid_grant');
        this.codes.delete(key); grantId=c.grantId;
      } else if(input.grant_type==='refresh_token') {
        const key=hash(String(input.refresh_token||'')), token=this.state.tokens[key];
        if(!token||token.kind!=='refresh'||token.expires<=this.now())throw fail('invalid_grant');
        const {grant}=await this.validGrant(token.grantId);
        if(grant.clientId!==input.client_id||grant.resource!==input.resource)throw fail('invalid_grant');
        delete this.state.tokens[key]; grantId=grant.id;
      } else throw fail('unsupported_grant_type');
      const {grant,profile}=await this.validGrant(grantId);
      const scope=profile.access==='write'?grant.scope:scopes[0];
      const access_token=random(),refresh_token=random();
      for(const [key,t] of Object.entries(this.state.tokens))if(t.expires<=this.now())delete this.state.tokens[key];
      this.state.tokens[hash(access_token)]={kind:'access',grantId,scope,expires:this.now()+3600000};
      this.state.tokens[hash(refresh_token)]={kind:'refresh',grantId,expires:this.now()+30*86400000};
      grant.tokenExchangedAt=new Date(this.now()).toISOString();
      await this.save(); return {access_token,refresh_token,token_type:'Bearer',expires_in:3600,scope};
    });
  }
  async authenticate(bearer,host) {
    const token=this.state.tokens[hash(String(bearer||''))];
    if(!token||token.kind!=='access'||token.expires<=this.now())throw fail('invalid_token',401);
    const {grant,profile}=await this.validGrant(token.grantId);
    if(grant.host!==host||grant.resource!==this.resource(host))throw fail('invalid_token',401);
    const access=profile.access==='write'&&token.scope.includes(scopes[1])?'write':'read';
    return {grant,profile,access};
  }
  async revoke(id) { return this.exclusive(async()=>{if(this.state.grants[id]){this.state.grants[id].revoked=true;await this.save();}}); }
  async revokeToken(input) { this.client(input);const token=this.state.tokens[hash(String(input.token||''))];if(token&&this.state.grants[token.grantId]?.clientId===input.client_id)await this.revoke(token.grantId); }
  // lastTool answered "what was the most recent call" and nothing else, so a review that
  // needed proof of a real scan had no record to stand on. Tool names are a closed set
  // defined by this application, so the map cannot be grown by a caller.
  // Only successful calls used to be recorded, so "the AI never tried" and "Claudian refused
  // what it tried" left exactly the same trace: none. That is how a first review that was
  // being refused on every attempt read as one that was still awaited. A refusal is now
  // recorded as a refusal, with its reason, and kept apart from the success map -- a call
  // that failed is evidence of an attempt, never evidence of a read.
  async observed(id,stage,tool,toolsReady=false,failure=null) { return this.exclusive(async()=>{const g=this.state.grants[id];if(!g)return;
    g.lastSeen=new Date(this.now()).toISOString();g.stage=stage;
    if(tool){
      g.lastTool=tool;
      if(failure)g.refused={...g.refused,[tool]:{at:g.lastSeen,error:String(failure).slice(0,300)}};
      else {g.tools={...g.tools,[tool]:g.lastSeen};if(g.refused)delete g.refused[tool];}
    }
    if(!failure&&stage==='tools/list'){g.toolsListedAt=g.lastSeen;g.toolsReadyAt=toolsReady?g.lastSeen:null;}
    await this.save();}); }
  // What this grant has actually called, for callers that must distinguish a real scan from
  // a provider simply asserting one happened.
  activity(id) { const g=this.state.grants[id]; return g&&!g.revoked?{...g.tools}:{}; }
  grants() { return Object.values(this.state.grants).map(({id,host,name,scope,authorizedAt,lastSeen,lastTool,tools,refused,stage,revoked,tokenExchangedAt,toolsListedAt,toolsReadyAt})=>({id,host,name,scope,authorizedAt,lastSeen,lastTool,tools:{...tools},refused:{...refused},stage,revoked,tokenExchangedAt,toolsListedAt,toolsReadyAt})); }
}
module.exports={RemoteAuth,hash,random,hosts,fail};
