'use strict';
// Background services: long-running local processes Claudian keeps alive while it sits in the
// tray -- a tunnel, a local web core, a recording node. They used to be started by a logon task
// and cmd windows that flashed on every sign-in and died with their console. Now Claudian owns
// them: no window, restarted when they fall over, stopped when Claudian quits.
//
// Nothing is built in. The list is the user's own `services.json` in the data folder, so an
// installation without one runs nothing and a public build carries no personal paths.
//
// services.json:
// { "services": [ { "id": "tunnel", "label": "Cloudflare tunnel",
//     "command": "C:\\...\\cloudflared.exe", "args": ["tunnel","run","claudian"],
//     "cwd": "C:\\...", "env": {"KEY":"value"},
//     "alive": { "port": 3041 } | { "match": "tunnel run claudian" } } ] }
//
// `alive` says how to recognise the service when something else already started it. A running
// copy is adopted rather than duplicated: two tunnels or two servers on one port is worse than
// either one missing.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), net = require('node:net');
const { spawn, execFile } = require('node:child_process');

const BACKOFF = [5, 15, 60, 300];
const CHECK_SECONDS = 60;

function portOpen(port, host = '127.0.0.1', timeout = 1500) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// One PowerShell call for every command-line match, hidden: Windows has no cheaper way to
// read another process's command line.
function commandLines() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const script = "Get-CimInstance Win32_Process | ForEach-Object { [string]$_.ProcessId + ' ' + $_.CommandLine }";
  return new Promise(resolve => execFile('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 },
    (error, stdout) => resolve(error ? [] : String(stdout).split(/\r?\n/).filter(Boolean))));
}

function validate(list) {
  if (!Array.isArray(list)) throw Error('services must be a list');
  const seen = new Set();
  return list.map(s => {
    if (!s || typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id) || seen.has(s.id)) throw Error('Invalid service id');
    seen.add(s.id);
    if (typeof s.command !== 'string' || !path.isAbsolute(s.command)) throw Error(`${s.id}: command must be an absolute path`);
    if (s.args !== undefined && (!Array.isArray(s.args) || s.args.some(a => typeof a !== 'string'))) throw Error(`${s.id}: args must be strings`);
    if (s.cwd !== undefined && (typeof s.cwd !== 'string' || !path.isAbsolute(s.cwd))) throw Error(`${s.id}: cwd must be an absolute path`);
    const alive = s.alive || {};
    if (alive.port !== undefined && !(Number.isInteger(alive.port) && alive.port > 0 && alive.port < 65536)) throw Error(`${s.id}: invalid port`);
    if (alive.match !== undefined && (typeof alive.match !== 'string' || !alive.match.trim())) throw Error(`${s.id}: invalid match`);
    return { id: s.id, label: typeof s.label === 'string' ? s.label.slice(0, 60) : s.id, command: s.command, args: s.args || [],
      cwd: s.cwd || path.dirname(s.command), env: s.env && typeof s.env === 'object' ? s.env : {}, alive, enabled: s.enabled !== false };
  });
}

function create({ dataDir, log = () => {} }) {
  const file = path.join(dataDir, 'services.json'), logDir = path.join(dataDir, 'logs', 'services');
  const state = new Map(); // id -> { spec, child, adopted, phase, failures, timer, lastError }
  let stopping = false, interval = null;

  async function load() {
    let raw;
    try { raw = JSON.parse(await fsp.readFile(file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return []; throw Error('services.json could not be read: ' + e.message); }
    return validate(raw.services || []).filter(s => s.enabled);
  }

  async function running(spec, lines) {
    if (spec.alive.port && await portOpen(spec.alive.port)) return true;
    if (spec.alive.match) {
      const needle = spec.alive.match.toLowerCase();
      return (lines || await commandLines()).some(l => l.toLowerCase().includes(needle) && !l.toLowerCase().includes('get-ciminstance'));
    }
    return false;
  }

  function launch(entry) {
    const { spec } = entry;
    fs.mkdirSync(logDir, { recursive: true });
    const out = fs.openSync(path.join(logDir, spec.id + '.log'), 'a');
    fs.writeSync(out, `\n--- ${new Date().toISOString()} start ${spec.label}\n`);
    let child;
    try {
      // windowsHide + no shell: no console window, and no command-line interpolation.
      child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: { ...process.env, ...spec.env }, windowsHide: true,
        shell: false, detached: false, stdio: ['ignore', out, out] });
    } catch (error) { fs.closeSync(out); return fail(entry, error.message); }
    entry.child = child; entry.adopted = false; entry.phase = 'running'; entry.startedAt = Date.now();
    child.once('error', error => { fs.closeSync(out); fail(entry, error.message); });
    child.once('exit', code => {
      try { fs.closeSync(out); } catch {}
      entry.child = null;
      if (stopping) { entry.phase = 'stopped'; return; }
      // A service that lived for ten minutes has earned a fresh backoff.
      if (Date.now() - entry.startedAt > 10 * 60 * 1000) entry.failures = 0;
      fail(entry, `exited with code ${code}`);
    });
    log(`[services] ${spec.id} started (pid ${child.pid})`);
  }

  function fail(entry, message) {
    entry.phase = 'failed'; entry.lastError = message; entry.child = null;
    if (stopping) return;
    const wait = BACKOFF[Math.min(entry.failures, BACKOFF.length - 1)];
    entry.failures += 1;
    log(`[services] ${entry.spec.id} ${message}; retry in ${wait}s`);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void ensure(entry), wait * 1000);
    entry.timer.unref?.();
  }

  async function ensure(entry, lines) {
    if (stopping || entry.child) return;
    if (await running(entry.spec, lines)) { entry.adopted = true; entry.phase = 'running'; return; }
    launch(entry);
  }

  async function start() {
    stopping = false;
    let specs;
    try { specs = await load(); } catch (error) { log('[services] ' + error.message); return; }
    if (!specs.length) return;
    for (const spec of specs) state.set(spec.id, { spec, child: null, adopted: false, phase: 'starting', failures: 0, timer: null, lastError: null });
    const lines = specs.some(s => s.alive.match) ? await commandLines() : [];
    for (const entry of state.values()) await ensure(entry, lines);
    // Adopted copies are not our children, so their exit is noticed by looking.
    interval = setInterval(async () => {
      const adopted = [...state.values()].filter(e => e.adopted && !e.child);
      if (!adopted.length) return;
      const now = adopted.some(e => e.spec.alive.match) ? await commandLines() : [];
      for (const entry of adopted) if (!await running(entry.spec, now)) { entry.adopted = false; await ensure(entry, now); }
    }, CHECK_SECONDS * 1000);
    interval.unref?.();
  }

  // Only processes Claudian started are stopped. Something the user launched themselves is
  // theirs to close.
  async function stop() {
    stopping = true;
    clearInterval(interval);
    await Promise.all([...state.values()].map(entry => new Promise(resolve => {
      clearTimeout(entry.timer);
      const child = entry.child;
      if (!child || child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
      else child.kill('SIGTERM');
      setTimeout(resolve, 5000).unref?.();
    })));
  }

  function status() {
    return [...state.values()].map(e => ({ id: e.spec.id, label: e.spec.label, phase: e.phase, adopted: e.adopted,
      pid: e.child?.pid || null, lastError: e.lastError }));
  }

  return { start, stop, status, file };
}

module.exports = { create, validate, portOpen };
