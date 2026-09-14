'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {ordinary,digest}=require('./memory-store.cjs');
async function active(dataDir,vault,actor){
 const profileFile=path.join(dataDir,'profile.json');await ordinary(profileFile);
 const profile=JSON.parse(await fs.readFile(profileFile,'utf8'));
 const c=profile.hosts?.find(h=>h.id===actor)?.challenge;
 if(path.resolve(profile.vault)!==path.resolve(vault)||!c)throw Error('No active test for this connection.');
 const age=Date.now()-Date.parse(c.issuedAt);
 if(!Number.isFinite(age)||age<0||age>30*60*1000)throw Error('Connection test expired. Start a new test in Claudian.');
 const basename=path.basename(c.input);
 if(!basename.startsWith(`.claudian-check-${actor}-`)||!/^\.claudian-check-[a-z-]+-[a-f0-9-]+\.md$/.test(basename)||path.resolve(c.input)!==path.join(path.resolve(vault),basename)||c.output!==c.input.replace(/\.md$/,'-response.md'))throw Error('Invalid test destination.');
 await ordinary(c.input);await ordinary(c.output);
 if((await fs.stat(c.input)).size>1024)throw Error('Invalid test input.');
 const content=await fs.readFile(c.input,'utf8');
 if(digest(content)!==c.inputHash)throw Error('Test input changed. Start a new test.');
 return {profile,c,content};
}
exports.read=async(dataDir,vault,actor)=>{const {c,content}=await active(dataDir,vault,actor);return {test_id:path.basename(c.input),content};};
exports.submit=async(dataDir,vault,actor,args)=>{
 const {profile,c}=await active(dataDir,vault,actor);
 if(profile.access!=='write')throw Error('This connection has read-only access.');
 if(args.test_id!==path.basename(c.input)||args.value!==c.nonce)throw Error('Test response does not match.');
 await fs.writeFile(c.output,args.value+'\n',{flag:'wx'});
 if(require('./cloud-progress.cjs').webOnly(actor)){
  const dir=path.join(dataDir,'connection-receipts');await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,path.basename(c.input)+'.json'),JSON.stringify({host:actor,inputHash:c.inputHash}),{flag:'wx'});
 }
 return {submitted:true,message:'Test response written. Claudian will verify the file; this does not prove long-term memory maintenance.'};
};
