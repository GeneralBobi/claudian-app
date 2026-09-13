'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const run=require('node:util').promisify(require('node:child_process').execFile);
test('Windows PowerShell passes one prompt through npm cmd in a Turkish spaced path',{skip:process.platform!=='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'launch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dir=path.join(root,'Boran Birtanır’ın notes');await fs.mkdir(dir);
 await fs.writeFile(path.join(dir,'capture.cjs'),'console.log(JSON.stringify(process.argv.slice(2)))');
 const exe=path.join(dir,'fake.cmd');await fs.writeFile(exe,'@"'+process.execPath+'" "%~dp0capture.cjs" %*\r\n');
 for(const host of ['codex','claude-code','gemini-cli']){
  const script=require('../scan.cjs').commandScript(dir,exe,'.claudian-session-123.md',host);
  const {stdout}=await run('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});
  const args=JSON.parse(stdout.trim());assert.deepEqual(args,host==='gemini-cli'?['-i','Read .claudian-session-123.md and follow its instructions.']:['Read .claudian-session-123.md and follow its instructions.']);
 }
});
