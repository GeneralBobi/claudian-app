'use strict';
// The setup window reloads the whole page when it hands over to the panel. Anything the
// renderer set before that call is gone, so "Set up AI connections" used to land the person
// on Memory -- the one screen that makes an unfinished setup look finished.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

const main=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
const preload=fs.readFileSync(path.join(__dirname,'../preload.cjs'),'utf8');
const renderer=fs.readFileSync(path.join(__dirname,'../ui/renderer.js'),'utf8');

test('app:enter carries a destination across the reload and preload passes it through',()=>{
  assert.match(main,/handle\('app:enter', async \(view\)/,'the handler has to receive a view');
  assert.match(main,/entryView = \['home','connections'\]\.includes\(view\)/,'only known views are accepted');
  assert.match(preload,/enter: view => invoke\('app:enter', view\)/);
});

test('the destination is delivered once and then cleared',()=>{
  const handler=main.slice(main.indexOf("handle('app:snapshot'"),main.indexOf("handle('setup:review'"));
  assert.match(handler,/const view=entryView; entryView='';/,'a sticky view would trap the user on one screen');
  assert.match(handler,/entryView:view/);
});

test('the renderer honours the delivered view at boot',()=>{
  assert.match(renderer,/if\(state\.entryView\)view=state\.entryView;/);
  assert.match(renderer,/const target=a==='enter-verify'\?'connections':'';/);
  assert.match(renderer,/await api\.enter\(target\)/);
});

test('an unknown view cannot be injected through the channel',()=>{
  const accept=view=>['home','connections'].includes(view)?view:'';
  assert.equal(accept('connections'),'connections');
  assert.equal(accept('home'),'home');
  assert.equal(accept('settings'),'');
  assert.equal(accept('../../etc'),'');
  assert.equal(accept(undefined),'');
});
