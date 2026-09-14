'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {RemoteAuth}=require('../remote-auth.cjs');
const {RemoteConnector}=require('../remote-connector.cjs');
const {createRelay}=require(require('node:fs').existsSync(path.join(__dirname,'../../relay/server.cjs'))?'../../relay/server.cjs':'../relay/server.cjs');
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-remote-'));
  t.after(()=>fs.rm(root,{force:true,recursive:true}));
  const vault=path.join(root,'notes');await fs.mkdir(vault);await fs.writeFile(path.join(vault,'Existing.md'),'Original note');
  const profile={vault,language:'en',access:'write',hosts:[{id:'chatgpt'},{id:'claude-desktop'}]};
  return {root,vault,profile,options:{dataDir:path.join(root,'data'),profile:async()=>profile,base:'https://relay.example/d/device'}};
}
async function authorize(auth,host='chatgpt',scope='claudian.read claudian.write') {
  const client=await auth.register({client_name:'Test AI',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'});
  const verifier=crypto.randomBytes(32).toString('base64url');
  const args={client_id:client.client_id,redirect_uri:client.redirect_uris[0],resource:auth.resource(host),response_type:'code',state:'state-check',scope,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};
  const request=await auth.begin(args);await auth.approve(request.id,true);
  const redirect=new URL(auth.complete(request.id));assert.equal(redirect.searchParams.get('state'),'state-check');
  const exchange={grant_type:'authorization_code',client_id:client.client_id,redirect_uri:args.redirect_uri,resource:args.resource,code:redirect.searchParams.get('code'),code_verifier:verifier};
  return {tokens:await auth.token(exchange),client,exchange,grant:auth.grants().at(-1)};
}
test('OAuth requires desktop approval, S256 and exact redirect; codes cannot be replayed',async t=>{
  const {options}=await fixture(t),auth=await new RemoteAuth(options).load();
  const {tokens,exchange}=await authorize(auth);
  await assert.rejects(auth.token(exchange),/invalid_grant/);
  assert.equal((await auth.authenticate(tokens.access_token,'chatgpt')).access,'write');
  await assert.rejects(auth.authenticate(tokens.access_token,'claude-desktop'),/invalid_token/);
  const disk=await fs.readFile(auth.file,'utf8');assert.ok(!disk.includes(tokens.access_token));assert.ok(!disk.includes(tokens.refresh_token));
});
test('revocation, profile scope changes and vault changes invalidate live access',async t=>{
  const {options,profile}=await fixture(t),auth=await new RemoteAuth(options).load();
  const {tokens,grant}=await authorize(auth);
  profile.access='read';assert.equal((await auth.authenticate(tokens.access_token,'chatgpt')).access,'read');
  profile.vault+='-moved';await assert.rejects(auth.authenticate(tokens.access_token,'chatgpt'),/invalid_token/);
  profile.vault=profile.vault.replace(/-moved$/,'');await auth.revoke(grant.id);
  await assert.rejects(auth.authenticate(tokens.access_token,'chatgpt'),/invalid_token/);
});
test('refresh rotates credentials and cannot be moved to another resource or client',async t=>{
  const {options}=await fixture(t),auth=await new RemoteAuth(options).load();
  const {tokens,client,exchange}=await authorize(auth);
  const args={grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:client.client_id,resource:exchange.resource};
  await assert.rejects(auth.token({...args,resource:auth.resource('claude-desktop')}),/invalid_grant/);
  const refreshed=await auth.token(args);assert.notEqual(refreshed.refresh_token,tokens.refresh_token);
  await assert.rejects(auth.token(args),/invalid_grant/);
  const reloaded=await new RemoteAuth(options).load();assert.equal((await reloaded.authenticate(refreshed.access_token,'chatgpt')).access,'write');
});
test('pending or expired browser requests grant no access and reject unsafe redirects',async t=>{
  const {options}=await fixture(t);let now=Date.now();const auth=await new RemoteAuth({...options,now:()=>now}).load();
  await assert.rejects(auth.register({redirect_uris:['http://evil.example/callback']}),/HTTPS/);
  const c=await auth.register({redirect_uris:['https://client.example/callback']});
  const args={client_id:c.client_id,redirect_uri:'https://client.example/callback',resource:auth.resource('chatgpt'),response_type:'code',state:'s',code_challenge_method:'S256',code_challenge:'a'.repeat(43)};
  await assert.rejects(auth.begin({...args,redirect_uri:'https://evil.example/callback'}),/redirect/);
  const r=await auth.begin(args);assert.equal(auth.complete(r.id),null);assert.deepEqual(auth.grants(),[]);
  now+=300001;await assert.rejects(auth.approve(r.id,true),/expired/);
});
test('actual outbound relay carries authenticated MCP reads and writes without local inbound ports',async t=>{
  const {root,vault,options}=await fixture(t),relay=createRelay({timeout:500});
  await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve));
  const base=process.env.CLAUDIAN_TEST_RELAY||'http://127.0.0.1:'+relay.address().port;
  const encryptionKey=crypto.randomBytes(32);
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',encryptionKey,iv);return Buffer.concat([iv,c.update(value),c.final(),c.getAuthTag()]);},decryptString:bytes=>{const c=crypto.createDecipheriv('aes-256-gcm',encryptionKey,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(-16));return Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString();}};
  const connector=new RemoteConnector({...options,safeStorage,allowLoopback:true});
  t.after(async()=>{await connector.stop();relay.closeAllConnections();await new Promise(resolve=>relay.close(resolve));});
  await connector.start(base);
  const endpoint=connector.status().urls.chatgpt;
  let r=await fetch(endpoint,{method:'POST',body:'{}'});assert.equal(r.status,401);
  assert.match(r.headers.get('www-authenticate'),/resource_metadata/);
  // Follow the public registration and authorization endpoints, not internal test-only routes.
  const auth=connector.http.auth;
  r=await fetch(auth.base+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Browser AI',redirect_uris:['https://client.example/callback']})});
  assert.equal(r.status,201);const client=await r.json();
  const verifier=crypto.randomBytes(32).toString('base64url');
  const authorizeUrl=auth.base+'/oauth/authorize?'+new URLSearchParams({client_id:client.client_id,redirect_uri:'https://client.example/callback',resource:endpoint,response_type:'code',state:'browser-state',scope:'claudian.read claudian.write',code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')});
  r=await fetch(authorizeUrl);assert.equal(r.status,200);assert.match(await r.text(),/approve/);
  const pending=connector.status().requests[0];assert.ok(pending);await connector.approve(pending.id,true);
  r=await fetch(auth.base+'/oauth/complete?request='+pending.id,{redirect:'manual'});assert.equal(r.status,302);
  const code=new URL(r.headers.get('location')).searchParams.get('code');
  r=await fetch(auth.base+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:'https://client.example/callback',resource:endpoint,code,code_verifier:verifier})});
  assert.equal(r.status,200);const tokens=await r.json();
  const call=async(method,params)=>{const res=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+tokens.access_token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:res.status,body:await res.json()};};
  assert.match((await call('initialize',{})).body.result.instructions,/startup_context/);
  assert.equal(connector.status().progress.chatgpt.canTest,false);
  assert.equal((await call('initialize',{protocolVersion:'2025-03-26'})).body.result.protocolVersion,'2025-03-26');
  const list=await call('tools/list');assert.ok(list.body.result.tools.some(x=>x.name==='memory_review'));
  assert.equal(connector.status().progress.chatgpt.canTest,true);
  const read=await call('tools/call',{name:'read_note',arguments:{note:'Existing'}});assert.match(JSON.stringify(read.body),/Original note/);
  const write=await call('tools/call',{name:'write_note',arguments:{note:'Via remote',body:'Saved over authenticated relay',reason:'Connection acceptance'}});
  assert.equal(write.body.result.isError,undefined,JSON.stringify(write.body));assert.equal(await fs.readFile(path.join(vault,'Via remote.md'),'utf8'),'Saved over authenticated relay\n');
  assert.equal(connector.status().grants[0].lastTool,'write_note');
  await connector.revoke(connector.status().grants[0].id);
  assert.equal((await call('tools/list')).status,401);
  const saved=JSON.parse(await fs.readFile(path.join(root,'data','remote-device.json'),'utf8'));assert.ok(saved.credential);assert.notEqual(saved.credential,safeStorage.decryptString(Buffer.from(saved.credential,'base64')));
});
test('relay rejects a second device credential and never queues requests for offline devices',async t=>{
  const relay=createRelay({timeout:100});await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{relay.closeAllConnections();await new Promise(resolve=>relay.close(resolve));});
  const base='http://127.0.0.1:'+relay.address().port+'/d/'+'a'.repeat(64);
  assert.equal((await fetch(base+'/chatgpt/mcp',{method:'POST',body:'{}'})).status,503);
  assert.equal((await fetch(base+'/__device/poll',{method:'POST',headers:{authorization:'Bearer '+'b'.repeat(43)}})).status,401);
});
