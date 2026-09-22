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
  const context={state:{profile:null},healthData:null,remoteStatus:{progress:{}},tunnelState:null,reviewResults:{},
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
  assert.equal(c.setupState(),'AI_SELECTED_NOT_CONNECTED','a legacy relay does not prove the personal tunnel');
  c.tunnelState={phase:'ready'};
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

// --- 0.19.2 ------------------------------------------------------------------------------
// These are named after what the user reported, not after the code that answers it. The
// previous suite was green while the screens were visibly wrong, which is the failure mode
// worth testing against.

test('no setup control pulses, blinks or is otherwise animated',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../ui/styles.css'),'utf8');
  const renderer=fs.readFileSync(path.join(__dirname,'../ui/renderer.js'),'utf8');
  assert.doesNotMatch(css,/recommend-pulse/,'the pulse keyframes are gone, not merely unreferenced');
  assert.doesNotMatch(css,/@keyframes\s+(recommend-pulse|check-reveal|connection-enter)/);
  assert.doesNotMatch(css,/\.recommended\b/,'the class that existed only to carry the pulse is gone');
  assert.doesNotMatch(renderer,/class="primary recommended"/);
  assert.doesNotMatch(renderer,/['"`]recommended['"`]/,'no CTA is given the old pulse class');
  // The emphasis that replaced it must be static: colour, weight and border only.
  const block=css.slice(css.indexOf('.next-step{'),css.indexOf('.callout-warn{'));
  assert.ok(block.includes('.next-step{'),'the next-step emphasis exists');
  assert.doesNotMatch(block,/animation/,'the next step is emphasised, never animated');
  assert.match(block,/border-color:var\(--orange\)/);
  // Only a spinner may still move, and only while something is actually running.
  const keyframes=[...css.matchAll(/@keyframes\s+([a-z-]+)/g)].map(m=>m[1]);
  assert.deepEqual(keyframes,['verify-spin'],'the only remaining animation belongs to work in progress');
});

test('every pending action is aimed at something, and none of them is a no-op',()=>{
  // "Erişimi doğrula" sat on the connections screen and its action was "go to the connections
  // screen": pressed from where it was drawn, it re-rendered the same page and nothing about
  // the installation changed. Measured on 0.19.1.
  const c=machine({state:{hosts:[],profile:{storage:'obsidian',vault:'v',hosts:[{id:'claude-code'}]}},
    connectionList:[{id:'claude-code',status:'ready',access:{state:'granted'}}],
    healthData:{hosts:[],verifiedCount:0}});
  assert.equal(c.setupState(),'VERIFY_PENDING');
  const a=c.nextAction();
  assert.ok(a,'a pending state must still offer an action');
  assert.notEqual(a.action,'goto-connections','the banner lives on that screen; going there changes nothing');
  assert.equal(a.action,'start-verification');
  assert.equal(a.host,'claude-code','the action names the connection it will test');
});

test('a verification button is not offered when there is nothing it could test',()=>{
  // Better no control than a control that answers with silence.
  const c=machine({state:{hosts:[],profile:{storage:'obsidian',vault:'v',access:'read',hosts:[{id:'claude-code'}]}},
    connectionList:[{id:'claude-code',status:'ready',access:{state:'granted'}}],
    healthData:{hosts:[],verifiedCount:0}});
  assert.equal(c.setupState(),'VERIFY_PENDING');
  assert.equal(c.nextAction(),null,'a read-only connection cannot write a test answer');
});

test('Antigravity CLI is an entry point, not a second AI application',()=>{
  const core=require('../core.cjs');
  assert.deepEqual(core.COMPANIONS.antigravity,['antigravity-cli']);
  assert.equal(core.VARIANT_OF['antigravity-cli'],'antigravity');
  assert.equal(core.VARIANT_OF.antigravity,undefined);
  // Choosing the provider carries both entry points.
  assert.deepEqual(core.withCompanions(['antigravity']),['antigravity','antigravity-cli']);
  assert.deepEqual(core.withCompanions(['antigravity'],['antigravity-cli']),['antigravity'],
    'an entry point already installed is not reinstalled');
  // Keeping the provider keeps both, so an unseen card never reads as "unticked".
  assert.deepEqual(core.expandCompanions(['antigravity']),['antigravity','antigravity-cli']);
  // And the product never draws the secondary entry point as a provider of its own.
  const renderer=fs.readFileSync(path.join(__dirname,'../ui/renderer.js'),'utf8');
  for(const guard of ['h=>!h.variantOf','filter(h=>!h.variantOf)'])
    assert.ok(renderer.includes(guard)||renderer.includes('!h.variantOf'),'provider lists filter variants');
  assert.ok(renderer.includes('mergedConnections('),'the connection grid merges entry points');
});

test('Spark opens Spark, and the manual fallback says that it is one',()=>{
  const {providers}=require('../web-providers.cjs');
  assert.equal(providers.gemini.chat,'https://gemini.google.com/spark','the primary action opens Spark');
  assert.equal(providers.gemini.manual,'https://gemini.google.com/app','ordinary Gemini chat is the fallback only');
  const main=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
  assert.doesNotMatch(main,/openExternal\('https:\/\/gemini\.google\.com\/app'\)/,
    'no hard-coded /app remains beside the Spark product');
  const renderer=fs.readFileSync(path.join(__dirname,'../ui/renderer.js'),'utf8');
  const label=renderer.slice(renderer.indexOf("'gemini-web-guide'")-260,renderer.indexOf("'gemini-web-guide'"));
  assert.match(label,/manuel payla|manual sharing/i,'the fallback is labelled as manual sharing');
});

test('a provider requirement is quoted from the vendor, never invented',()=>{
  const c=machine();
  const chatgpt=c.hostRequirement?c.hostRequirement('chatgpt'):null;
  const renderer=fs.readFileSync(path.join(__dirname,'../ui/renderer.js'),'utf8');
  const source=renderer.slice(renderer.indexOf('const hostRequirement='),renderer.indexOf('function webHostCard('));
  assert.match(source,/Business/, 'the write-capable plan requirement is stated');
  assert.match(source,/Pro/, 'the read-only path is stated in the same sentence, not as a second badge');
  assert.match(source,/web only|web \u00fczerinde/i);
  // One sentence, one answer. Two badges that contradict each other is the defect.
  assert.equal(source.match(/chatgpt:t\(/g).length,1);
  assert.equal((renderer.match(/const hostRequirement=/g)||[]).length,1,'one source for a requirement');
  assert.equal(chatgpt===null||typeof chatgpt==='string',true);
});

test('a first review is not closed by prose, and a web report needs evidence of a real scan',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../first-review.cjs'),'utf8');
  // The provider's own words are never parsed for success.
  assert.match(source,/value\.request_id!==r\.id\|\|value\.value!==r\.nonce/);
  // The token travels with the instruction, because read_first_review is blocked on Spark.
  assert.match(source,/Claudian first review token/);
  assert.match(source,/SCAN_EVIDENCE/);
  assert.match(source,/no-scan-evidence/);
  // A rejected report is an outcome the screen shows, not twenty-four hours of "waiting".
  assert.match(source,/r\.rejected\)return \{status:'invalid'/);
  const capabilities=fs.readFileSync(path.join(__dirname,'../memory-capabilities.cjs'),'utf8');
  assert.match(capabilities,/submit\(dataDir,vault,actor,args,options\.activity\)/);
  const http=fs.readFileSync(path.join(__dirname,'../remote-http.cjs'),'utf8');
  assert.match(http,/activity:\(\)=>this\.auth\.activity\(grant\.id\)/);
});

test('the global memory seed carries no personal path or name',()=>{
  // The seed goes to every installation. One personal path in it is a defect for everyone.
  for(const file of ['policy.cjs','scan.cjs','welcome.cjs','core.cjs']){
    const body=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert.doesNotMatch(body,/C:\\\\Users\\\\[A-Z]/i,file+' hard-codes a user folder');
    assert.doesNotMatch(body,/Boran/,file+' names a person');
    assert.doesNotMatch(body,/Documents\\\\Claudian/,file+' hard-codes a vault path');
  }
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
