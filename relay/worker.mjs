import {DurableObject} from 'cloudflare:workers';
import {DeviceChannel,normalize,validDeviceKey,json} from './channel.mjs';
export class ClaudianDevice extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.channel=new DeviceChannel();}
  fetch(request){return this.channel.fetch(request);}
}
export default {
  async fetch(original,env){
    const request=normalize(original),url=new URL(request.url);
    if(url.pathname==='/health')return json({service:'claudian-device-relay',version:1});
    if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')return json({error:'https_required'},400);
    const match=/^\/d\/([a-f0-9]{64})\//.exec(url.pathname);
    if(!match)return json({error:'not_found'},404);
    if(!(await env.CONNECTION_LIMIT.limit({key:request.headers.get('cf-connecting-ip')||'local'})).success)return json({error:'rate_limited'},429);
    if(url.pathname.includes('/__device/')&&!await validDeviceKey(request,match[1]))return json({error:'unauthorized'},401);
    const id=env.DEVICES.idFromName(match[1]);return env.DEVICES.get(id).fetch(request);
  }
};
