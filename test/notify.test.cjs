'use strict';
// Notification discipline. A notifier that can fire twenty times has already taught the
// person to ignore it, so the rules matter more than the delivery.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const notify=require('../notify.cjs');

async function dir(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-notify-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return root;
}
const raised=(detail,over={})=>({kind:'attention_raised',detail,host:null,label:null,at:'2026-09-21T09:00:00.000Z',...over});
const DAY=24*60*60*1000;
const T0=Date.parse('2026-09-21T09:00:00.000Z');

test('only a transition notifies, and only a kind on the list',async t=>{
  const d=await dir(t);
  // A level is not news. Attention that merely still exists must never produce a toast.
  assert.deepEqual(await notify.decide(d,[{kind:'setup_changed',to:'VERIFY_PENDING',at:'x'}],{now:T0}),[]);
  // Neither is a kind that belongs in the panel rather than in front of the person.
  assert.deepEqual(await notify.decide(d,[raised('verification_pending')],{now:T0}),[]);
  assert.deepEqual(await notify.decide(d,[raised('first_review_superseded')],{now:T0}),[]);
  // An authorization waiting for approval is worth interrupting for.
  const out=await notify.decide(d,[raised('authorization_waiting',{label:'ChatGPT'})],{now:T0});
  assert.equal(out.length,1);
  assert.equal(out[0].urgency,'critical');
  assert.match(out[0].body,/ChatGPT/);
});

test('the same worry does not arrive twice in a day, and a different one still does',async t=>{
  const d=await dir(t);
  const first=await notify.decide(d,[raised('connection_broken',{host:'codex',label:'Codex'})],{now:T0});
  assert.equal(first.length,1);
  const again=await notify.decide(d,[raised('connection_broken',{host:'codex',label:'Codex'})],{now:T0+60000});
  assert.deepEqual(again,[],'same kind, same connection, same day');
  const other=await notify.decide(d,[raised('connection_broken',{host:'gemini',label:'Spark'})],{now:T0+60000});
  assert.equal(other.length,1,'a different connection is a different fact');
  const tomorrow=await notify.decide(d,[raised('connection_broken',{host:'codex',label:'Codex'})],{now:T0+DAY+1000});
  assert.equal(tomorrow.length,1,'a day later it may be said again');
});

test('a daily ceiling holds even when everything breaks at once',async t=>{
  const d=await dir(t);
  const many=['a','b','c','d','e'].map(h=>raised('connection_broken',{host:h,label:h.toUpperCase()}));
  const out=await notify.decide(d,many,{now:T0});
  assert.equal(out.length,notify.DAILY_BUDGET);
  assert.ok(notify.DAILY_BUDGET<=3,'the budget is small on purpose');
  // And the ones that did not fit are not queued up to arrive later the same day.
  assert.deepEqual(await notify.decide(d,many,{now:T0+60000}),[]);
});

test('resolution is silent',async t=>{
  const d=await dir(t);
  await notify.decide(d,[raised('connector_offline')],{now:T0});
  const cleared=await notify.decide(d,[{kind:'attention_cleared',detail:'connector_offline',at:'x'}],{now:T0+DAY+1000});
  assert.deepEqual(cleared,[],'good news does not interrupt');
});

test('turning notifications off turns them off',async t=>{
  const d=await dir(t);
  assert.deepEqual(await notify.decide(d,[raised('authorization_waiting')],{now:T0,enabled:false}),[]);
  // And nothing was recorded, so switching back on does not swallow the next one.
  assert.equal((await notify.decide(d,[raised('authorization_waiting')],{now:T0})).length,1);
});

test('a due reminder speaks in the vault language',async t=>{
  const d=await dir(t);
  const tr=await notify.decide(d,[raised('reminder_due',{label:'Sınav'})],{now:T0,language:'tr'});
  assert.match(tr[0].body,/^Bugün: Sınav$/);
  const en=await notify.decide(d,[raised('reminder_overdue',{label:'Invoice'})],{now:T0,language:'en'});
  assert.match(en[0].body,/^Past due: Invoice$/);
});
