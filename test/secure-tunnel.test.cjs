'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {SecureTunnel}=require('../secure-tunnel.cjs');
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-tunnel-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const binary=path.join(dir,'tunnel-client.exe');await fs.writeFile(binary,'test');
 const secret='sk-test-credential-not-real',cipher=Buffer.from('opaque-os-encrypted-data');
 const storage={isEncryptionAvailable:()=>true,encryptString:s=>{assert.equal(s,secret);return cipher;},decryptString:b=>{assert.deepEqual(b,cipher);return secret;}};
 const calls=[],profile={vault:dir,hosts:[{id:'chatgpt'}]};
 const tunnel=await new SecureTunnel({dataDir:dir,safeStorage:storage,profile:async()=>profile,launch:(...args)=>{calls.push(args);const c=new EventEmitter();c.kill=()=>c.emit('exit',0);return c;}}).load();
 return {tunnel,dir,binary,secret,calls,profile,storage,input:{binary,tunnelId:'tunnel_0123456789abcdef0123456789abcdef',apiKey:secret}};
}
test('stores only encrypted key outside runtime config; status and command args never expose it',async t=>{
 const f=await fixture(t);await f.tunnel.save(f.input);
 assert.equal(f.tunnel.status().autoStart,false);assert.equal(f.calls.length,0);
 const disk=await fs.readFile(path.join(f.dir,'secure-tunnel/settings.json'),'utf8');assert.ok(!disk.includes(f.secret));
 assert.ok(!JSON.stringify(f.tunnel.status()).includes(f.secret));
 await f.tunnel.start();const [binary,args,options]=f.calls[0];assert.equal(binary,f.binary);
 assert.equal(options.windowsHide,true);assert.equal(options.shell,false);assert.equal(options.env.CONTROL_PLANE_API_KEY,f.secret);
 assert.equal(options.env.OPENAI_API_KEY,undefined);assert.ok(!JSON.stringify(args).includes(f.secret));
 const runtime=await fs.readFile(path.join(f.dir,'secure-tunnel/runtime.json'),'utf8');assert.ok(!runtime.includes(f.secret));assert.ok(!runtime.includes('workers.dev'));
 await f.tunnel.stop();await f.tunnel.forget();assert.equal(f.tunnel.status().hasKey,false);
});
test('fails closed without encryption or host permission; concurrent starts launch once',async t=>{
 const f=await fixture(t);f.storage.isEncryptionAvailable=()=>false;await assert.rejects(f.tunnel.save(f.input),/encrypted/);
 f.storage.isEncryptionAvailable=()=>true;await f.tunnel.save(f.input);f.profile.hosts=[];await assert.rejects(f.tunnel.start(),/Select ChatGPT/);
 f.profile.hosts=[{id:'chatgpt'}];await Promise.all([f.tunnel.start(),f.tunnel.start()]);assert.equal(f.calls.length,1);
 await assert.rejects(f.tunnel.save(f.input),/Stop/);await f.tunnel.stop();
});

test('readiness follows the local health endpoint and disappears when the process exits',async t=>{
 const f=await fixture(t);await f.tunnel.save(f.input);await f.tunnel.start();
 const http=require('node:http');let status=200;
 const server=http.createServer((req,res)=>{assert.equal(req.url,'/readyz');res.writeHead(status);res.end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await fs.writeFile(path.join(f.dir,'secure-tunnel/health.url'),`http://127.0.0.1:${server.address().port}`);
 assert.equal((await f.tunnel.inspect()).phase,'ready');
 status=503;assert.equal((await f.tunnel.inspect()).phase,'running');
 f.tunnel.child.emit('exit',1);
 assert.equal((await f.tunnel.inspect()).phase,'failed');
 assert.equal(f.tunnel.status().running,false);
 await f.tunnel.start();assert.equal(f.calls.length,2,'restart is explicit');
 assert.equal(f.tunnel.status().phase,'starting','old readiness is not reused');
 await f.tunnel.stop();
});

test('spawn failure remains recoverable and an external health URL is rejected',async t=>{
 const f=await fixture(t);await f.tunnel.save(f.input);await f.tunnel.start();
 f.tunnel.child.emit('error',new Error('fixture spawn error'));
 assert.equal(f.tunnel.status().phase,'failed');assert.equal(f.tunnel.status().running,false);
 await f.tunnel.start();
 await fs.writeFile(path.join(f.dir,'secure-tunnel/health.url'),'https://example.com/');
 assert.notEqual((await f.tunnel.inspect()).phase,'ready');
 await f.tunnel.stop();
});
