const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {MemorySetup,assertOrdinaryPath}=require('../core.cjs');const welcome=require('../welcome.cjs');const {register}=require('../obsidian.cjs');
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'claudian-welcome-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('existing empty folder receives core notes and linked skeleton',async t=>{const root=await temp(t),vault=path.join(root,'notes');await fs.mkdir(vault);const core=new MemorySetup({home:root,dataDir:path.join(root,'data')});const plan=await core.prepare({name:'User',vault,mode:'existing',storage:'obsidian',hosts:['codex'],language:'en'});await core.install(plan.id,true);const names=welcome.names('en','User');assert.match(await fs.readFile(path.join(vault,names.entry),'utf8'),/\[\[Projects/);assert.ok(await fs.stat(path.join(vault,'Vault Protocol.md')));assert.ok(await fs.stat(path.join(vault,'.obsidian/app.json')));});
test('starter repair preserves existing notes and links introduction',async t=>{const vault=await temp(t);const profile={vault,language:'tr',storage:'obsidian',name:'Deniz'};const names=welcome.names('tr','Deniz');await fs.writeFile(path.join(vault,names.entry),'Keep my map');await welcome.ensure(profile,assertOrdinaryPath);assert.equal(await fs.readFile(path.join(vault,names.entry),'utf8'),'Keep my map');const file=await welcome.save(profile,['Design','Project','Concise'],assertOrdinaryPath);assert.match(await fs.readFile(path.join(vault,file),'utf8'),/source: user-onboarding/);assert.ok((await fs.readFile(path.join(vault,file),'utf8')).includes('[['+names.entry.slice(0,-3)+']]'));});
test('Obsidian registration preserves registry, waits for close and is idempotent',async t=>{const root=await temp(t),file=path.join(root,'obsidian.json'),vault=path.join(root,'notes');await fs.writeFile(file,JSON.stringify({custom:true,vaults:{old:{path:path.join(root,'old')}}}));assert.equal((await register(file,vault,{running:true})).needsClose,true);assert.equal(Object.keys(JSON.parse(await fs.readFile(file)).vaults).length,1);const result=await register(file,vault);assert.equal((await register(file,vault)).id,result.id);const reg=JSON.parse(await fs.readFile(file));assert.equal(reg.custom,true);assert.equal(Object.keys(reg.vaults).length,2);assert.ok((await fs.readdir(root)).some(f=>f.endsWith('.bak')));});
test('invalid Obsidian registry is preserved',async t=>{const root=await temp(t),file=path.join(root,'obsidian.json');await fs.writeFile(file,'broken');await assert.rejects(register(file,root));assert.equal(await fs.readFile(file,'utf8'),'broken');});

// Etiketler sorgu anahtarıdır: Obsidian'ın etiket paneli, grafiği ve Bases görünümleri
// bunlara dayanır. Aynı kavramın iki farklı etiket alması o sorguları sessizce böler.
//
// Ölçüldü (11.09.2026): Türkçe bir vault'ta çalışma anlaşmaları notu `method`, kayıt
// rehberi `yöntem` etiketi taşıyordu — aynı kavram, iki etiket, ve hiçbir sorgu ikisini
// birlikte görmüyordu. İngilizce vault'ta da aynası: `yöntem` etiketi İngilizce nota
// yapışıyordu.
test('skeleton tags follow the vault language and never mix the two', () => {
  const {skeleton} = require('../welcome.cjs');
  const turkish = /[çğıöşüÇĞİÖŞÜ]/;
  const english = new Set(['method', 'neuron', 'agenda', 'introduction']);

  for (const [language, bad] of [['en', tag => turkish.test(tag)], ['tr', tag => english.has(tag)]]) {
    for (const [name, body] of Object.entries(skeleton(language, 'Deniz'))) {
      const tags = ((/tags: \[([^\]]*)\]/.exec(body) || [])[1] || '').split(', ').filter(Boolean);
      const wrong = tags.filter(bad);
      assert.deepEqual(wrong, [], `${language}/${name}: tag in the other language: ${wrong.join(', ')}`);
    }
  }
});

test('one concept gets one tag: agreements and the record guide agree', () => {
  const {skeleton} = require('../welcome.cjs');
  const tagOf = (body) => ((/tags: \[([^\]]*)\]/.exec(body) || [])[1] || '').split(', ');
  for (const language of ['en', 'tr']) {
    const notes = skeleton(language, 'Deniz');
    const agreements = tagOf(notes['Working Agreements.md']);
    const guide = tagOf(notes['Record Guide.md']);
    const shared = agreements.filter(t => t !== 'claudian' && guide.includes(t));
    assert.ok(shared.length > 0,
      `${language}: both are method notes but share no tag — ${agreements} vs ${guide}`);
  }
});

// Kayıt rehberi "her not tags, tür, güncellenme taşır" diye öğretiyor; protokolün kendisi
// hiçbirini taşımıyordu ve bu yüzden etiketle bulunabilir değildi.
test('the protocol file itself carries the frontmatter the record guide teaches', () => {
  const policy = require('../policy.cjs');
  for (const [language, type] of [['en', 'type'], ['tr', 'tür']]) {
    const text = policy.protocol(language);
    assert.ok(text.startsWith('---\n'), `${language}: the protocol must open with frontmatter`);
    assert.match(text, /tags: \[claudian, (method|yöntem)\]/, `${language}: tagged like the method notes`);
    assert.match(text, new RegExp(`^${type}: (method|yöntem)$`, 'm'), `${language}: declares its own kind`);
  }
});
