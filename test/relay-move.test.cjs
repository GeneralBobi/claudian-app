'use strict';
// Relay move (1.1.0, madde 9): the device moves from the old workers.dev address to relay.claudian.app without breaking
// the ChatGPT and Gemini connectors that were added under the old address.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {RemoteHttp}=require('../remote-http.cjs');
const {RemoteConnector}=require('../remote-connector.cjs');

const OLD='https://claudian-device-relay.boranbirtanir.workers.dev', NEW='https://relay.claudian.app', DEVICE='d'.repeat(64);
const oldBase=`${OLD}/d/${DEVICE}`, newBase=`${NEW}/d/${DEVICE}`;

async function fixture(t, options = {}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-relay-move-'));
  t.after(()=>fs.rm(root,{force:true,recursive:true}));
  const vault=path.join(root,'notes');await fs.mkdir(vault);await fs.writeFile(path.join(vault,'Existing.md'),'Original note');
  const profile={vault,language:'en',access:'write',hosts:[{id:'chatgpt'},{id:'gemini'}]};
  return {root,profile,dataDir:path.join(root,'data'),options:{dataDir:path.join(root,'data'),profile:async()=>profile,...options}};
}

// A connector added under `base`, through the same HTTP surface the relay forwards to.
async function connect(http, base, host='chatgpt') {
  const hostName=new URL(base).host, suffix=new URL(base).pathname;
  const call=async (method,p,body,headers={})=>http.handle({host:hostName,method,path:suffix+p,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):''});
  const meta=JSON.parse((await call('GET',`/.well-known/oauth-protected-resource/${host}`)).body);
  const client=JSON.parse((await call('POST','/oauth/register',{client_name:'Test AI',redirect_uris:['https://client.example/cb'],token_endpoint_auth_method:'none'})).body);
  const verifier=crypto.randomBytes(32).toString('base64url');
  const q=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://client.example/cb',resource:meta.resource,response_type:'code',state:'s',scope:'claudian.read claudian.write',code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')});
  assert.equal((await call('GET',`/oauth/authorize?${q}`)).status,200);
  const req=http.primary.requests().at(-1);await http.primary.approve(req.id,true);
  const next=new URL(http.primary.complete(req.id));
  const tokens=JSON.parse((await call('POST','/oauth/token',{grant_type:'authorization_code',client_id:client.client_id,redirect_uri:'https://client.example/cb',resource:meta.resource,code:next.searchParams.get('code'),code_verifier:verifier})).body);
  const tools=async ()=>call('POST',`/${host}/mcp`,{jsonrpc:'2.0',id:1,method:'tools/list'},{authorization:`Bearer ${tokens.access_token}`});
  return {meta,tokens,tools,call,client,iss:next.searchParams.get('iss')};
}

test('a connector added under the old address keeps working after the move; the old address answers as itself',async t=>{
  const {options}=await fixture(t);
  const before=await new RemoteHttp({...options,base:oldBase}).load();
  const old=await connect(before,oldBase);
  assert.equal(old.meta.resource,`${oldBase}/chatgpt/mcp`);
  assert.equal((await old.tools()).status,200);
  // After the move: same device state, new base, the old one kept as previousBase.
  const after=await new RemoteHttp({...options,base:newBase,previousBase:oldBase}).load();
  const call=(host,p,headers={})=>after.handle({host,method:'POST',path:new URL(oldBase).pathname+p,headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal((await call(new URL(OLD).host,'/chatgpt/mcp',{authorization:`Bearer ${old.tokens.access_token}`})).status,200,'old connector through the old address');
  const meta=await after.handle({host:new URL(OLD).host,method:'GET',path:new URL(oldBase).pathname+'/.well-known/oauth-authorization-server',headers:{},body:''});
  assert.equal(JSON.parse(meta.body).issuer,oldBase,'the old address still names itself as issuer');
  const refresh=await after.handle({host:new URL(OLD).host,method:'POST',path:new URL(oldBase).pathname+'/oauth/token',headers:{'content-type':'application/json'},
    body:JSON.stringify({grant_type:'refresh_token',refresh_token:old.tokens.refresh_token,client_id:old.client.client_id,resource:old.meta.resource})});
  assert.equal(refresh.status,200,'the old connector can refresh its token through the old address');
  // A new connector uses the new address; its issuer and resource are the new ones.
  const fresh=await connect(after,newBase,'gemini');
  assert.equal(fresh.meta.resource,`${newBase}/gemini/mcp`);
  assert.equal(fresh.iss,newBase);
  assert.equal((await fresh.tools()).status,200);
  // A token is bound to its address: the old connector's token does not open the new address, and vice versa.
  assert.equal((await after.handle({host:new URL(NEW).host,method:'POST',path:new URL(newBase).pathname+'/chatgpt/mcp',headers:{'content-type':'application/json',authorization:`Bearer ${old.tokens.access_token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})})).status,401);
  // An address the relay did not name, or no host at all, is answered as the current address.
  assert.equal(JSON.parse((await after.handle({host:'evil.example',method:'GET',path:new URL(newBase).pathname+'/.well-known/oauth-authorization-server',headers:{},body:''})).body).issuer,newBase);
});

test('the device state moves to relay.claudian.app once and remembers the old address',async t=>{
  const {dataDir,options}=await fixture(t);
  await fs.mkdir(dataDir,{recursive:true});
  await fs.writeFile(path.join(dataDir,'remote-device.json'),JSON.stringify({enabled:false,relay:OLD,device:DEVICE}));
  const c=await new RemoteConnector({...options,safeStorage:{}}).load();
  assert.equal(c.state.relay,NEW);
  assert.equal(c.state.previousRelay,OLD);
  const disk=JSON.parse(await fs.readFile(path.join(dataDir,'remote-device.json'),'utf8'));
  assert.deepEqual([disk.relay,disk.previousRelay],[NEW,OLD]);
  const again=await new RemoteConnector({...options,safeStorage:{}}).load();
  assert.equal(again.state.previousRelay,OLD,'a second start does not lose the old address');
});
