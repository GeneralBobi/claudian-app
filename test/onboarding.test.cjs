'use strict';
// Onboarding contract for 0.19.0. Each test corresponds to a defect measured in 0.18.7.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const os=require('node:os'),fsp=require('node:fs/promises');
const {MemorySetup,HOSTS,KNOWN}=require('../core.cjs');

// Loads the derived-state block out of the renderer and runs it against a fixture, the same
// way cloud-setup.test.cjs does for the connection wizard.
function machine(overrides={}){
  const source=fs.readFileSync(path.join(__dirname,'../ui/renderer.js'),'utf8');
  const slice=source.slice(source.indexOf('const remoteId='),source.indexOf('const recommended='));
  const context={state:{profile:null},healthData:null,remoteStatus:{progress:{}},reviewResults:{},
    connectionList:[],obsidianPresent:true,obsidianNeedsClose:false,
    t:(en,tr)=>en,esc:s=>String(s)};
  Object.assign(context,overrides);
  vm.createContext(context);vm.runInContext(slice,context);return context;
}
const ready=()=>({profile:{storage:'obsidian',vault:'v',hosts:[{id:'claude-code'}]}});

test('Obsidian is the default note application even when it is not installed yet',async t=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'claudian-onboard-'));
  t.after(()=>fsp.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'home');await fsp.mkdir(home,{recursive:true});
  const core=new MemorySetup({home,dataDir:path.join(root,'data')});
  const {suggested}=await core.discover();
  // 0.18.7 proposed Markdown whenever Obsidian.exe was absent, which is every fresh machine,
  // so the first question of the wizard read as a storage-format decision.
  assert.equal(suggested.storage,'obsidian');
});

test('setup is not complete while a selected AI has no usable connection',()=>{
  const c=machine();
  assert.equal(c.setupState(),'AI_NOT_SELECTED');
  c.state={profile:{storage:'obsidian',vault:'v',hosts:[{id:'chatgpt'}]}};
  c.healthData={hosts:[],verifiedCount:0};
  assert.equal(c.setupState(),'AI_SELECTED_NOT_CONNECTED','selected is not connected');
  c.remoteStatus={progress:{chatgpt:{canTest:true}}};
  assert.equal(c.setupState(),'VERIFY_PENDING','connected is not verified');
  c.healthData={hosts:[{id:'chatgpt',state:'verified'}],verifiedCount:1};
  assert.equal(c.setupState(),'READY');
});

test('skipping verification is an explicit state, never a silent completion',()=>{
  const c=machine({state:ready(),connectionList:[{id:'claude-code',status:'ready',access:{state:'granted'}}]});
  c.healthData={hosts:[],verifiedCount:0};
  assert.equal(c.setupState(),'VERIFY_PENDING');
  c.healthData={hosts:[],verifiedCount:0,skippedAt:'2026-09-20T00:00:00.000Z'};
  assert.equal(c.setupState(),'READY','a deliberate skip is honoured, not nagged forever');
});

test('a missing folder outranks every other complaint',()=>{
  const c=machine({state:{profile:{storage:'obsidian',vault:'v',hosts:[]},vaultMissing:true},obsidianPresent:false});
  assert.equal(c.setupState(),'VAULT_MISSING');
});

test('restart is only claimed when the application actually reported it',()=>{
  const c=machine({state:ready(),connectionList:[{id:'claude-code',status:'ready',access:{state:'granted'}}],
    healthData:{hosts:[],verifiedCount:1}});
  assert.equal(c.setupState(),'READY');
  c.obsidianNeedsClose=true;
  assert.equal(c.setupState(),'OBSIDIAN_RESTART_REQUIRED');
  c.obsidianNeedsClose=false;c.obsidianPresent=false;
  assert.equal(c.setupState(),'OBSIDIAN_MISSING');
});

test('every unfinished state yields exactly one action with a label and a destination',()=>{
  const c=machine();
  const cases=[
    [{state:{profile:{storage:'obsidian',vault:'v',hosts:[]},vaultMissing:true}},'VAULT_MISSING'],
    [{state:ready(),obsidianPresent:false},'OBSIDIAN_MISSING'],
    [{state:ready(),obsidianNeedsClose:true},'OBSIDIAN_RESTART_REQUIRED'],
    [{state:{profile:{storage:'obsidian',vault:'v',hosts:[]}}},'AI_NOT_SELECTED'],
    [{state:{profile:{storage:'obsidian',vault:'v',hosts:[{id:'chatgpt'}]}}},'AI_SELECTED_NOT_CONNECTED']];
  for(const entry of cases){
    Object.assign(c,{state:{profile:null},obsidianPresent:true,obsidianNeedsClose:false,
      healthData:{hosts:[],verifiedCount:0},connectionList:[],remoteStatus:{progress:{}}},entry[0]);
    assert.equal(c.setupState(),entry[1]);
    const a=c.nextAction();
    assert.ok(a&&a.en&&a.tr&&a.action,'a state without an action leaves the user stuck: '+entry[1]);
  }
  Object.assign(c,{state:ready(),connectionList:[{id:'claude-code',status:'ready',access:{state:'granted'}}],
    healthData:{hosts:[],verifiedCount:1}});
  assert.equal(c.nextAction(),null,'a finished setup pulses nothing');
});

test('reduced motion replaces the pulse with a static border instead of removing the signal',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../ui/styles.css'),'utf8');
  const block=css.slice(css.indexOf('.recommended{'));
  assert.match(block,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(block,/\.recommended\{animation:none;box-shadow:/);
});

test('provider names state only what this repository can prove',()=>{
  assert.equal(HOSTS.gemini.label,'Spark');
  const source=fs.readFileSync(path.join(__dirname,'../ui/renderer.js'),'utf8');
  assert.match(source,/function providerBadge/);
  // No plan tier is recorded anywhere in this codebase, so none may be displayed.
  for(const file of ['../ui/renderer.js','../web-providers.cjs','../core.cjs']){
    const body=fs.readFileSync(path.join(__dirname,file),'utf8');
    assert.doesNotMatch(body,/Requires (Plus|Pro|Team|Enterprise)/i,'invented plan requirement in '+file);
  }
});

test('the internal gemini identifier is untouched so existing profiles keep resolving',()=>{
  assert.ok(Object.hasOwn(HOSTS,'gemini'),'renaming the id would strand every installed profile');
  assert.ok(Object.hasOwn(KNOWN,'gemini'));
  const providers=require('../web-providers.cjs');
  assert.ok(providers.isWeb('gemini'));
  assert.equal(providers.providers.gemini.label,'Spark');
});

test('a renamed provider reaches profiles installed before the rename',async t=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'claudian-rename-'));
  t.after(()=>fsp.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'home'),dataDir=path.join(root,'data');
  await fsp.mkdir(home,{recursive:true});await fsp.mkdir(dataDir,{recursive:true});
  const vault=path.join(root,'vault');await fsp.mkdir(vault);
  const core=new MemorySetup({home,dataDir});
  // A profile written by 0.18.7 carries the old display name on disk.
  await fsp.writeFile(core.configFile,JSON.stringify({vault,language:'en',access:'write',
    hosts:[{id:'gemini',label:'Gemini',status:'configured'}],files:[]}));
  const health=await core.health();
  assert.equal(health.hosts[0].label,'Spark','the live registry name wins over the stored copy');
  const stored=JSON.parse(await fsp.readFile(core.configFile,'utf8'));
  assert.equal(stored.hosts[0].label,'Gemini','nothing on disk was migrated');
});
