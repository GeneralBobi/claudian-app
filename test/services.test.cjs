'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const services = require('../services.cjs');

const wait = ms => new Promise(r => setTimeout(r, ms));
async function freePort() {
  const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address(); await new Promise(r => server.close(r)); return port;
}

test('rejects relative commands and duplicate ids', () => {
  assert.throws(() => services.validate([{ id: 'a', command: 'node' }]), /absolute/);
  assert.throws(() => services.validate([{ id: 'a', command: process.execPath }, { id: 'a', command: process.execPath }]), /id/);
  assert.equal(services.validate([{ id: 'a', command: process.execPath, enabled: false }])[0].enabled, false);
});

test('no services.json runs nothing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'svc-'));
  const s = services.create({ dataDir: dir }); await s.start();
  assert.deepEqual(s.status(), []); await s.stop();
});

test('starts a hidden child, adopts a running copy, stops only its own', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'svc-'));
  const port = await freePort();
  const script = path.join(dir, 'listen.cjs');
  await fs.writeFile(script, `require('net').createServer().listen(${port},'127.0.0.1');`);
  await fs.writeFile(path.join(dir, 'services.json'), JSON.stringify({ services: [
    { id: 'web', label: 'Web', command: process.execPath, args: [script], alive: { port } }] }));
  const first = services.create({ dataDir: dir }); await first.start();
  for (let i = 0; i < 40 && !await services.portOpen(port); i++) await wait(100);
  assert.equal(await services.portOpen(port), true);
  assert.equal(first.status()[0].adopted, false);

  // A second Claudian finds the port in use and adopts it instead of starting another copy.
  const second = services.create({ dataDir: dir }); await second.start();
  assert.equal(second.status()[0].adopted, true);
  await second.stop();
  assert.equal(await services.portOpen(port), true, 'adopted service must survive');

  await first.stop();
  for (let i = 0; i < 40 && await services.portOpen(port); i++) await wait(100);
  assert.equal(await services.portOpen(port), false);
});
