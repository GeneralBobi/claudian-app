'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

// Writers on this computer (1.7.0): installed means signed by its publisher; an unsigned file in the same place is not.
test('writer setup: an unsigned codex.exe does not count; the npm Codex with a sign-in does', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yazici-'));
  const env = {LOCALAPPDATA: process.env.LOCALAPPDATA, APPDATA: process.env.APPDATA, CODEX_HOME: process.env.CODEX_HOME};
  Object.assign(process.env, {LOCALAPPDATA: path.join(root, 'local'), APPDATA: path.join(root, 'roaming'), CODEX_HOME: path.join(root, 'codex')});
  t.after(async () => {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(root, {recursive: true, force: true});
  });
  delete require.cache[require.resolve('../writer-install.cjs')];
  const {createWriterSetup, codexExe, agyExe} = require('../writer-install.cjs');
  const w = createWriterSetup({fetch: async () => { throw Error('no network in tests'); }});
  let s = await w.status();
  assert.equal(s.codex.installed, false);
  assert.equal(s.gemini.installed, false);
  await fs.mkdir(path.dirname(codexExe()), {recursive: true});
  await fs.writeFile(codexExe(), 'not a real program');
  await fs.mkdir(path.dirname(agyExe()), {recursive: true});
  await fs.writeFile(agyExe(), 'not a real program');
  s = await createWriterSetup({}).status();
  assert.equal(s.codex.installed, false, 'an unsigned codex.exe is not trusted');
  assert.equal(s.gemini.installed, false, 'an unsigned agy.exe is not trusted');
  await fs.mkdir(path.join(root, 'roaming', 'npm'), {recursive: true});
  await fs.writeFile(path.join(root, 'roaming', 'npm', 'codex.cmd'), '@echo off\n');
  s = await createWriterSetup({}).status();
  assert.equal(s.codex.installed, true, 'the user\'s own npm Codex is used');
  assert.equal(s.codex.signedIn, false);
  await fs.mkdir(path.join(root, 'codex'), {recursive: true});
  await fs.writeFile(path.join(root, 'codex', 'auth.json'), '{}');
  assert.equal((await createWriterSetup({}).status()).codex.signedIn, true);
  await assert.rejects(w.install('bilinmeyen'), /Bilinmeyen/);
  await assert.rejects(createWriterSetup({}).signIn('gemini'), /önce|Önce/);
});
