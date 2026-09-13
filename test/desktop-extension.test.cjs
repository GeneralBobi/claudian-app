'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {desktopEntries}=require('../connector-package.cjs');
const {ask}=require('../probe.cjs');
test('desktop extension launches the real server with the selected profile and host',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-extension-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dataDir=path.join(root,'data'),vault=path.join(root,'existing notes');await fs.mkdir(dataDir);await fs.mkdir(vault);
 for(const [n,b]of Object.entries(require('../welcome.cjs').skeleton('en','Test',['claude-desktop'],{'claude-desktop':'Claude'})))await fs.writeFile(path.join(vault,n),b);
 await fs.writeFile(path.join(dataDir,'profile.json'),JSON.stringify({vault,access:'write',language:'en',hosts:[{id:'claude-desktop'}]}));
 const installed=process.env.CLAUDIAN_TEST_INSTALLED;
 const files=desktopEntries({launcher:installed||process.execPath,mcpScript:installed?path.join(path.dirname(installed),'resources','app.asar','mcp-server.cjs'):path.join(__dirname,'..','mcp-server.cjs'),dataDir});
 for(const [n,b]of Object.entries(files))await fs.writeFile(path.join(root,n),b);
 const manifest=JSON.parse(files['manifest.json']);assert.equal(manifest.manifest_version,'0.3');
 assert.ok(!JSON.stringify(files).includes(vault),'extension resolves vault from the live profile');
 const result=await ask({command:process.execPath,args:[path.join(root,'server.cjs')]},[
  {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}},
  {jsonrpc:'2.0',id:2,method:'tools/list'},
  {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'startup_context',arguments:{}}}
 ]);
 assert.equal(result.ok,true,JSON.stringify(result));
 const replies=result.replies;assert.ok(replies,JSON.stringify(result));
 assert.ok(replies.get(2).result.tools.some(tool=>tool.name==='capture'));
 assert.ok(JSON.stringify(replies.get(3)).includes('not_offered'));
 const call=async(name,args)=>{
  const r=await ask({command:process.execPath,args:[path.join(root,'server.cjs')]},[{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}]);
  assert.equal(r.ok,true);const response=r.replies.get(1);assert.ok(!response.error,JSON.stringify(response));assert.ok(!response.result.isError,JSON.stringify(response));return response.result;
 };
 await call('capture',{kind:'preference',text:'Prefers concise explanations'});
 const about=await fs.readFile(path.join(vault,'About Me.md'),'utf8');
 assert.ok(about.includes('Prefers concise explanations'));
 const all=await call('read_note',{note:'About Me.md'});
 assert.ok(JSON.stringify(all).includes('Prefers concise explanations'));
 const store=require('../memory-store.cjs');
 const current=await store.read(vault,'About Me.md');
 await call('patch_note',{note:'About Me.md',expected_sha256:current.sha256,old_text:'Prefers concise explanations',new_text:'Prefers detailed explanations',reason:'User corrected the preference'});
 assert.ok((await store.read(vault,'About Me.md')).body.includes('Prefers detailed explanations'));
 await call('write_note',{note:'Disposable acceptance note.md',body:'# Disposable acceptance note\nOnly synthetic content.',reason:'Test reversible retirement'});
 const disposable=await store.read(vault,'Disposable acceptance note.md');
 await call('archive_note',{note:disposable.note,expected_sha256:disposable.sha256,reason:'User withdrew this synthetic note'});
 await assert.rejects(fs.access(path.join(vault,disposable.note)),{code:'ENOENT'});
});
