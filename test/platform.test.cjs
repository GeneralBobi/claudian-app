'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');

// CLAUDIAN_PLATFORM lets the macOS paths be checked on any machine; CI also runs these on a real Mac.
function as(platform, fn) {
  const before = process.env.CLAUDIAN_PLATFORM;
  process.env.CLAUDIAN_PLATFORM = platform;
  try { return fn(require('../platform.cjs')); } finally {
    if (before === undefined) delete process.env.CLAUDIAN_PLATFORM; else process.env.CLAUDIAN_PLATFORM = before;
  }
}

test('macOS paths live under Library/Application Support and /Applications', () => as('darwin', p => {
  const home = '/Users/test';
  assert.equal(p.appData(home), path.join(home, 'Library', 'Application Support'));
  assert.equal(p.obsidianConfig(home), path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json'));
  assert.ok(p.appCandidates('claude-desktop', home).includes(path.join('/Applications', 'Claude.app')));
  assert.deepEqual(p.detectPaths('claude-desktop'), ['Library/Application Support/Claude']);
}));

test('macOS hook commands use a POSIX shell, never PowerShell', () => as('darwin', () => {
  delete require.cache[require.resolve('../claude-lifecycle.cjs')];
  const lifecycle = require('../claude-lifecycle.cjs');
  const cmd = lifecycle.command({exe: "/Applications/Claudian.app/Contents/MacOS/Claudian", script: "/tmp/it's/memory-hook.cjs", dataDir: '/tmp/data'});
  assert.match(cmd, /^ELECTRON_RUN_AS_NODE=1 '/);
  assert.ok(!cmd.includes('$env:'), 'no PowerShell syntax');
  assert.ok(cmd.includes("'/tmp/it'\\''s/memory-hook.cjs'"), 'single quotes are escaped for sh');
  const merged = JSON.parse(lifecycle.merge('{}', {exe: '/x', script: '/y', dataDir: '/z', access: 'read'}));
  assert.equal(merged.hooks.UserPromptSubmit[0].hooks[0].shell, undefined);
}));

test('Windows keeps its PowerShell hooks', () => as('win32', () => {
  delete require.cache[require.resolve('../claude-lifecycle.cjs')];
  const lifecycle = require('../claude-lifecycle.cjs');
  const merged = JSON.parse(lifecycle.merge('{}', {exe: 'C:\\x.exe', script: 'C:\\y.cjs', dataDir: 'C:\\z', access: 'read'}));
  assert.equal(merged.hooks.UserPromptSubmit[0].hooks[0].shell, 'powershell');
}));
