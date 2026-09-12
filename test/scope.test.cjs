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
