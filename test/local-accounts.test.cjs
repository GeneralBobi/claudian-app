'use strict';
// Which account a local connection runs as (1.3.0, madde 3): only the e-mail ever leaves the module; tokens never do.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {localAccounts, jwtEmail} = require('../local-accounts.cjs');

const jwt = payload => ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'imza'].join('.');

test('the signed-in e-mail is read; no token, key or other field is returned', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-accounts-'));
  t.after(() => fs.rm(home, {recursive: true, force: true}));
  await fs.writeFile(path.join(home, '.claude.json'), JSON.stringify({oauthAccount: {emailAddress: 'kurgu@ornek.test', organizationName: 'Kurgu Org', accountUuid: 'gizli-uuid'}, primaryApiKey: 'sk-gizli'}));
  await fs.mkdir(path.join(home, '.codex'));
  await fs.writeFile(path.join(home, '.codex', 'auth.json'), JSON.stringify({tokens: {id_token: jwt({email: 'ikinci@ornek.test', sub: 'x'}), access_token: 'erisim-gizli', refresh_token: 'yenile-gizli'}, OPENAI_API_KEY: 'sk-codex-gizli'}));
  const a = await localAccounts(home);
  assert.deepEqual(a, {'claude-code': {email: 'kurgu@ornek.test', org: 'Kurgu Org'}, codex: {email: 'ikinci@ornek.test'}});
  const text = JSON.stringify(a);
  for (const secret of ['gizli-uuid', 'sk-gizli', 'erisim-gizli', 'yenile-gizli', 'sk-codex-gizli', 'imza']) assert.ok(!text.includes(secret), secret);
});

test('nothing recorded means nothing shown; an API-key login says so without the key', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-accounts-'));
  t.after(() => fs.rm(home, {recursive: true, force: true}));
  assert.deepEqual(await localAccounts(home), {'claude-code': null, codex: null});
  await fs.mkdir(path.join(home, '.codex'));
  await fs.writeFile(path.join(home, '.codex', 'auth.json'), JSON.stringify({OPENAI_API_KEY: 'sk-gizli'}));
  const a = await localAccounts(home);
  assert.deepEqual(a.codex, {apiKey: true});
  assert.ok(!JSON.stringify(a).includes('sk-gizli'));
});

test('a malformed token or a non-address is not shown as an account', () => {
  assert.equal(jwtEmail('bozuk'), null);
  assert.equal(jwtEmail(jwt({email: 'adres değil'})), null);
  assert.equal(jwtEmail(jwt({email: 'a@b.c'})), 'a@b.c');
});
