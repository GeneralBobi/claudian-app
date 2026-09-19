'use strict';
// Regression lock for the public-gateway contract (planning/PUBLIC-GATEWAY.md).
// Every assertion here corresponds to a numbered rule in that document. These are the
// behaviours a later transport change must not quietly drop.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {RemoteAuth}=require('../remote-auth.cjs');
const {RemoteConnector}=require('../remote-connector.cjs');

async function fixture(t,overrides={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-gateway-'));
  t.after(()=>fs.rm(root,{force:true,recursive:true}));
  const vault=path.join(root,'notes');await fs.mkdir(vault);
  const profile={vault,language:'en',access:'write',hosts:[{id:'chatgpt'}],...overrides};
  return {root,vault,profile,options:{dataDir:path.join(root,'data'),profile:async()=>profile,base:'https://relay.example/d/device'}};
}
const client=auth=>auth.register({client_name:'Test AI',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'});
function args(auth,c,scope) {
  const verifier=crypto.randomBytes(32).toString('base64url');
  return {verifier,input:{client_id:c.client_id,redirect_uri:c.redirect_uris[0],resource:auth.resource('chatgpt'),
    response_type:'code',state:'state-check',scope,code_challenge_method:'S256',
    code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')}};
}

// Contract 2: scopes_supported includes offline_access; 6: it is a refresh signal only.
// Before this, a client asking for offline_access -- which the provider does -- was rejected
// with invalid_scope and the authorization flow died on its first hop.
test('offline_access is advertised and accepted but never becomes an access right',async t=>{
  const {options}=await fixture(t),auth=await new RemoteAuth(options).load();
  assert.deepEqual(auth.metadata().scopes_supported,['claudian.read','claudian.write','offline_access']);
  const c=await client(auth);
  const {verifier,input}=args(auth,c,'claudian.read claudian.write offline_access');
  const request=await auth.begin(input);
  assert.ok(!request.scope.includes('offline_access'),'the grant records access scopes only');
  await auth.approve(request.id,true);
  const redirect=new URL(auth.complete(request.id));
  const tokens=await auth.token({grant_type:'authorization_code',client_id:c.client_id,redirect_uri:input.redirect_uri,
    resource:input.resource,code:redirect.searchParams.get('code'),code_verifier:verifier});
  assert.ok(!tokens.scope.includes('offline_access'));
  assert.equal((await auth.authenticate(tokens.access_token,'chatgpt')).access,'write');
  await assert.rejects(auth.begin(args(auth,c,'offline_access').input),/invalid_scope/);
  await assert.rejects(auth.begin(args(auth,c,'claudian.read claudian.admin').input),/invalid_scope/);
});

// Contract 2: authorization_response_iss_parameter_supported, and iss on every response.
test('every authorization response carries iss, including a denial',async t=>{
  const {options}=await fixture(t),auth=await new RemoteAuth(options).load();
  assert.equal(auth.metadata().authorization_response_iss_parameter_supported,true);
  const c=await client(auth);
  const ok=await auth.begin(args(auth,c,'claudian.read').input);await auth.approve(ok.id,true);
  assert.equal(new URL(auth.complete(ok.id)).searchParams.get('iss'),auth.base);
  const no=await auth.begin(args(auth,c,'claudian.read').input);await auth.approve(no.id,false);
  const denied=new URL(auth.complete(no.id));
  assert.equal(denied.searchParams.get('error'),'access_denied');
  assert.equal(denied.searchParams.get('iss'),auth.base,'a denial is an authorization response too');
});

// Contract 2: S256 is mandatory. Locked so a later transport change cannot relax it.
test('PKCE S256 is mandatory and plain is refused',async t=>{
  const {options}=await fixture(t),auth=await new RemoteAuth(options).load();
  const c=await client(auth);
  const {input}=args(auth,c,'claudian.read');
  await assert.rejects(auth.begin({...input,code_challenge_method:'plain'}),/S256/);
  await assert.rejects(auth.begin({...input,code_challenge_method:undefined}),/S256/);
  await assert.rejects(auth.begin({...input,code_challenge:'too-short'}),/S256/);
});

// Contract 1 and 8: routing state alone must never be enough to mint access.
test('a token the device never issued is refused, and rotation retires the old one',async t=>{
  const {options}=await fixture(t),auth=await new RemoteAuth(options).load();
  const c=await client(auth);
  const {verifier,input}=args(auth,c,'claudian.read');
  const request=await auth.begin(input);await auth.approve(request.id,true);
  const redirect=new URL(auth.complete(request.id));
  const real=await auth.token({grant_type:'authorization_code',client_id:c.client_id,redirect_uri:input.redirect_uri,
    resource:input.resource,code:redirect.searchParams.get('code'),code_verifier:verifier});
  await assert.rejects(auth.authenticate(crypto.randomBytes(32).toString('base64url'),'chatgpt'),/invalid_token/);
  const rotated=await auth.token({grant_type:'refresh_token',client_id:c.client_id,resource:input.resource,refresh_token:real.refresh_token});
  await assert.rejects(auth.token({grant_type:'refresh_token',client_id:c.client_id,resource:input.resource,refresh_token:real.refresh_token}),/invalid_grant/);
  assert.notEqual(rotated.refresh_token,real.refresh_token);
});

// The device resumes its own connection at ordinary startup, and says so when it cannot.
test('an enabled device resumes its relay connection on load and reports a failed resume',async t=>{
  const {options}=await fixture(t);
  const dataDir=options.dataDir;await fs.mkdir(dataDir,{recursive:true});
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:b=>b.toString()};
  await fs.writeFile(path.join(dataDir,'remote-device.json'),JSON.stringify({
    enabled:true,relay:'https://relay.example',device:'a'.repeat(64),
    credential:Buffer.from('secret-value').toString('base64')}));
  let calls=0;
  const connector=new RemoteConnector({dataDir,profile:options.profile,safeStorage,
    fetch:async()=>{calls++;throw Error('relay unreachable');}});
  await connector.load();
  assert.ok(calls>0,'load() actually attempted to reconnect');
  const status=connector.status();
  assert.equal(status.state,'offline','a failed resume is visible, not silent');
  assert.match(status.lastError,/relay unreachable/);
  assert.equal(status.enabled,true,'the intent to stay connected is preserved');
});
