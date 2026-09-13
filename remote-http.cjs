'use strict';
const {RemoteAuth,hosts}=require('./remote-auth.cjs');
const mcp=require('./mcp.cjs');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const response=(body,status=200,headers={})=>({status,headers:{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const page=(title,body)=>response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Claudian — ${escape(title)}</title><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`,200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
const input=req=>req.headers?.['content-type']?.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(req.body)):JSON.parse(req.body||'{}');
class RemoteHttp {
  constructor(options) { this.options=options; this.auth=new RemoteAuth(options); }
  async load() { await this.auth.load();return this; }
  async handle(req) {
    try {
      if(typeof req.body!=='string'||Buffer.byteLength(req.body)>600000)return response({error:'request_too_large'},413);
      const url=new URL(req.path,this.auth.base+'/'), suffix=url.pathname.slice(new URL(this.auth.base).pathname.length);
      if(url.origin!==new URL(this.auth.base).origin)return response({error:'invalid_origin'},400);
      if(req.method==='OPTIONS')return response('',204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization, content-type, mcp-protocol-version'});
      if(req.method==='GET'&&suffix==='/.well-known/oauth-authorization-server')return response(this.auth.metadata());
      const metadata=/^\/\.well-known\/oauth-protected-resource\/(chatgpt|claude-desktop|gemini|perplexity)$/.exec(suffix);
      if(req.method==='GET'&&metadata)return response({resource:this.auth.resource(metadata[1]),authorization_servers:[this.auth.base],scopes_supported:['claudian.read','claudian.write'],bearer_methods_supported:['header'],resource_name:'Claudian'});
      if(req.method==='POST'&&suffix==='/oauth/register')return response(await this.auth.register(input(req)),201);
      if(req.method==='POST'&&suffix==='/oauth/token')return response(await this.auth.token(input(req)));
      if(req.method==='POST'&&suffix==='/oauth/revoke'){await this.auth.revokeToken(input(req));return response({});}
      if(req.method==='GET'&&suffix==='/oauth/authorize') {
        const r=await this.auth.begin(Object.fromEntries(url.searchParams));
        return page('Connect your AI to Claudian',`<p>Open Claudian on your computer and approve only the request with this code:</p><h2>${r.code}</h2><p>Application: ${escape(r.name)}<br>Return address: ${escape(new URL(r.redirect).hostname)}<br>Access: ${escape(r.scope)}</p><p>Bilgisayarındaki Claudian uygulamasında aynı kodu kontrol edip bağlantıyı onayla. Ardından devam et.</p><p><a href="${escape(this.auth.base)}/oauth/complete?request=${encodeURIComponent(r.id)}">Continue / Devam et</a></p>`);
      }
      if(req.method==='GET'&&suffix==='/oauth/complete') {
        const next=this.auth.complete(url.searchParams.get('request'));
        if(next)return response('',302,{location:next});
        return page('Waiting for approval',`<p>Claudian uygulamasında bağlantı izni bekleniyor. Onayladıktan sonra bu sayfayı yenile.</p><p>Approve the matching request in the Claudian desktop application, then reload this page.</p>`);
      }
      const host=hosts.find(h=>suffix==='/'+h+'/mcp');
      if(!host)return response({error:'not_found'},404);
      const bearer=/^Bearer (\S+)$/i.exec(req.headers?.authorization||'')?.[1];
      let session;
      try {session=await this.auth.authenticate(bearer,host);}
      catch {return response({error:'authorization_required'},401,{'www-authenticate':`Bearer resource_metadata="${this.auth.base}/.well-known/oauth-protected-resource/${host}", scope="claudian.read claudian.write"`});}
      if(req.method!=='POST')return response({error:'method_not_allowed'},405,{allow:'POST'});
      const message=input(req);
      if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')return response({error:'invalid_request'},400);
      if(message.id===undefined)return response('',202);
      const {profile,access,grant}=session;
      const tools=mcp.capabilities(profile.vault,()=>require('./notice.cjs').look({vault:profile.vault,ledgerFile:require('node:path').join(this.options.dataDir,'noticed.json')}),{access,dataDir:this.options.dataDir,actor:host,language:profile.language}).filter(t=>t.scope==='read'||access==='write');
      const reply=await mcp.handle(message,tools,{version:profile.appVersion||'0',language:profile.language,authorize:async scope=>{
        const current=await this.auth.authenticate(bearer,host);
        if(current.profile.vault!==profile.vault)throw Error('Selected vault changed');
        if(scope==='write'&&current.access!=='write')throw Error('Write permission was revoked');
      }});
      if(!reply.error&&!reply.result?.isError)await this.auth.observed(grant.id,message.method,message.method==='tools/call'?message.params?.name:undefined);
      return response(reply);
    } catch(e) {return response({error:e.status?e.message:'request_failed'},e.status||400);}
  }
}
module.exports={RemoteHttp,response};
