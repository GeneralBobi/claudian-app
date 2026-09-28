'use strict';
const {RemoteAuth,hosts}=require('./remote-auth.cjs');
const mcp=require('./mcp.cjs');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const response=(body,status=200,headers={})=>({status,headers:{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const page=(title,body,refresh='')=>response(`<!doctype html><html lang="en"><meta charset="utf-8">${refresh?`<meta http-equiv="refresh" content="2;url=${escape(refresh)}">`:""}<meta name="viewport" content="width=device-width"><title>Claudian — ${escape(title)}</title><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`,200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
const input=req=>req.headers?.['content-type']?.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(req.body)):JSON.parse(req.body||'{}');
// The same device state answered under another base address (1.1.0, madde 9): reads and writes go to the one RemoteAuth,
// only `base` differs, so issuer, resource and metadata match the address the AI app actually used.
const underBase=(auth,base)=>new Proxy(auth,{get:(t,k)=>k==='base'?base:Reflect.get(t,k,t),set:(t,k,v)=>Reflect.set(t,k,v)});
class RemoteHttp {
  constructor(options) { this.options=options; this.primary=new RemoteAuth(options); this.auth=this.primary; }
  async load() { await this.primary.load();return this; }
  // A request that the relay says arrived at the previous address is answered as that address; everything else as the
  // current one. The relay only forwards requests it received on its own hostnames, and the host is compared exactly.
  authFor(req) {
    const previous=this.options.previousBase;
    if(previous&&typeof req.host==='string'&&req.host===new URL(previous).host)return underBase(this.primary,previous);
    return this.primary;
  }
  async handle(req) {
    const auth=this.authFor(req);
    return this.handleWith(auth,req);
  }
  async handleWith(auth,req) {
    try {
      if(typeof req.body!=='string'||Buffer.byteLength(req.body)>600000)return response({error:'request_too_large'},413);
      const url=new URL(req.path,auth.base+'/'), suffix=url.pathname.slice(new URL(auth.base).pathname.length);
      if(url.origin!==new URL(auth.base).origin)return response({error:'invalid_origin'},400);
      if(req.method==='OPTIONS')return response('',204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization, content-type, mcp-protocol-version'});
      if(req.method==='GET'&&suffix==='/.well-known/oauth-authorization-server')return response(auth.metadata());
      const metadata=/^\/\.well-known\/oauth-protected-resource\/(chatgpt|claude-desktop|gemini|perplexity)$/.exec(suffix);
      if(req.method==='GET'&&metadata)return response({resource:auth.resource(metadata[1]),authorization_servers:[auth.base],scopes_supported:['claudian.read','claudian.write'],bearer_methods_supported:['header'],resource_name:'Claudian'});
      if(req.method==='POST'&&suffix==='/oauth/register')return response(await auth.register(input(req)),201);
      if(req.method==='POST'&&suffix==='/oauth/token')return response(await auth.token(input(req)));
      if(req.method==='POST'&&suffix==='/oauth/revoke'){await auth.revokeToken(input(req));return response({});}
      if(req.method==='GET'&&suffix==='/oauth/authorize') {
        const r=await auth.begin(Object.fromEntries(url.searchParams));
        return page('Connect your AI to Claudian',`<p>Open Claudian on your computer and approve only the request with this code:</p><h2>${r.code}</h2><p>Application: ${escape(r.name)}<br>Return address: ${escape(new URL(r.redirect).hostname)}<br>Access: ${escape(r.scope)}</p><p>Bilgisayarındaki Claudian uygulamasında aynı kodu kontrol edip bağlantıyı onayla. Onaydan sonra otomatik olarak geri döneceksin.</p><p><a href="${escape(auth.base)}/oauth/complete?request=${encodeURIComponent(r.id)}">Continue / Devam et</a></p>`,auth.base+'/oauth/complete?request='+encodeURIComponent(r.id));
      }
      if(req.method==='GET'&&suffix==='/oauth/complete') {
        const next=auth.complete(url.searchParams.get('request'));
        if(next)return response('',302,{location:next});
        const pending=auth.requests().find(r=>r.id===url.searchParams.get('request'));
        return page('Claudian bağlantı onayı',`<p>Claudian uygulamasında aşağıdaki kodla eşleşen isteği onayla. Onaydan sonra otomatik olarak AI uygulamasına döneceksin.</p><h2>${escape(pending?.code||'')}</h2><p>${escape(pending?.name||'')} · ${escape(pending?.scope||'')}</p><p>Approve the matching code in Claudian. You will return to the AI automatically.</p>`,url.href);
      }
      const host=hosts.find(h=>suffix==='/'+h+'/mcp');
      if(!host)return response({error:'not_found'},404);
      const bearer=/^Bearer (\S+)$/i.exec(req.headers?.authorization||'')?.[1];
      let session;
      try {session=await auth.authenticate(bearer,host);}
      catch {return response({error:'authorization_required'},401,{'www-authenticate':`Bearer resource_metadata="${auth.base}/.well-known/oauth-protected-resource/${host}", scope="claudian.read claudian.write"`});}
      if(req.method!=='POST')return response({error:'method_not_allowed'},405,{allow:'POST'});
      const message=input(req);
      if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')return response({error:'invalid_request'},400);
      if(message.id===undefined)return response('',202);
      const {profile,access,grant}=session;
      const tools=mcp.capabilities(profile.vault,()=>require('./notice.cjs').look({vault:profile.vault,ledgerFile:require('node:path').join(this.options.dataDir,'noticed.json')}),{access,dataDir:this.options.dataDir,actor:host,language:profile.language,
        // Independent evidence of what this grant has actually called. A first review closes
        // on the application's own record, never on the provider's account of itself.
        activity:()=>auth.activity(grant.id)}).filter(t=>t.scope==='read'||access==='write');
      const reply=await mcp.handle(message,tools,{supportedProtocols:['2025-06-18','2025-03-26'],version:profile.appVersion||'0',language:profile.language,authorize:async scope=>{
        const current=await auth.authenticate(bearer,host);
        if(current.profile.vault!==profile.vault)throw Error('Selected vault changed');
        if(scope==='write'&&current.access!=='write')throw Error('Write permission was revoked');
      }});
      const testTools=['read_connection_test','submit_connection_test'];
      const toolsReady=message.method==='tools/list'&&testTools.every(name=>reply.result?.tools?.some(t=>t.name===name&&t.inputSchema?.type==='object'));
      const called=message.method==='tools/call'?message.params?.name:undefined;
      // A refused call is recorded as refused. Without this the device cannot tell a provider
      // that never called from one it keeps turning away, and the screen guesses.
      const failure=reply.error?.message||(reply.result?.isError?reply.result.content?.map(c=>c.text).join(' ').slice(0,300):null);
      await auth.observed(grant.id,message.method,called,toolsReady,failure||null);
      return response(reply);
    } catch(e) {return response({error:e.status?e.message:'request_failed'},e.status||400);}
  }
}
module.exports={RemoteHttp,response};
