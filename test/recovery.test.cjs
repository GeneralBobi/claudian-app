'use strict';
// Five faults found by installing 0.12.0 and using it the way a person would, 11.09.2026.
// Each test below is the shape of one of them, so none of them can come back quietly.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {MemorySetup, hash} = require('../core.cjs');
const policy = require('../policy.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-recovery-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const core = new MemorySetup({home, dataDir: path.join(root, 'data')});
  return {root, home, core,
    input: {name: 'Deniz', vault: path.join(root, 'Notlar'), mode: 'new', storage: 'markdown', hosts: ['claude-code']}};
}

// -- 1. Obsidian detection -------------------------------------------------
//
// The key was written as a single-quoted JS string, where the escapes are not real escape
// sequences: the backslashes were dropped and reg.exe received an invalid key name. The
// query could never succeed, so the app offered the download button to people who already
// had Obsidian installed.
test('the Obsidian registry key survives JS string parsing', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const literal = source.match(/'query','([^']*)'/);
  assert.ok(literal, 'the registry query must still be there to check');
  // Parse the literal exactly as the engine would. Reading the raw file text is what made
  // this bug invisible: on disk the separators are there, and only parsing removes them.
  const parsed = new Function("return '" + literal[1] + "'")();
  assert.ok(parsed.startsWith('HKCR' + String.fromCharCode(92)), 'the key keeps its separators once parsed');
  assert.equal(parsed.split(String.fromCharCode(92)).length, 5, 'four separators survive: ' + JSON.stringify(parsed));
});

// -- 2. Stale protocol on install ------------------------------------------
//
// Installing into a folder that already held a protocol file skipped it, so a vault carrying
// 2.0 stayed on 2.0 after a fresh install of 2.2, and only Settings > Update ever fixed it.
test('installing into an existing vault preserves its unowned protocol and supplies the application protocol', async t => {
  const {core, input} = await fixture(t);
  await fs.mkdir(input.vault, {recursive: true});
  const target = path.join(input.vault, 'Claudian Universal Protocol.md');
  await fs.writeFile(target, '# Old protocol\n\nVersion 2.0 text that is not current.\n');
  await fs.writeFile(path.join(input.vault, 'Bir notum.md'), 'Kendi notum.\n');

  await core.install((await core.prepare({...input, mode: 'existing'})).id);

  assert.equal(await fs.readFile(target, 'utf8'), '# Old protocol\n\nVersion 2.0 text that is not current.\n', 'an imported protocol is user content');
  const kept = (await fs.readdir(input.vault)).filter(name => name.includes('(yours '));
  assert.equal(kept.length, 0, 'user content is neither overwritten nor duplicated');
  const context=await require('../memory-runtime.cjs').context(input.vault);
  assert.equal(context.protocol.body,policy.protocol('en'));
  assert.equal(await fs.readFile(path.join(input.vault, 'Bir notum.md'), 'utf8'), 'Kendi notum.\n',
    'notes the user wrote are untouched');
});

// -- 3. A notes folder that is gone ----------------------------------------
//
// activity() called readdir with no guard and threw ENOENT straight into the panel, while
// health() swallowed the same error and reported calm. Neither is right: do not crash, and
// do not hide it.
test('a deleted notes folder is reported, not crashed on and not hidden', async t => {
  const {core, input} = await fixture(t);
  await core.install((await core.prepare(input)).id);
  await fs.rm(input.vault, {recursive: true, force: true});

  assert.deepEqual(await core.activity(), [], 'activity must not throw ENOENT');
  const health = await core.health();
  assert.equal(health.vaultMissing, true, 'health must say the folder is gone');
  assert.equal(path.resolve(health.vault), path.resolve(input.vault), 'and say which folder');
});

// -- 4. Moving the notes folder --------------------------------------------
//
// The folder was chosen once during setup and could never be changed afterwards, so a moved
// or deleted folder left the app stuck on a path that no longer existed.
test('the notes folder can be moved, taking access and files with it', async t => {
  const {core, home, root, input} = await fixture(t);
  await core.install((await core.prepare(input)).id);
  const settings = path.join(home, '.claude', 'settings.json');
  assert.match(await fs.readFile(settings, 'utf8'), /Notlar/, 'the first folder was granted');

  const next = path.join(root, 'Baska Yer');
  const moved = await core.relocate(next);

  assert.equal(path.resolve(moved.vault), path.resolve(next));
  assert.equal(path.resolve((await core.snapshot()).profile.vault), path.resolve(next));
  const granted = await fs.readFile(settings, 'utf8');
  assert.match(granted, /Baska Yer/, 'the new folder is readable');
  assert.ok(!/Notlar/.test(granted), 'the old grant is withdrawn rather than left behind');
  assert.ok(await fs.readFile(path.join(next, 'Claudian Universal Protocol.md'), 'utf8'),
    'the protocol is rebuilt at the new location');
  assert.match(await fs.readFile(path.join(home, '.claude', 'skills', 'claudian-memory', 'SKILL.md'), 'utf8'),
    /Baska Yer/, 'the skill points at the new folder');
});

test('a deleted notes folder can be created again through the same call', async t => {
  const {core, input} = await fixture(t);
  await core.install((await core.prepare(input)).id);
  await fs.rm(input.vault, {recursive: true, force: true});
  await core.relocate(input.vault);
  assert.ok((await fs.readdir(input.vault)).includes('Claudian Universal Protocol.md'));
  assert.equal((await core.health()).vaultMissing, false);
});

// -- 5. The husk left behind on removal ------------------------------------
//
// upgrade() wrote a restore copy that was the file minus our block, even for files this app
// had created itself. Removing then put back a husk holding only the front matter we wrote,
// and the next install refused to continue, blaming the user for a file we left there.
test('removing a connection deletes the rule this app created, so setup can run again', async t => {
  const {core, home, root, input} = await fixture(t);
  const cursorRule = path.join(home, '.cursor', 'rules', 'claudian-memory.mdc');
  await core.install((await core.prepare({...input, hosts: ['cursor']})).id);
  assert.ok(await fs.readFile(cursorRule, 'utf8'), 'the rule was created by this install');

  // The husk was only written when upgrade actually rewrote the rule, which is what happens
  // when the protocol moves -- 2.0 to 2.2 in the report. Reproduce that here by leaving the
  // rule holding older text that the app still owns, so upgrade has a real change to apply.
  const profilePath = path.join(root, 'data', 'profile.json');
  const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
  const stale = (await fs.readFile(cursorRule, 'utf8')).replace('## Claudian shared memory', '## Claudian shared memory (older wording)');
  await fs.writeFile(cursorRule, stale);
  profile.files = profile.files.map(file => file.path === cursorRule ? {...file, hash: hash(stale)} : file);
  await fs.writeFile(profilePath, JSON.stringify(profile));

  const upgraded = await core.upgrade();
  assert.ok(upgraded.changed > 0, 'the upgrade must really rewrite the rule, or this proves nothing');
  await core.removeHost('cursor');

  assert.equal(await fs.access(cursorRule).then(() => 'still there', () => 'gone'), 'gone',
    'a file this app created must not survive removal as a husk');

  // The consequence that actually mattered: the connection has to be addable again. Removing
  // a host leaves the memory installed, so reconnecting goes through the extend path -- which
  // is exactly where the husk used to stop it.
  const again = await core.prepare({...input, action: 'extend', mode: 'existing', hosts: ['cursor']});
  assert.ok(again.files.some(file => file.path === cursorRule), 'the rule is written again cleanly');
});

// -- 7. The row that could never be reached ---------------------------------
//
// 0.12.1 shipped a row that names a missing notes folder, and it never appeared. A folder
// that is gone also fails the write probe, and the panel checked the probe first -- so the
// reader got "Claudian cannot write to your notes folder right now" followed by a raw
// ENOENT naming a temp file with a random name. Shipping the fix was not the same as
// reaching it.
test('the missing-folder row outranks the write probe that the same absence breaks', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'ui', 'renderer.js'), 'utf8');
  const body = source.slice(source.indexOf('function healthRow()'));
  const missing = body.indexOf('vaultMissing');
  const probe = body.indexOf('probeIssue');
  assert.notEqual(missing, -1, 'the row must exist');
  assert.notEqual(probe, -1, 'the probe branch must exist');
  assert.ok(missing < probe, 'absence is checked before the write failure it causes');
});

test('a missing folder is named, not reported as a failed write to a temp file', async t => {
  const {core, input} = await fixture(t);
  await core.install((await core.prepare(input)).id);
  await fs.rm(input.vault, {recursive: true, force: true});

  const failure = await core.checkFiles().then(() => null, error => error);
  assert.ok(failure, 'checking files on a missing folder must fail');
  assert.doesNotMatch(failure.message, /claudian-access|\.tmp|ENOENT/,
    'the reader must not be shown a random probe filename: ' + failure.message);
  assert.match(failure.message, /bulunamadı/, 'it names the folder as missing');
});

// -- 8. Doğrulamayı bekleyen taraf ------------------------------------------
//
// Eski akış kullanıcıdan iki program arasında senkronizasyon görevi yapmasını istiyordu:
// yönergeyi kopyala, AI'a yapıştır, bitmesini tahmin et, geri gel ve "Sonucu kontrol et"e
// bas. Erken basıldığında çıkan cümle "AI henüz yanıt dosyasını oluşturmamış" idi -- bir
// arıza gibi okunan, aslında "daha bitmedi" demek olan bir cümle. Ölçüldü: mekanizmanın
// kendisi sağlam (gerçek bir oturum testi geçirdi), kopan şey akıştı.
test('the app waits for the answer itself and says what is happening', async t => {
  const {core, input} = await fixture(t);
  await core.install((await core.prepare(input)).id);
  const {output, nonce} = (await core.snapshot()).profile.hosts[0].challenge
    || (await core.challenge('claude-code'), (await core.snapshot()).profile.hosts[0].challenge);

  // Yanıt dosyası biraz sonra beliriyor -- gerçek bir AI oturumu gibi.
  setTimeout(() => fs.writeFile(output, nonce + '\n').catch(() => {}), 150);

  const seen = [];
  const result = await core.watchVerification('claude-code', e => seen.push(e.state), {stepMs: 40, limitMs: 5000, settleMs: 300});

  assert.equal(result.verified, true, 'the answer must be picked up without anyone pressing anything');
  assert.ok(seen.includes('verified'), 'the final state is reported: ' + seen.join(' → '));
  assert.equal((await core.health()).hosts.find(h => h.id === 'claude-code').state, 'verified');
});

test('an answer that never arrives is explained, not blamed on a missing file', async t => {
  const {core, input} = await fixture(t);
  await core.install((await core.prepare(input)).id);
  await core.challenge('claude-code');

  const seen = [];
  const result = await core.watchVerification('claude-code', e => seen.push(e), {stepMs: 30, limitMs: 400});

  assert.equal(result.verified, false);
  assert.doesNotMatch(result.message, /henüz yanıt dosyasını oluşturmamış/,
    'the old sentence read as a fault when it only meant "not finished yet"');
  assert.match(result.message, /yazma izni|çalıştırdığından/, 'it says what to check: ' + result.message);
  assert.equal(seen.at(-1).state, 'timeout', 'the waiting ends in a named state');
});

// Regression scenario using synthetic data.
test('the verification instruction names no capability to invoke', async t => {
  const {core, input} = await fixture(t);
  await core.install((await core.prepare(input)).id);
  const {prompt} = await core.challenge('claude-code');

  assert.doesNotMatch(prompt, /skill|yetenek|capability/i,
    'asking for a name the user cannot know is what made the system feel broken: ' + prompt);
  assert.match(prompt, /\.claudian-check/, 'it still names the two files it is about');
  // Kaçış dizisi kullanmadan: bu kontrolün kendisi bir kez ters bölü kaçışı yüzünden
  // yanlış yazıldı ve kodun değil testin hatası olduğu ancak çıktıya bakınca anlaşıldı.
  const doubled = String.fromCharCode(92, 92);
  assert.ok(!prompt.includes(doubled), 'the path is read by a person, so it is not JSON-escaped');
});

test('the verification instruction follows the vault language', async t => {
  const {core, root, home} = await fixture(t);
  const english = {name: 'Deniz', vault: path.join(root, 'Notes'), mode: 'new',
    storage: 'markdown', hosts: ['claude-code'], language: 'en'};
  await core.install((await core.prepare(english)).id);
  const {prompt} = await core.challenge('claude-code');
  assert.match(prompt, /Read .* and write the verification value/,
    'an English install was being handed a Turkish sentence: ' + prompt);
  assert.ok(home);
});

// -- 10. Adı CLI olan ama CLI'ı hiç aranmayan host -------------------------
//
// Faz 7 · P6: "içe aktarma akışının yeri yok, 6 host'un 4'ünde sessizce düşüyor."
// Ölçüldü ve daha kötüsü çıktı: "Gemini CLI" adında bir host vardı ve komut haritasında
// girişi yoktu, yani resolve() daha PATH'e bakmadan null dönüyordu. Beşte biri değil,
// altıda dördü değil -- bir CLI host'u tanımı gereği CLI'sız sayılıyordu.
test('every host that ships a launchable command has one mapped', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'scan.cjs'), 'utf8');
  const mapped = [...source.matchAll(/'([a-z-]+)':\s*'[a-z]+'/g)].map(m => m[1]);

  // Bu üçünün ayrı bir çalıştırılabilir komutu var: claude, codex, gemini.
  //
  // `antigravity-cli` bilerek dışarıda: Antigravity bir Electron uygulaması
  // (Antigravity.exe) ve ayrı bir CLI ikilisi ya da bin klasörü yok -- oradaki "CLI"
  // çalıştırılabilir bir komutu değil, hangi yapılandırma yüzeyini kullandığını anlatıyor.
  // Cursor için de bir komut aranmıyor; yönerge elle yapıştırılıyor.
  for (const id of ['claude-code', 'codex', 'gemini-cli']) {
    assert.ok(mapped.includes(id),
      `${id} has a command of its own but resolve() does not look for it: ${mapped.join(', ')}`);
  }
});

test('the run-it-now failure tells the user what to do instead', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'scan.cjs'), 'utf8');
  assert.doesNotMatch(source, /interactive native Claude Code or Codex CLI executable is required/,
    'naming two products in an error a third product can also hit is not an instruction');
  assert.match(source, /Paste the instruction into it instead/,
    'a failure the user can act on says what to do');
});

// Aynı yanıltıcı cümle iki yerdeydi: doğrulama yönergesinde ve ilk tarama yönergesinde.
test('no prompt asks the user to invoke a capability by name', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'scan.cjs'), 'utf8');
  assert.doesNotMatch(source, /type \/claudian|write \$claudian|\/claudian komutunu yaz/i,
    'the generated AI instruction may name the skill but must not require the user to type a slash command');
  assert.match(source,/deleted vault protocol copy is not an error/);
});

// -- 11. Erişilemez kalan ilk tarama ---------------------------------------
//
// Kurulumdan sonraki ilk gerçek yazma bu akışta duruyordu ve hiçbir düğme onu açmıyordu:
// `renderScan` yazılmıştı, pakete giriyordu, bakım istiyordu ve kimseye ulaşmıyordu.
// Faz 8'in ölçüsü tam olarak "ilk gerçek yazma" olduğu için bunun erişilemez olması
// ölçülecek şeyin kendisini ortadan kaldırıyordu.
test('the first review is reachable, and only after the connection is proven', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'ui', 'renderer.js'), 'utf8');

  assert.match(source, /function firstScanRow\(/, 'the row exists');
  assert.match(source, /\$\{verifyRow\(h\)\}\$\{firstScanRow\(h\)\}/,
    'it sits right after the proof step, so the order reads as a sequence');

  const row = source.slice(source.indexOf('function firstScanRow('));
  assert.match(row.slice(0, 400), /state!=='verified'\)return ''/,
    'an unproven connection is not offered a first review');

  for (const action of ['scan-open', 'run-scan', 'copy-scan', 'scan-close']) {
    assert.ok(source.includes(`a==='${action}'`), `${action} is handled`);
    assert.ok(source.includes(`'${action}'`), `${action} is emitted by a button`);
  }
});

test('the unreachable scan view is gone rather than left in the package', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'ui', 'renderer.js'), 'utf8');
  assert.doesNotMatch(source, /renderScan|scanHost|scanData/,
    'code that no button can reach is not a feature; it is weight');
});
