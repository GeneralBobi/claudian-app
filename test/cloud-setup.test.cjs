'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {progress}=require('../cloud-progress.cjs');
test('permission alone never opens tests; evidence is not merged across grants',()=>{
 const s={enabled:true,state:'online',grants:[{id:'a',host:'chatgpt',scope:'claudian.read claudian.write'}]};
 assert.equal(progress(s,'chatgpt').canTest,false);
 s.grants[0].tokenExchangedAt='now';assert.equal(progress(s,'chatgpt').phase,'loading');
 s.grants.push({id:'b',host:'gemini',toolsReadyAt:'now',scope:'claudian.read claudian.write'});
 assert.equal(progress(s,'chatgpt').canTest,false);
 s.grants[0].toolsReadyAt='now';assert.equal(progress(s,'chatgpt').canTest,true);
 s.state='offline';assert.equal(progress(s,'chatgpt').canTest,false);
 s.state='online';s.grants[0].revoked=true;assert.equal(progress(s,'chatgpt').canTest,false);
});
function renderFixture(){
 const source=fs.readFileSync(path.join(__dirname,'../ui/renderer.js'),'utf8'),storage=new Map();
 const context={state:{profile:{vault:'fixture'}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},remoteStatus:{progress:{},requests:[]},healthData:{hosts:[]},t:(en,tr)=>tr,esc:s=>String(s),checkIcon:'<svg></svg>',btn:(en,tr,action,primary,extra='')=>`<button class="${primary?'primary':''}" data-action="${action}" ${extra}>${tr}</button>`,verifyRow:()=>'<p>ACTUAL_TEST</p>',firstScanRow:()=>'',memoryRow:()=>''};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function setupKey('),source.indexOf('function remoteHostCard(')),context);return context;
}
test('all three guides start with setup, stop on missing option, and keep repair reachable',()=>{
 const c=renderFixture();
 for(const id of ['chatgpt','gemini','perplexity']){
  const h={id,label:id};let html=c.webHostCard(h);
  assert.match(html,/Kuruluma başla/);assert.doesNotMatch(html,/ACTUAL_TEST/);
  assert.equal((html.match(/class="primary"/g)||[]).length,1);
  c.saveSetupStep(id,'unavailable');html=c.webHostCard(h);assert.match(html,/Bu hesapla burada devam edilemiyor/);assert.doesNotMatch(html,/ACTUAL_TEST/);
  c.remoteStatus.progress[id]={phase:'loading',canTest:false};c.saveSetupStep(id,'repair');assert.match(c.webHostCard(h),/Mevcut bağlantıdan devam et/);
  c.saveSetupStep(id,'form');assert.match(c.webHostCard(h),/Cihaz adresin hazır/);
  c.remoteStatus.progress[id]={phase:'tools',canTest:true};assert.match(c.webHostCard(h),/ACTUAL_TEST/);
 }
});
module.exports={renderFixture};
