'use strict';
// Yüzük engine installer (1.1.0): where it may write, how downloads resume and fail, and that only a package the
// publisher signed is unpacked. No network: a local HTTP server stands in for GitHub and Hugging Face.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {downloadFile, forbiddenTarget, defaultTarget, createInstaller} = require('../ring-install.cjs');
const {signedSums} = require('../release-key.cjs');
const services = require('../services.cjs');

const env = {ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', SystemRoot: 'C:\\Windows', ProgramData: 'C:\\ProgramData'};

test('the engine never goes into Program Files, Windows or the app folder', () => {
  const appDir = 'C:\\Program Files (x86)\\Claudian';
  assert.match(forbiddenTarget('C:\\Program Files (x86)\\Yuzuk-motor', {env, appDir}), /Program Files/);
  assert.match(forbiddenTarget('C:\\Program Files\\Claudian\\yuzuk', {env, appDir: 'D:\\x'}), /Program Files/);
  assert.match(forbiddenTarget('C:\\Windows\\Temp\\m', {env, appDir: 'D:\\x'}), /Windows/);
  assert.match(forbiddenTarget('D:\\Apps\\Claudian\\motor', {env, appDir: 'D:\\Apps\\Claudian'}), /kendi kurulum klasörüne/);
  assert.equal(forbiddenTarget('C:\\Users\\Kurgu\\AppData\\Local\\Claudian\\yuzuk-motor', {env, appDir}), null);
  assert.equal(forbiddenTarget('C:\\Program Files Extra\\m', {env, appDir: 'D:\\x'}), null, 'a sibling folder with a similar name is not inside');
  assert.match(forbiddenTarget('relative\\path', {env, appDir}), /tam/);
});

test('the default folder is in the user\'s own app data, not a path from another computer', () => {
  const target = defaultTarget();
  assert.match(target, /Claudian[\\/]yuzuk-motor$/);
  assert.ok(!/Desktop[\\/]Yuzuk[\\/]laya-kapi/.test(target));
  assert.equal(forbiddenTarget(target, {appDir: path.join(os.tmpdir(), 'claudian-app-dir')}), null);
});

function server(body) {
  const seen = [];
  const srv = http.createServer((q, s) => {
    seen.push(q.headers.range || null);
    const m = /^bytes=(\d+)-$/.exec(q.headers.range || '');
    if (q.url === '/norange' || !m) { s.writeHead(200, {'Content-Length': body.length}); return s.end(body); }
    const from = Number(m[1]);
    s.writeHead(206, {'Content-Length': body.length - from, 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}`});
    s.end(body.subarray(from));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({srv, seen, url: `http://127.0.0.1:${srv.address().port}`})));
}

test('a partial download continues from where it stopped and is checked before use', async t => {
  const body = crypto.randomBytes(200_000);
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const {srv, seen, url} = await server(body);
  t.after(() => srv.close());
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ring-install-'));
  const file = path.join(dir, 'model.bin');
  await fs.writeFile(file + '.part', body.subarray(0, 50_000));
  let last = 0;
  await downloadFile(fetch, url + '/model.bin', file, {size: body.length, sha256, onBytes: n => { last = n; }});
  assert.equal(seen.at(-1), 'bytes=50000-', 'only the missing part was requested');
  assert.equal(last, body.length);
  assert.ok((await fs.readFile(file)).equals(body));
  await assert.rejects(fs.access(file + '.part'));
  const before = seen.length;
  await downloadFile(fetch, url + '/model.bin', file, {size: body.length, sha256});
  assert.equal(seen.length, before, 'a finished, verified file is not downloaded again');
  await fs.rm(dir, {recursive: true, force: true});
});

test('a server that ignores the range starts the file over instead of appending garbage', async t => {
  const body = crypto.randomBytes(30_000);
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const {srv, url} = await server(body);
  t.after(() => srv.close());
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ring-install-'));
  const file = path.join(dir, 'x.bin');
  await fs.writeFile(file + '.part', body.subarray(0, 10_000));
  const noRange = (u, o) => fetch(u.replace('/x.bin', '/norange'), o);
  await downloadFile(noRange, url + '/x.bin', file, {size: body.length, sha256});
  assert.ok((await fs.readFile(file)).equals(body));
  await fs.rm(dir, {recursive: true, force: true});
});

test('a file whose digest does not match is discarded, never used', async t => {
  const body = crypto.randomBytes(10_000);
  const {srv, url} = await server(body);
  t.after(() => srv.close());
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ring-install-'));
  const file = path.join(dir, 'x.bin');
  await assert.rejects(downloadFile(fetch, url + '/x.bin', file, {size: body.length, sha256: '0'.repeat(64)}), /özeti tutmuyor/);
  await assert.rejects(fs.access(file));
  await assert.rejects(fs.access(file + '.part'), 'the bad bytes are not kept for a later resume either');
  await fs.rm(dir, {recursive: true, force: true});
});

test('a release whose checksum file is not signed by the publisher is refused', async () => {
  const sums = Buffer.from(`${'a'.repeat(64)}  yuzuk-motor-1.1.0.zip\n`);
  const {privateKey} = crypto.generateKeyPairSync('ed25519');
  const forged = crypto.sign(null, sums, privateKey).toString('base64');
  const release = {assets: [{name: 'SHA256SUMS-1.1.0.txt', browser_download_url: 'https://github.com/x/sums'},
    {name: 'SHA256SUMS-1.1.0.txt.sig', browser_download_url: 'https://github.com/x/sig'}]};
  const fake = async url => ({ok: true, arrayBuffer: async () => sums, text: async () => (url.endsWith('/sig') ? forged : sums.toString())});
  await assert.rejects(signedSums(release, fake), /not valid/);
  await assert.rejects(signedSums({assets: release.assets.slice(0, 1)}, fake), /not signed/);
  const offsite = {assets: [{name: 'SHA256SUMS-1.1.0.txt', browser_download_url: 'https://example.com/sums'}, release.assets[1]]};
  await assert.rejects(signedSums(offsite, fake), /Unexpected download location/);
});

test('install refuses a forbidden folder before touching the disk', async () => {
  const installer = createInstaller({fetch, version: '1.1.0', setEngine: async () => {}, profile: async () => ({})});
  const target = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Yuzuk-motor');
  if (process.platform === 'win32') await assert.rejects(installer.install({target}), /Program Files/);
  const plan = await installer.plan(path.join(os.tmpdir(), 'ring-install-plan', 'yuzuk-motor'));
  assert.equal(plan.forbidden, null);
  assert.equal(typeof plan.need, 'number');
});

test('the installer adds its server to services.json but never replaces an entry set up by hand', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ring-services-'));
  const node = process.execPath;
  const hand = {id: 'yuzuk', label: 'hand', command: node, args: ['-e', 'setTimeout(()=>{},1)'], alive: {port: 1}};
  await fs.writeFile(path.join(dataDir, 'services.json'), JSON.stringify({services: [hand]}));
  const s = services.create({dataDir});
  const r = await s.add({id: 'yuzuk', label: 'installer', command: node, args: ['-e', '0'], alive: {port: 2}});
  assert.equal(r.added, false);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'services.json'), 'utf8')).services[0].label, 'hand');
  const r2 = await s.add({id: 'yeni', label: 'installer', command: node, args: ['-e', '0'], alive: {port: 3}});
  assert.equal(r2.added, true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'services.json'), 'utf8')).services.map(x => x.id), ['yuzuk', 'yeni']);
  await s.stop();
  await assert.rejects(s.add({id: 'Bad Id', command: node}), /Invalid service id/);
  await fs.rm(dataDir, {recursive: true, force: true});
});
