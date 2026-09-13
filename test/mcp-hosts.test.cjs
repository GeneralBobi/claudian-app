'use strict';
// Regression scenario using synthetic data.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {MemorySetup, HOSTS} = require('../core.cjs');
const {serverEntry, mcpGrant, mcpRevoke, configFile, chatgptStep, SERVER} = require('../mcp-hosts.cjs');

const entry = () => serverEntry({exe: 'C:/App/Claudian.exe', script: 'C:/App/mcp-server.cjs', dataDir: 'C:/Data'});

test('the connection starts Claudian as plain Node, not as a window', () => {
  const {content} = mcpGrant(null, entry());
  const server = JSON.parse(content).mcpServers[SERVER];
  assert.equal(server.env.ELECTRON_RUN_AS_NODE, '1',
    'Electron kendi ciktisini stdout a yazarsa protokol kirlenir ve istemci baglantiyi duser');
  assert.equal(server.command, 'C:/App/Claudian.exe');
  assert.deepEqual(server.args, ['C:/App/mcp-server.cjs']);
  assert.equal(server.env.CLAUDIAN_DATA, 'C:/Data', 'vault ve kapsam profilden okunur');
});

test('the servers the user added themselves are left alone', () => {
  const mine = JSON.stringify({mcpServers: {kendi: {command: 'x'}}, theme: 'dark'});
  const {content} = mcpGrant(mine, entry());
  const config = JSON.parse(content);
  assert.ok(config.mcpServers.kendi, 'baskasinin sunucusu silinmez');
  assert.equal(config.theme, 'dark', 'ilgisiz ayarlar korunur');
  assert.ok(config.mcpServers[SERVER]);
});

test('a second install changes nothing', () => {
  const first = mcpGrant(null, entry()).content;
  assert.equal(mcpGrant(first, entry()).satisfied, true);
});

test('an unreadable configuration is reported, never overwritten', () => {
  assert.throws(() => mcpGrant('{ bozuk', entry()), /okunamadi|korundu/);
});

test('removal deletes our server and nothing else', () => {
  const mine = JSON.stringify({mcpServers: {kendi: {command: 'x'}}});
  const withUs = mcpGrant(mine, entry()).content;
  const after = JSON.parse(mcpRevoke(withUs));
  assert.ok(after.mcpServers.kendi, 'kullanicinin sunucusu kalir');
  assert.ok(!Object.hasOwn(after.mcpServers, SERVER));
  assert.equal(mcpRevoke(JSON.stringify(mine)), null, 'kaldiracak sey yoksa dosyaya dokunulmaz');
});

// Olculdu: ChatGPT yerel surec baslatamaz, stdio secenegi yoktur. Ona bir yapilandirma
// dosyasi yazmak mumkun degil; uydurma bir dosya yazmaktansa adi konmus adim dogru taraf.
test('ChatGPT is given a named step, not a guessed file', () => {
  assert.match(chatgptStep(null,'tr'),/henüz kullanıma hazır değil/);
  assert.doesNotMatch(chatgptStep(null,'en'),/https:/);
  const step = chatgptStep('https://ornek/mcp', 'tr');
  assert.match(step, /Gelistirici Kipi/);
  assert.match(step, /https:..ornek.mcp/);
  assert.match(chatgptStep('https://ornek/mcp', 'en'), /Developer Mode/);
});

test('Claude Desktop reads its configuration from its own folder', () => {
  const file = configFile('C:/Users/Test');
  assert.ok(file.endsWith('claude_desktop_config.json'), file);
  assert.ok(file.includes('Claude'), file);
});

// Kurulum duzeyinde: bir MCP konagi skill dosyasi ve baslangic kurali yolunu hic
// kullanmaz. Ona bir skill yazmak, okumayacagi bir dosyayi diske birakmak olurdu.
test('installing an MCP host writes a connection and no skill files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-mcp-host-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const core = new MemorySetup({home, dataDir: path.join(root, 'data'),
    launcher: 'C:/App/Claudian.exe', mcpScript: 'C:/App/mcp-server.cjs'});
  const input = {name: 'Deniz', vault: path.join(root, 'notes'), mode: 'new',
    storage: 'obsidian', hosts: ['claude-desktop'], language: 'en', access: 'write'};
  const profile = await core.install((await core.prepare(input)).id,true);

  const written = profile.files.map(f => f.path);
  assert.ok(written.some(p => p.endsWith('claude_desktop_config.json')), written.join(' | '));
  assert.ok(!written.some(p => p.includes('SKILL.md')), 'MCP konagi skill dosyasi okumaz');
  assert.ok(!written.some(p => p.includes('rules')), 'baslangic kurali da yazilmaz');

  const config = JSON.parse(await fs.readFile(configFile(home), 'utf8'));
  assert.equal(config.mcpServers[SERVER].command, 'C:/App/Claudian.exe');
  assert.equal(profile.hosts[0].artifacts.server, SERVER, 'kullaniciya baglanti adi soylenebilmeli');
});

test('every host in the registry can be described to the user', () => {
  for (const [id, host] of Object.entries(HOSTS)) {
    assert.ok(host.label, id + ' etiketsiz');
    assert.ok(host.parts || host.kind, id + ': ne skill yolu ne de bir bicim var');
  }
});

// Tasima her kurulu konak icin bir plan ister. MCP konaklarinda not yolu izin dosyasinda
// yazmadigi icin degisecek bir sey yok -- ama bu dal yokken tasima dogrudan patliyordu.
test('moving the notes folder does not break an MCP connection', async () => {
  const {planFor} = require('../grants.cjs');
  for (const host of ['claude-desktop', 'chatgpt']) {
    const plan = await planFor(host, 'C:/Users/Test', 'C:/Yeni/Yer', async () => null, 'write');
    assert.equal(plan.satisfied, true, host + ' tasinirken plan uretememeli degil');
  }
});

// Regression scenario using synthetic data.
test('upgrading a setup that includes an MCP connection does not throw', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-upg-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const core = new MemorySetup({home, dataDir: path.join(root, 'data'),
    launcher: 'C:/App/Claudian.exe', mcpScript: 'C:/App/mcp-server.cjs'});
  await core.install((await core.prepare({name: 'Deniz', vault: path.join(root, 'notes'),
    mode: 'new', storage: 'obsidian', hosts: ['codex', 'claude-desktop'],
    language: 'tr', access: 'write'})).id,true);

  const rebuilt = await core.upgrade();
  assert.ok(rebuilt, 'yükseltme MCP bağlantısı yüzünden patlamamalı');
});
