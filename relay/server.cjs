'use strict';
// Local/self-hosted adapter for the exact same channel deployed to Cloudflare.
const http=require('node:http');
const channelModule=import('./channel.mjs');
function createRelay({maxDevices=1000,...options}={}) {
  const devices=new Map(),rates=new Map();
  const server=http.createServer(async(req,res)=>{
    try {
      const {DeviceChannel,normalize,validDeviceKey,json}=await channelModule;
      const controller=new AbortController();res.on('close',()=>controller.abort());
      const request=normalize(new Request('http://relay.local'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{}),signal:controller.signal}));
      const url=new URL(request.url),match=/^\/d\/([a-f0-9]{64})\//.exec(url.pathname);
      let response;
      if(url.pathname==='/health')response=json({service:'claudian-device-relay',version:1});
      else if(!match)response=json({error:'not_found'},404);
      else {
        const id=match[1],internal=url.pathname.includes('/__device/');
        const ip=req.socket.remoteAddress,now=Date.now();let rate=rates.get(ip);if(!rate||now-rate.since>60000)rate={since:now,count:0};rate.count++;rates.set(ip,rate);
        if(rate.count>240)response=json({error:'rate_limited'},429);
        else if(internal&&!await validDeviceKey(request,id))response=json({error:'unauthorized'},401);
        else {
          let channel=devices.get(id);
          if(!channel&&internal&&devices.size<maxDevices){channel=new DeviceChannel(options);devices.set(id,channel);}
          response=channel?await channel.fetch(request):json({error:'device_offline'},503);
        }
      }
      if(!res.writableEnded){res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}
    }catch{if(!res.writableEnded){res.writeHead(400);res.end();}}
  });
  const timer=setInterval(()=>{for(const [id,c]of devices)if(!c.poll&&!c.queue.length&&!c.inflight.size&&Date.now()-c.lastSeen>120000)devices.delete(id);for(const [ip,r]of rates)if(Date.now()-r.since>120000)rates.delete(ip);},60000).unref();
  server.on('close',()=>{clearInterval(timer);for(const c of devices.values())c.close();});return server;
}
if(require.main===module)createRelay().listen(Number(process.env.PORT||3942),'127.0.0.1',()=>console.log('Claudian relay listening on loopback'));
module.exports={createRelay};
