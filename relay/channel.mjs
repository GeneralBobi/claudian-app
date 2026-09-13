const encoder=new TextEncoder();
const json=(body,status=200,headers={})=>new Response([204,205,304].includes(status)?null:typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
export async function validDeviceKey(request,id) {
  const secret=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')||'')?.[1];
  if(!secret)return false;
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(secret));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')===id;
}
async function limitedText(request) {
  if(Number(request.headers.get('content-length'))>800000)throw Error('too_large');
  if(!request.body)return '';
  const reader=request.body.getReader(),chunks=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>800000){await reader.cancel();throw Error('too_large');}chunks.push(value);}}finally{reader.releaseLock();}
  const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(joined);
}
export class DeviceChannel {
  constructor({timeout=25000,maxPending=24}={}) {Object.assign(this,{timeout,maxPending});this.queue=[];this.inflight=new Map();this.poll=null;this.lastSeen=0;}
  async fetch(request) {
    try {
      const u=new URL(request.url),match=/^\/d\/([a-f0-9]{64})(\/.*)$/.exec(u.pathname);
      if(!match)return json({error:'not_found'},404);
      const [,id,suffix]=match,internal=suffix.startsWith('/__device/');
      if(internal&&!await validDeviceKey(request,id))return json({error:'unauthorized'},401);
      if(internal&&suffix==='/__device/connect'&&request.method==='POST'){this.lastSeen=Date.now();return json({connected:true});}
      if(internal&&suffix==='/__device/poll'&&request.method==='POST') {
        this.lastSeen=Date.now();if(this.poll)return json({error:'poll_already_active'},409);
        const take=()=>{const batch=this.queue.splice(0,8);for(const item of batch)this.inflight.set(item.id,item);return json({requests:batch.map(({id,request})=>({id,...request}))});};
        if(this.queue.length)return take();
        return await new Promise(resolve=>{
          const end=value=>{clearTimeout(timer);request.signal.removeEventListener('abort',abort);if(this.poll===deliver)this.poll=null;resolve(value);};
          const abort=()=>end(json({requests:[]}));const deliver=()=>end(take());
          const timer=setTimeout(()=>end(json({requests:[]})),this.timeout);this.poll=deliver;
          request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
        });
      }
      if(internal&&suffix==='/__device/reply'&&request.method==='POST') {
        const result=JSON.parse(await limitedText(request)),item=this.inflight.get(result.id);
        if(!item)return json({error:'request_expired'},410);
        if(!Number.isInteger(result.status)||result.status<200||result.status>599||typeof result.body!=='string')return json({error:'invalid_response'},400);
        const headers={};for(const h of ['content-type','location','www-authenticate','allow','referrer-policy','content-security-policy','x-content-type-options','access-control-allow-origin','access-control-allow-methods','access-control-allow-headers'])if(typeof result.headers?.[h]==='string')headers[h]=result.headers[h];
        item.finish(json(result.body,result.status,headers));return json({});
      }
      if(internal)return json({error:'not_found'},404);
      if(!['GET','POST','OPTIONS'].includes(request.method))return json({error:'method_not_allowed'},405);
      if(!this.lastSeen||Date.now()-this.lastSeen>this.timeout*2&&!this.poll)return json({error:'device_offline'},503);
      if(this.queue.length+this.inflight.size>=this.maxPending)return json({error:'device_busy'},429);
      const body=await limitedText(request),requestId=crypto.randomUUID();
      const headers={};for(const key of ['authorization','content-type','mcp-protocol-version'])if(request.headers.has(key))headers[key]=request.headers.get(key);
      return await new Promise(resolve=>{
        const item={id:requestId,request:{path:u.pathname+u.search,method:request.method,headers,body}};
        const abort=()=>item.finish(json({error:'request_cancelled'},499));
        const timer=setTimeout(()=>item.finish(json({error:'device_timeout'},504)),this.timeout);
        item.finish=value=>{clearTimeout(timer);request.signal.removeEventListener('abort',abort);this.inflight.delete(requestId);this.queue=this.queue.filter(x=>x!==item);resolve(value);};
        request.signal.addEventListener('abort',abort,{once:true});this.queue.push(item);
        if(request.signal.aborted)abort();else if(this.poll)this.poll();
      });
    } catch{return json({error:'invalid_request'},400);}
  }
  close(){if(this.poll)this.poll();for(const item of [...this.queue,...this.inflight.values()])item.finish(json({error:'relay_stopping'},503));}
}
export function normalize(request) {
  const url=new URL(request.url);
  const match=/^\/\.well-known\/oauth-authorization-server(\/d\/[a-f0-9]{64})$/.exec(url.pathname);
  if(match){url.pathname=match[1]+'/.well-known/oauth-authorization-server';return new Request(url,request);}return request;
}
export {json};
