'use strict';
// Yerel MCP sunucusu.
//
// Bu testler protokolü doğrudan konuşuyor: Claude Desktop ya da ChatGPT kurulu olmadan da
// sunucunun doğru cevap verdiği ölçülebilir. Ölçüm düzeneği ürünün kendi yolunu kullanmazsa
// ölçtüğü şey ürün değildir -- burada kullanılan yol, istemcinin kullanacağı yolun aynısı.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {capabilities, handle, inside, PROTOCOL} = require('../mcp.cjs');

async function vault(t, notes = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-mcp-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  for (const [name, body] of Object.entries(notes)) await fs.writeFile(path.join(root, name), body);
  return root;
}

const quiet = async () => ({missing: false, candidates: []});
const tools = (folder, access, notice = quiet) =>
  capabilities(folder, notice).filter(t => t.scope === 'read' || access === 'write');

const call = (name, args, list) =>
  handle({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}}, list, {version: 'test'});

// ── Elde tutulan sözleşme ──────────────────────────────────────────────────
test('it introduces itself with a protocol version and a name', async () => {
  const reply = await handle({jsonrpc: '2.0', id: 1, method: 'initialize'}, [], {version: '1.2.3'});
  assert.equal(reply.result.protocolVersion, PROTOCOL);
  assert.equal(reply.result.serverInfo.name, 'claudian');
  assert.equal(reply.result.serverInfo.version, '1.2.3');
});

test('every capability has a name, a description and a schema', async t => {
  const list = tools(await vault(t), 'write');
  const reply = await handle({jsonrpc: '2.0', id: 1, method: 'tools/list'}, list, {version: 'x'});
  assert.ok(reply.result.tools.length >= 6);
  for (const tool of reply.result.tools) {
    assert.match(tool.name, /^[a-z][a-z_]*$/, 'adlar tek bir sözlükten gelir: ' + tool.name);
    assert.ok(tool.description.length > 20, tool.name + ' kendini anlatmalı');
    assert.equal(tool.inputSchema.type, 'object');
  }
});

// Gercek bir istemciyle olculdu (12.09.2026): Claude Code, arac adindaki noktayi alt
// cizgiye ceviriyor. `claudian.noticed` kullaniciya `mcp__claudian__claudian_noticed`
// olarak gorunuyordu. Kullanicinin gordugu ad ile bizim ilan ettigimiz ad ayni degilse,
// "yetenegin adi nedir" sorusunun cevabi yine yok demektir -- bu yuzden nokta kullanilmaz.
test('a capability name survives the client untouched', async t => {
  for (const tool of tools(await vault(t), 'write')) {
    assert.ok(!tool.name.includes('.'),
      tool.name + ': istemci noktayi alt cizgiye cevirir, ilan edilen ad degisir');
    assert.equal(tool.name, tool.name.toLowerCase());
  }
});

// ── Kapsam ─────────────────────────────────────────────────────────────────
//
// Web tarafındaki onay ekranı okuma ile yazmayı ayrı kapsamlar olarak soruyor; indirilen
// ürün hiç sormadan ikisini birden alıyordu. Kapsam burada gerçek bir sınır.
test('a read-only connection is never shown a capability that writes', async t => {
  const folder = await vault(t, {'Not.md': 'x\n'});
  const list = tools(folder, 'read');
  const reply = await handle({jsonrpc: '2.0', id: 1, method: 'tools/list'}, list, {version: 'x'});
  const names = reply.result.tools.map(t => t.name);
  assert.ok(names.includes('read_note'), 'okuma verilir');
  assert.ok(!names.includes('write_note'), 'yazma gösterilmez');
  assert.ok(!names.includes('append_note'));
});

test('a capability outside the granted scope cannot be called by name', async t => {
  const folder = await vault(t, {'Not.md': 'x\n'});
  const reply = await call('write_note', {note: 'Yeni', body: 'z'}, tools(folder, 'read'));
  assert.ok(reply.error, 'verilmemiş bir yetenek çağrılamaz');
  assert.match(reply.error.message, /yetenek yok/);
  assert.equal(await fs.readdir(folder).then(n => n.length), 1, 've hiçbir şey yazılmaz');
});

// ── Sınır ──────────────────────────────────────────────────────────────────
test('no capability can step outside the notes folder', async t => {
  const folder = await vault(t, {'Not.md': 'x\n'});
  for (const escape of ['../gizli', '..\\gizli', 'C:\\Windows\\System32\\drivers\\etc\\hosts', '../../../etc/passwd']) {
    assert.throws(() => inside(folder, escape), /outside the notes folder|valid file name/,
      escape + ' kabul edilmemeli');
  }
});

test('a capability failure is an answer, not a broken connection', async t => {
  const reply = await call('read_note', {note: 'Olmayan'}, tools(await vault(t), 'read'));
  assert.equal(reply.error, undefined, 'protokol hatası değil');
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /Yapılamadı/, 'model ne olduğunu okuyabilmeli');
});

// ── Yetenekler ─────────────────────────────────────────────────────────────
test('vault.read returns the note in full', async t => {
  const folder = await vault(t, {'Kararlar.md': '# Kararlar\n\nDamla sulama.\n'});
  const reply = await call('read_note', {note: 'Kararlar'}, tools(folder, 'read'));
  assert.match(reply.result.content[0].text, /Damla sulama/);
});

test('vault.search finds the line and says where it is', async t => {
  const folder = await vault(t, {'A.md': 'bir\nyağmurlama reddedildi\n', 'B.md': 'başka\n'});
  const reply = await call('search_notes', {query: 'yağmurlama'}, tools(folder, 'read'));
  assert.match(reply.result.content[0].text, /A\.md:2/);
});

test('vault.note writes, and vault.append refuses to invent a note', async t => {
  const folder = await vault(t, {});
  const list = tools(folder, 'write');
  await call('write_note', {note: 'Yeni', body: '# Yeni', reason: 'New project decision'}, list);
  assert.equal(await fs.readFile(path.join(folder, 'Yeni.md'), 'utf8'), '# Yeni\n');

  const current = await require('../memory-store.cjs').read(folder, 'Yeni');
  const appended = await call('append_note', {note: 'Yeni', body: 'satır', expected_sha256: current.sha256, reason:'Decision detail'}, list);
  assert.equal(appended.result.isError, undefined);
  const NL = String.fromCharCode(10);
  assert.equal(await fs.readFile(path.join(folder, 'Yeni.md'), 'utf8'), '# Yeni' + NL + 'satır' + NL,
    'aradaki boşluğa çağıran karar verir; ekleme kendiliğinden boş satır koymaz');

  const missing = await call('append_note', {note: 'Hic', body: 'x'}, list);
  assert.equal(missing.result.isError, true, 'olmayan bir nota eklemek sessizce onu yaratmaz');
});

test('claudian.noticed carries the reasoning, not just a title', async t => {
  const folder = await vault(t, {});
  const notice = async () => ({missing: false, candidates: [{
    title: 'Dayanağı değişmiş olabilir', why: '9 gün önce değişti',
    evidence: ['Control Panel.md', 'Claudian Decisions.md'], producer: 'düşen dayanak',
  }]});
  const reply = await call('noticed', {}, tools(folder, 'read', notice));
  const said = reply.result.content[0].text;
  assert.match(said, /neden: 9 gün önce/);
  assert.match(said, /kanıt: Control Panel\.md \| Claudian Decisions\.md/);
});

test('a missing folder is reported rather than thrown', async t => {
  const folder = await vault(t, {});
  const notice = async () => ({missing: true, candidates: []});
  const reply = await call('noticed', {}, tools(folder, 'read', notice));
  assert.match(reply.result.content[0].text, /bulunamadı/);
});
