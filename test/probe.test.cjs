'use strict';
// The product checks its own connection instead of handing the check to the user. The probe
// runs the exact command a host is configured to run -- same executable, same arguments, same
// environment -- because a probe that takes a shortcut proves the shortcut, not the product.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const probe=require('../probe.cjs');
const {MemorySetup}=require('../core.cjs');

async function installed(t,access='write'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-probe-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home');await fs.mkdir(home);
 // The packaged product launches the server through Electron running as Node; under the test
 // runner the launcher is plain node and the script is the real mcp-server.cjs.
 const core=new MemorySetup({home,dataDir:path.join(root,'data'),launcher:process.execPath,mcpScript:path.join(__dirname,'..','mcp-server.cjs')});
 await core.install((await core.prepare({name:'Deniz',vault:path.join(root,'notes'),mode:'new',storage:'markdown',hosts:['claude-desktop'],language:'en',access})).id,true);
 return {core,root};
}

test('the configured command starts, introduces itself and answers a real call',async t=>{
 const {core}=await installed(t);
 const report=await core.selfCheck();
 const connection=report.connections.find(c=>c.id==='claude-desktop');
 assert.equal(connection.checks.server.state,'ready',connection.checks.server.detail||'');
 assert.ok(connection.checks.server.tools.includes('read_note'));
 assert.ok(connection.checks.server.tools.includes('write_note'));
 assert.deepEqual(connection.failing,[]);
 assert.ok(Date.parse(report.checkedAt));
});

test('a read-only grant is visible in what the server offers',async t=>{
 const {core}=await installed(t,'read');
 const connection=(await core.selfCheck()).connections.find(c=>c.id==='claude-desktop');
 assert.equal(connection.checks.server.state,'ready');
 assert.ok(!connection.checks.server.tools.includes('write_note'),'a capability that was not granted is not offered');
});

test('an advertised server whose vault disappeared is broken, not ready',async t=>{
 const {core}=await installed(t);
 const profile=JSON.parse(await fs.readFile(core.configFile,'utf8'));
 await fs.rename(profile.vault,profile.vault+'-moved');
 const connection=(await core.selfCheck()).connections.find(c=>c.id==='claude-desktop');
 assert.equal(connection.checks.server.state,'broken');
 assert.ok(connection.checks.server.detail);
});

// The point of checking ourselves is that a connection which quietly stopped working must not
// look like one nobody has checked yet.
test('a server that cannot start is reported as broken, with its own words',async t=>{
 const {core}=await installed(t);
 await fs.rm(core.configFile);
 const connection=(await core.selfCheck().catch(()=>({connections:[]}))).connections.find(c=>c.id==='claude-desktop');
 assert.equal(connection,undefined,'without a profile there is no connection to report');

 const outcome=await probe.server({command:process.execPath,args:[path.join(__dirname,'..','mcp-server.cjs')],env:{CLAUDIAN_DATA:path.join(os.tmpdir(),'claudian-absent-'+Date.now())}},'claude-desktop');
 assert.equal(outcome.state,'broken');
 assert.match(outcome.detail,/kurulu değil|not/i);
});

test('a command that does not exist is broken rather than hanging',async t=>{
 const outcome=await probe.server({command:path.join(os.tmpdir(),'claudian-no-such-binary.exe'),args:[]},'claude-desktop');
 assert.equal(outcome.state,'broken');
 assert.ok(outcome.detail);
});

test('a connection with no local server is unknown, never broken',async t=>{
 assert.equal((await probe.server(null,'cursor')).state,'unknown');
});

// A clean install must not report itself broken. The hook lives inside a JSON structure, and a
// Windows command is full of backslashes that JSON doubles on the way to disk -- searching the
// raw text for it never matched, so Claude Code came back "files: broken" the moment it was
// installed. Measured 13.09.2026 on the packaged build.
test('a fresh installation reports nothing broken',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-fresh-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home');await fs.mkdir(home);
 const core=new MemorySetup({home,dataDir:path.join(root,'data'),launcher:process.execPath,mcpScript:path.join(__dirname,'..','mcp-server.cjs'),codexHome:path.join(home,'.codex')});
 await core.install((await core.prepare({name:'Deniz',vault:path.join(root,'notes'),mode:'new',storage:'markdown',
   hosts:['claude-code','codex','claude-desktop'],language:'en',access:'write'})).id,true);

 const report=await core.selfCheck();
 for(const connection of report.connections){
  const named=(connection.fileStates||[]).filter(f=>f.state!=='ready').map(f=>f.kind+':'+f.state).join(', ');
  assert.deepEqual(connection.failing,[],connection.label+' should be clean but reports '+(named||connection.failing.join(',')));
 }
});

// Codex registers the same local server, in its own TOML. Leaving the entry out of the recorded
// artifacts made the automatic check say "this connection has no local server" about a
// connection that had one -- honest-sounding and wrong.
test('Codex is probed like any other connection that runs a local server',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-codex-probe-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home');await fs.mkdir(home);
 const core=new MemorySetup({home,dataDir:path.join(root,'data'),launcher:process.execPath,
   mcpScript:path.join(__dirname,'..','mcp-server.cjs'),codexHome:path.join(home,'.codex')});
 await core.install((await core.prepare({name:'Deniz',vault:path.join(root,'notes'),mode:'new',storage:'markdown',
   hosts:['codex'],language:'en',access:'write'})).id,true);

 const codex=(await core.selfCheck()).connections.find(c=>c.id==='codex');
 assert.equal(codex.checks.server.state,'ready',codex.checks.server.detail||'');
 assert.ok(codex.checks.server.tools.includes('startup_context'));
 assert.deepEqual(codex.failing,[]);
});
