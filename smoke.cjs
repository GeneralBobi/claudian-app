'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async({win,core,app,home})=>{const output=process.env.CLAUDIAN_SMOKE_OUTPUT||path.join(core.dataDir,'smoke-output');await fs.mkdir(output,{recursive:true});const js=s=>win.webContents.executeJavaScript(s).catch(e=>{throw Error(s+' :: '+e.message)});const wait=async s=>{const end=Date.now()+15000;while(Date.now()<end){if(await js(s))return;await new Promise(r=>setTimeout(r,80));}throw Error('UI timeout: '+s);};const click=async s=>{await wait(`!!document.querySelector(${JSON.stringify(s)})`);return js(`document.querySelector(${JSON.stringify(s)}).click()`);};const grant=async(action='install')=>{await wait('!!document.querySelector("#grant-confirm")');assert.equal(await js(`document.querySelector("[data-action=${action}]").disabled`),true,'granting is a required act, so the button starts closed');await js('const b=document.querySelector("#grant-confirm");b.checked=true;b.dispatchEvent(new Event("change",{bubbles:true}))');await wait(`!document.querySelector("[data-action=${action}]").disabled`);};try{
 await wait('!!document.querySelector("#name")');assert.equal(await js('document.documentElement.lang'),'en');
 await js(`document.querySelector('#name').value='Deniz';document.querySelector('#vault').value=${JSON.stringify(path.join(home,'Notes'))};document.querySelectorAll('[name=host]').forEach(x=>x.checked=true)`);
 await click('[data-action=preview]');await wait('!!document.querySelector("[data-action=install]")');assert.ok(await js('!!document.querySelector(".grant .grant-body")'),'izin karti iki sutunlu olmali');assert.equal(await js('document.querySelectorAll(".grant-col > h2").length'),2,'basliklar yan yana durmali');assert.equal(await js('getComputedStyle(document.querySelector(".grant-body")).gridTemplateColumns.split(" ").length'),2,'iki sutun gercekten olusmali');assert.ok(await js('document.querySelectorAll(".grant .caps li").length>=6'),'yetenekler listelenmeli');assert.equal(await js('document.querySelectorAll("[name=grant-scope]").length'),2,'kapsam acikca secilir');await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await new Promise(r=>setTimeout(r,300));await js('document.querySelector(".grant").scrollIntoView({block:"center"})');await new Promise(r=>setTimeout(r,200));await fs.writeFile(path.join(output,'consent.png'),(await win.webContents.capturePage()).toPNG());await click('[data-action=back]');await wait('!!document.querySelector("#name")');await click('[data-action=preview]');await wait('!!document.querySelector("[data-action=install]")');await grant();await click('[data-action=install]');await wait('!!document.querySelector(".connection-grid")');assert.equal(await js('document.querySelector("[data-action=enter-verify]")'),null,'setup goes directly to connections');
 // Obsidian is not installed in the smoke home, and a missing note application outranks
 // every other complaint. Setting that aside is what lets the pending-verification
 // banner be the thing under test here.
 await click('[data-action=connection-open][data-host=chatgpt]');
 await wait('!!document.querySelector("[data-action=chatgpt-method][data-method=tunnel]")');
 await fs.writeFile(path.join(output,'chatgpt-choice.png'),(await win.webContents.capturePage()).toPNG());
 await click('[data-action=chatgpt-method][data-method=tunnel]');
 await wait('!!document.querySelector("details.tunnel-settings")');
 assert.equal(await js('document.querySelector("details.tunnel-settings").open'),false);
 await fs.writeFile(path.join(output,'tunnel-choice.png'),(await win.webContents.capturePage()).toPNG());
 await click('details.tunnel-settings summary');
 await wait('!!document.querySelector("#tunnel-key")');
 assert.equal(await js('document.querySelector("#tunnel-key").type'),'password');
 assert.equal(await js('document.querySelector("[data-action=tunnel-start]").disabled'),true);
 assert.ok(await js('!document.querySelector("dialog").textContent.includes("boranbirtanir.workers.dev")'));
 await fs.writeFile(path.join(output,'secure-tunnel.png'),(await win.webContents.capturePage()).toPNG());
 await click('[data-action=chatgpt-method][data-method=choose]');await click('[data-action=chatgpt-method][data-method=mcp]');
 await wait('!!document.querySelector("#relay-url")');
 await click('[data-action=connection-close]');
 await js('obsidianPresent=true;obsidianNeedsClose=false;render()');
 // 4. The pending banner and its action. This is the control that did nothing in 0.19.1: it
 //    said "Verify access", it lived on the connections screen, and its action was "go to the
 //    connections screen". It must now name a connection and open a real test.
 await js('healthData={...healthData,verifiedCount:0,skippedAt:null,hosts:(healthData.hosts||[]).map(h=>({...h,state:"unverified"}))};void render()');
 await wait('!!document.querySelector(".setup-banner .next-step")');
 const pendingAction=await js('document.querySelector(".setup-banner .next-step").dataset.action');
 assert.notEqual(pendingAction,'goto-connections','the banner action must do something on the screen it lives on');
 assert.ok(await js('!!document.querySelector(".setup-banner .next-step").dataset.host'),'the action names its target');
 await fs.writeFile(path.join(output,'next-cta.png'),(await win.webContents.capturePage()).toPNG());
 await click('.setup-banner .next-step');
 await wait('!!document.querySelector("dialog[open]")');
 await wait('!!document.querySelector(".verify-row pre.prompt")');
 assert.ok(await js('document.querySelector(".verify-row pre.prompt").textContent.includes("claudian-check")'),'the press produced a real, device-issued test');
 await js('document.querySelector(".verify-row").scrollIntoView({block:"center"})');
 await new Promise(r=>setTimeout(r,300));
 await fs.writeFile(path.join(output,'verify-cta.png'),(await win.webContents.capturePage()).toPNG());
 await click('[data-action=challenge-close]');await click('[data-action=connection-close]');
 await wait('!document.querySelector("dialog[open]")');
 await js('void render()');await wait('!!document.querySelector("[data-view=connections]")');
 await click('[data-view=home]');await wait('!!document.querySelector("[data-action=obsidian]")');await click('[data-view=connections]');await click('[data-action=connection-open][data-host=codex]');await wait('!!document.querySelector("[data-action=remove]")');assert.equal((await core.snapshot()).profile.hosts.length,Object.keys(require('./core.cjs').HOSTS).length-1);
 await click('[data-view=home]');await wait('!!document.querySelector("[data-action=obsidian]")');assert.ok(await js('!!document.querySelector("[data-action=obsidian]")'),'memory view');assert.ok(await js('!!document.querySelector(".health-warn")'),'a fresh install has proven nothing and says so');assert.ok(await js('!document.querySelector(".health-warn").textContent.includes("write to your notes")'),'the warning is about proof, not a broken folder');
 assert.ok((await js('window.claudian.obsidian()')).startsWith('obsidian://open?path='));assert.ok(await js('window.claudian.configuration("codex","skill")'));
 await click('[data-view=connections]');await click('[data-action=connection-open][data-host=codex]');await wait('!!document.querySelector("[data-action=remove]")');// Antigravity is one provider with two entry points, so the grid shows one card and the
 // removal takes both. A second card for the terminal would invite connecting it twice.
 assert.equal(await js('document.querySelectorAll("[data-action=connection-open][data-host=antigravity-cli]").length'),0,'the CLI entry point is not a provider of its own');
 assert.ok(await js('!!document.querySelector("[data-action=connection-open][data-host=antigravity]")'));
 await js('selectedConnection="antigravity";void render()');await click('[data-action=remove][data-host=antigravity]');await click('[data-action=dismiss-remove]');assert.equal((await core.snapshot()).profile.hosts.length,Object.keys(require('./core.cjs').HOSTS).length-1);await js('selectedConnection="antigravity";void render()');await click('[data-action=remove][data-host=antigravity]');await click('[data-action=confirm-remove]');await wait('!document.querySelector("[data-action=remove][data-host=antigravity]")');
 assert.deepEqual((await core.snapshot()).profile.hosts.filter(h=>h.id.startsWith('antigravity')),[],'removing the provider takes both entry points');
 await click('[data-action=add-hosts]');await wait('!!document.querySelector("[name=host][value=antigravity]")');assert.equal(await js('document.querySelectorAll("[name=host][value=antigravity-cli]").length'),0,'the picker offers providers, not entry points');await js('document.querySelector("[name=host][value=antigravity]").checked=true');await click('[data-action=preview]');await wait('!!document.querySelector("[data-action=install]")');await grant();await click('[data-action=install]');await wait('!!document.querySelector(".connection-grid")');assert.equal(await js('document.querySelector("[data-action=enter-verify]")'),null);await wait('!!document.querySelector("[data-action=connection-open][data-host=antigravity]")');
 assert.deepEqual((await core.snapshot()).profile.hosts.filter(h=>h.id.startsWith('antigravity')).map(h=>h.id).sort(),['antigravity','antigravity-cli'],'choosing the provider restores both entry points');
 await win.loadURL('claudian://app/index.html');await wait('!!document.querySelector("[data-view=connections]")');await click('[data-view=connections]');await click('[data-action=connection-open][data-host=codex]');await wait('!!document.querySelector("[data-action=remove]")');assert.equal(await js('typeof require'),'undefined');assert.equal(await js('document.querySelector("#error").hidden'),true);
 await click('[data-view=companion]');
 // The embedded web companion panel was withdrawn on 10.09.2026 and the companion screen
 // is a local, under-construction surface. The invariant worth guarding is that no remote
 // view comes back and that the access code form is the only input offered here.
 // The panel knows this device's state by itself. It used to be a login form for a web Core
 // behind a tunnel started by hand, so with that machine down it asked for a code that could
 // not work and explained nothing.
 await wait('!!document.querySelector(".panel-section")');
 assert.ok(await js('!!document.querySelector(".panel-section")'),'the panel renders derived state');
 assert.equal(await js('document.querySelectorAll("#core-code").length'),0,'no access code is asked for');
 assert.ok(await js('document.body.textContent.includes("Connections")'),'connections are listed from the device itself');
 assert.ok(await js('!!panelState&&Array.isArray(panelState.attention)'),'attention is a derived list, not prose');
 assert.ok(await js('!!panelState.updatedAt'),'the panel states when it was derived');
 assert.equal(win.contentView.children.filter(v=>v.webContents&&v.webContents!==win.webContents).length,0,'no embedded remote view');
 await fs.writeFile(path.join(output,'panel-derived.png'),(await win.webContents.capturePage()).toPNG());
 assert.equal(await js('typeof require'),'undefined');
 assert.equal(await js('typeof window.claudian.internal'),'undefined');
 await click('[data-view=home]');await wait('!!document.querySelector("[data-action=obsidian]")');
 await click('[data-view=connections]');await click('[data-action=connection-open][data-host=codex]');await wait('!!document.querySelector("[data-action=remove]")');await click('[data-action=challenge-start][data-host=codex]');await wait('!!document.querySelector(".verify-row pre.prompt")');assert.ok(await js('document.querySelector(".verify-row pre.prompt").textContent.includes("claudian-check")'));await fs.writeFile(path.join(output,'verify.png'),(await win.webContents.capturePage()).toPNG());await wait('!!document.querySelector(".verify-row .verify-status")');assert.ok(await js('!!document.querySelector(".verify-row .verify-status").textContent'),'durum satiri kendiliginden belirmeli');assert.equal(await js('document.querySelector(".verify-status").dataset.state'),'ready');assert.ok(await js('!document.querySelector(".verify-spinner")'),'not waiting before sending');await js('void startVerification()');await wait('!!document.querySelector(".verify-spinner")');assert.equal(await js('getComputedStyle(document.querySelector(".verify-spinner")).animationName'),'verify-spin');await click('[data-action=challenge-close]');await wait('!document.querySelector(".verify-row pre.prompt")');assert.ok(await js('!!document.querySelector(".usage")'),'kullanim satiri gorunur olmali');assert.ok(await js('!!document.querySelector(".usage").closest("details")'),'kullanim ayrintilari acilabilir olmali');assert.ok(await js('document.querySelector(".caps-row").textContent.includes("startup_context")'),'teknik yetenekler yapilandirmada bulunmali');assert.ok(await js('!document.querySelector("[data-action=challenge-start][data-host=chatgpt]")'),'unavailable relay must not offer a working connection test');assert.ok(await js('!document.body.textContent.includes("https://claudian.app/mcp")'),'no invented remote endpoint');await fs.writeFile(path.join(output,'connections.png'),(await win.webContents.capturePage()).toPNG());await js('window.scrollTo(0,document.body.scrollHeight)');await new Promise(r=>setTimeout(r,300));await fs.writeFile(path.join(output,'connections-bottom.png'),(await win.webContents.capturePage()).toPNG());await click('[data-view=home]');await wait('!!document.querySelector("[data-action=obsidian]")');await fs.writeFile(path.join(output,'panel.png'),(await win.webContents.capturePage()).toPNG());await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,checks:['startup language is deterministic','preview back','six-host installation','silent local probe','Obsidian URI','configuration target','companion has no embedded remote view','removal cancellation','remove and reconnect','restart persistence','renderer isolation']}));await js('reviewing=true;selectedHosts=state.profile.hosts.map(h=>h.id);void render()');await wait('!!document.querySelector("[data-action=review-apply]")');// One card per provider, not one per entry point, and the cards are cards -- a bare
 // checkbox row cannot show that selected, connected and verified are three different facts.
 const core2=require('./core.cjs');
 const providers=Object.keys(core2.HOSTS).filter(id=>id!=='gemini'&&!core2.VARIANT_OF[id]);
 assert.equal(await js('document.querySelectorAll("[name=review-host]").length'),providers.length);
 assert.equal(await js('document.querySelectorAll("[name=review-host][value=antigravity-cli]").length'),0);
 assert.equal(await js('document.querySelectorAll(".host-card .host-card-found").length'),providers.length,'every provider card states its own evidence');
 assert.equal(await js('document.querySelectorAll("#content > p:not([class])").length'),1,'one lead sentence, not five body paragraphs before consent');
 assert.equal(await js('document.querySelectorAll("#content > p.hint").length'),1,'exactly one helper line');
 assert.ok(await js('!!document.querySelector("details.review-details")'),'security and legal detail sits one fold down');
 assert.ok(await js('!!document.querySelector("#grant-confirm")'),'consent stays visible');
 assert.equal(await js('document.querySelectorAll(".recommended").length'),0,'nothing on this screen pulses');
 await grant('review-apply');await click('[data-action=review-apply]');await wait('!!document.querySelector(".connection-grid")');assert.equal(await js('document.querySelector("[data-action=review-done]")'),null);assert.equal(await js('document.querySelector("#error").hidden'),true);await fs.writeFile(path.join(output,'reinstall.png'),(await win.webContents.capturePage()).toPNG());
 await click('[data-action=connection-open][data-host=codex]');await wait('!!document.querySelector("[data-action=challenge-start]")');
 // 0.18: complete a synthetic host receipt through the real IPC and verify persistence.
 await core.challenge('codex');
 const challengeRead=await require('./connection-test.cjs').read(core.dataDir,(await core.snapshot()).profile.vault,'codex');
 const profileBefore= (await core.snapshot()).profile;
 await require('./connection-test.cjs').submit(core.dataDir,profileBefore.vault,'codex',{test_id:challengeRead.test_id,value:profileBefore.hosts.find(h=>h.id==='codex').challenge.nonce});
 await core.verify('codex');await js('void render()');await click('[data-action=scan-open][data-host=codex]');
 await wait('!!document.querySelector("[data-action=copy-scan]")');
 const rr=await require('./first-review.cjs').read(core.dataDir,profileBefore.vault,'codex');
 await require('./first-review.cjs').submit(core.dataDir,profileBefore.vault,'codex',{request_id:rr.request_id,value:rr.value,status:'completed',summary:'Synthetic UI acceptance: entry notes read; no user notes changed.'});
 await wait('document.body.textContent.includes("Review completed")');
 await click('[data-action=scan-close]');await wait('!!document.querySelector(".review-report")');
 await js('document.querySelector(".review-report").open=true;document.querySelector(".review-report").scrollIntoView({block:"center"})');
 await new Promise(r=>setTimeout(r,350));await fs.writeFile(path.join(output,'first-review.png'),(await win.webContents.capturePage()).toPNG());
 await win.loadURL('claudian://app/index.html');await wait('!!document.querySelector("[data-view=connections]")');await click('[data-view=connections]');await click('[data-action=connection-open][data-host=codex]');await wait('document.body.textContent.includes("Review completed")');
 await js('language="tr";void render()');await wait('document.body.textContent.includes("Tarama tamamlandı")');
 await js('document.querySelector(".review-report").scrollIntoView({block:"center"})');await new Promise(r=>setTimeout(r,350));await fs.writeFile(path.join(output,'first-review-tr.png'),(await win.webContents.capturePage()).toPNG());
await click('[data-action=connection-close]');await wait('!document.querySelector("dialog[open]")');assert.ok(await js('document.querySelector("[data-action=connection-open][data-host=codex]").dataset.state==="complete"'));await fs.writeFile(path.join(output,'connection-grid.png'),(await win.webContents.capturePage()).toPNG());
 // --- 0.19.2 visual acceptance -----------------------------------------------------------
 // Every capture below answers one question: looking at this screen, what does the user do
 // next? A screen that cannot answer it fails here rather than in someone's hands.
 await js('language="en";void render()');
 // 1. Nothing anywhere in setup, review or connection guidance is animated. The pulse used
 //    to be the loudest thing on these screens; the class itself is gone.
 assert.equal(await js('document.querySelectorAll(".recommended").length'),0,'no CTA carries the pulse class');
 assert.equal(await js('[...document.querySelectorAll("button")].filter(b=>getComputedStyle(b).animationName!=="none").length'),0,'no button is animated');
 // 2. The Antigravity card: one provider, two ways in, both of them real controls.
 await click('[data-action=connection-open][data-host=antigravity]');
 await wait('!!document.querySelector(".entry-points")');
 assert.equal(await js('document.querySelectorAll("[data-action=entry-open]").length'),2,'app and terminal, not a second provider');
 assert.ok(await js('!!document.querySelector("[data-action=entry-open][data-mode=app]")'));
 assert.ok(await js('!!document.querySelector("[data-action=entry-open][data-mode=terminal]")'));
 await js('document.querySelector(".entry-points").scrollIntoView({block:"center"})');
 await new Promise(r=>setTimeout(r,300));
 await fs.writeFile(path.join(output,'antigravity.png'),(await win.webContents.capturePage()).toPNG());
 // The terminal action is honest about being a copy, not a launch: it changes the clipboard
 // and says where the text goes.
 await click('[data-action=entry-open][data-mode=terminal]');
 await wait('document.body.textContent.includes("Antigravity terminal")');
 await fs.writeFile(path.join(output,'antigravity-terminal.png'),(await win.webContents.capturePage()).toPNG());
 await click('[data-action=connection-close]');await wait('!document.querySelector("dialog[open]")');
 // Spark's unavailable web integration is hidden, while the internal provider remains intact.
 assert.equal(await js('document.querySelector("[data-action=connection-open][data-host=gemini]")'),null);
 assert.ok(require('./core.cjs').HOSTS.gemini);
 // 5. The review screen below the fold: one helper line, the detail collapsed, consent open.
 await js('reviewing=true;granted=false;selectedHosts=state.profile.hosts.map(h=>h.id);void render()');
 await wait('!!document.querySelector("details.review-details")');
 assert.equal(await js('document.querySelector("details.review-details").open'),false,'detail starts collapsed');
 assert.ok(await js('!!document.querySelector(".grant-confirm")'),'the consent sentence is never folded away');
 assert.equal(await js('document.querySelector("[data-action=review-apply]").disabled'),true,'consent is an act');
 await js('document.querySelector(".grant-confirm").scrollIntoView({block:"center"})');
 await new Promise(r=>setTimeout(r,300));
 await fs.writeFile(path.join(output,'review-consent.png'),(await win.webContents.capturePage()).toPNG());
 // 6. Unticking a provider states the consequence on the card being removed, not in a
 //    paragraph further down the page where it was read after the decision.
 await js('selectedHosts=state.profile.hosts.map(h=>h.id).filter(id=>!id.startsWith("antigravity"));void render()');
 await wait('!!document.querySelector(".host-card[data-removing=true]")');
 assert.equal(await js('document.querySelectorAll(".host-card[data-removing=true]").length'),1,'one provider, one card, one warning');
 await js('document.querySelector(".host-card[data-removing=true]").scrollIntoView({block:"center"})');
 await new Promise(r=>setTimeout(r,300));
 await fs.writeFile(path.join(output,'review-removing.png'),(await win.webContents.capturePage()).toPNG());
 await js('reviewing=false;selectedHosts=state.profile.hosts.map(h=>h.id);void render()');
 await wait('!!document.querySelector("[data-view=connections]")');
 // Real renderer, illustrative fixture: narrow and maximized layouts must retain content.
 await click('[data-view=companion]');
 await js('renderQueue');
 await wait('!!document.querySelector(".panel-layout")');
 const loopFixture=['Dönem projesinin sunumunu tamamla','Yeni bağlantı akışını gözden geçir',
   'Başvuru dosyasındaki belgeleri kontrol et',
   'Çalışma planında hangi adımların tamamlandığını ve hangilerinin beklediğini gözden geçir; eksik kalan noktaları ilgili notlarla birlikte değerlendir ve bir sonraki toplantıda konuşulacak konuları belirle.',
   'Araştırma notlarını düzenle','Haftalık çalışma saatlerini ayır','Tasarım geri bildirimlerini topla'];
 await js(`language='tr';header();panelState={updatedAt:new Date().toISOString(),openLoops:${JSON.stringify(loopFixture)},attention:[],reminders:[{text:'Proje taslağını gönder',date:'2026-09-25',due:'future'}],connections:[{id:'codex',label:'Codex',connected:true,verified:true,review:'completed'},{id:'chatgpt',label:'ChatGPT',connected:true,verified:false,review:'none'},{id:'gemini',label:'Spark',connected:false,verified:false,review:'none'}],recent:[]};renderPanelView();window.scrollTo(0,0)`);
 const originalBounds=win.getBounds();
 for(const [name,width,height] of [['panel-window',940,760],['panel-wide',1600,1000]]){
   win.setSize(width,height);
   await new Promise(r=>setTimeout(r,250));
   assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'),'no horizontal scrolling at '+width);
   const columns=await js('getComputedStyle(document.querySelector(".panel-layout")).gridTemplateColumns.split(" ").length');
   assert.equal(columns,width>=1120?2:1,'panel adapts to available width');
   assert.equal(await js('document.querySelectorAll(".open-loops>.loop-list>.loop-row").length'),5,'first five open loops stay scannable');
   assert.equal(await js('document.querySelectorAll(".open-loops input[type=checkbox]").length'),0,'no pretend completion controls');
   await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 await click('.more-loops>summary');
 assert.ok(await js('document.querySelector(".more-loops").open'),'remaining items open');
 await click('.loop-row details>summary');
 assert.equal(await js('document.querySelector(".loop-row details[open] p").textContent'),loopFixture[3],'full long text is available');
 await js('renderPanelView()');
 assert.ok(await js('document.querySelector(".more-loops").open&&!!document.querySelector(".loop-row details[open]")'),'refresh preserves expanded content');
 await js('panelState.openLoops=["<img src=x onerror=alert(1)>"];renderPanelView()');
 assert.equal(await js('document.querySelectorAll(".loop-list img").length'),0,'note text cannot inject HTML');
 await js('panelState.openLoops=[];renderPanelView()');
 assert.ok(await js('document.querySelector(".open-loops").textContent.includes("Açık işin yok.")'),'empty state is explicit');
 win.setBounds(originalBounds);
console.log('SMOKE PASS '+output);app.exit(0);
 }catch(e){console.error(e);try{console.error('RENDERER ERROR: '+await win.webContents.executeJavaScript('(document.querySelector("#error")||{}).textContent||"(bos)"'));console.error('VIEW: '+await win.webContents.executeJavaScript('(document.querySelector("nav .active")||{}).dataset?.view||"(yok)"'));console.error('ACTIONS: '+await win.webContents.executeJavaScript('[...document.querySelectorAll("[data-action]")].map(n=>n.dataset.action).join(",")'));}catch{}await fs.writeFile(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}};
