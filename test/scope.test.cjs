'use strict';
// Regression scenario using synthetic data.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {entries, grant, revoke, planFor} = require('../grants.cjs');

const VAULT = 'C:/Vault/Notlar';
const read = async () => null;

test('a read-only grant writes no rule that can change a note', () => {
  const list = entries(VAULT, 'read');
  assert.equal(list.length, 1);
  assert.match(list[0], /^Read\(/);
  assert.ok(!list.some(e => e.startsWith('Edit(') || e.startsWith('Write(')),
    'okuma secildi, yazma kurali yazilmamali');
});

test('the settings file itself never gains a write rule in read scope', async () => {
  const content = grant(null, VAULT, 'read');
  assert.ok(!content.includes('Write('), content);
  assert.ok(!content.includes('Edit('), content);
  assert.ok(content.includes('Read('));
});

test('write scope still grants all three', () => {
  assert.deepEqual(entries(VAULT, 'write').map(e => e.slice(0, e.indexOf('('))),
    ['Read', 'Edit', 'Write']);
});

test('the default is unchanged for callers that do not pass a scope', () => {
  assert.deepEqual(entries(VAULT), entries(VAULT, 'write'));
});

// Bir baglanti once yazma kapsamiyla kurulup sonra daraltilabilir. Geri alma yalnizca
// o anki kapsami temizlerse, geride kalan Write kurali sessizce yasamaya devam eder.
test('removal clears the write rules even from a connection that is now read-only', () => {
  const withWrite = grant(null, VAULT, 'write');
  const after = revoke(withWrite, VAULT);
  const allow = JSON.parse(after).permissions.allow;
  assert.deepEqual(allow, [], 'gecmiste verilmis yazma kurali geride kalmamali');
});

// Codex'in varsayilan sanal alani zaten okuyabiliyor; `sandbox_mode` yalnizca yazma icin
// gerekli. Kullanici okuma istedigi halde kipi workspace-write'a cekmek, tam da
// duzeltmeye calistigimiz asiri izin davranisinin kendisi olurdu.
test('a read-only grant does not widen the Codex sandbox', async () => {
  const plan = await planFor('codex', 'C:/Users/Test', VAULT, read, 'read');
  assert.equal(plan.satisfied, true);
  assert.equal(plan.content, undefined, 'okuma icin yapilandirmaya dokunulmaz');
});

test('a write grant still repairs the Codex sandbox mode', async () => {
  const plan = await planFor('codex', 'C:/Users/Test', VAULT, read, 'write');
  assert.match(plan.content, /sandbox_mode = "workspace-write"/);
});

test('Claude Code receives exactly the scope it was given', async () => {
  const narrow = await planFor('claude-code', 'C:/Users/Test', VAULT, read, 'read');
  const wide = await planFor('claude-code', 'C:/Users/Test', VAULT, read, 'write');
  assert.equal(JSON.parse(narrow.content).permissions.allow.length, 1);
  assert.equal(JSON.parse(wide.content).permissions.allow.length, 3);
});

// PowerShell ends a single-quoted string on the typographic quotes as well as on U+0027.
// Turkish is full of them -- "skill'i", "AI'ın" -- so an instruction carrying one closed its own
// string mid-sentence and PowerShell parsed the rest as code. The user saw "Missing argument in
// parameter list" and no AI ever opened. Measured 13.09.2026 against the real parser.
test('an instruction carrying a typographic apostrophe still parses as one string', () => {
  const quote = s => "'" + String(s).replace(/['\u2018\u2019\u201A\u201B]/g, m => m + m) + "'";
  for (const sample of ["skill’i ile güncel", "AI’ın okuduğu", "it's fine", "‘quoted’", "plain"]) {
    const wrapped = quote(sample);
    // Every quote inside the body is doubled, which is how PowerShell escapes one, so the only
    // odd-length run of quotes is the pair that opens and closes the string.
    const body = wrapped.slice(1, -1);
    for (const run of body.match(/['\u2018\u2019\u201A\u201B]+/g) || []) {
      assert.equal(run.length % 2, 0, 'an unescaped quote in ' + JSON.stringify(sample) + ' would end the string');
    }
  }
});

// The instruction the launcher actually sends carries these characters, so the guard is checked
// against the real text rather than a sample.
test('the generated review instruction survives quoting', () => {
  const scan = require('../scan.cjs');
  const profile = {vault: 'C:/tmp', language: 'tr', hosts: [{id: 'claude-code', label: 'Claude Code', artifacts: {skill: 'S'}}]};
  const prompt = scan.prompt(profile);
  assert.match(prompt, /['\u2019]/, 'the Turkish instruction does carry an apostrophe');
  const quoted = "'" + prompt.replace(/['\u2018\u2019\u201A\u201B]/g, m => m + m) + "'";
  for (const run of quoted.slice(1, -1).match(/['\u2018\u2019\u201A\u201B]+/g) || []) assert.equal(run.length % 2, 0);
});
