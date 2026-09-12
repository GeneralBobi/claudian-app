'use strict';
// grants.cjs shipped in the source and was never added to build.files, so the packaged app
// would have thrown on require at startup while every source test stayed green. Tests that
// run from the source tree cannot see a packaging gap; this one reads the manifest instead.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const listed = manifest.build.files;

// Entry points the packaged app actually starts from; everything else is reached through these.
const entries = ['main.cjs', 'preload.cjs', 'smoke.cjs'];

function localRequires(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [, name] of source.matchAll(/require\('\.\/([A-Za-z0-9_.-]+)'\)/g)) {
    const dependency = name.endsWith('.cjs') ? name : `${name}.cjs`;
    if (fs.existsSync(path.join(root, dependency))) localRequires(dependency, seen);
  }
  return seen;
}

test('every module the app requires is in the packaging list', () => {
  const reachable = new Set();
  for (const entry of entries) for (const file of localRequires(entry)) reachable.add(file);
  const missing = [...reachable].filter(file => !listed.includes(file));
  assert.deepEqual(missing, [], `these would be absent from the installed app: ${missing.join(', ')}`);
});

test('the packaging list does not name files that no longer exist', () => {
  const ghosts = listed.filter(entry => !entry.includes('*') && !fs.existsSync(path.join(root, entry)));
  assert.deepEqual(ghosts, [], `listed but missing from disk: ${ghosts.join(', ')}`);
});

test('the shipped protocol files are packaged with the policy that loads them', () => {
  assert.ok(listed.some(entry => entry.startsWith('policies/')), 'policies/ must ship');
  for (const language of ['en', 'tr']) {
    assert.ok(fs.existsSync(path.join(root, 'policies', `protocol-${language}.md`)), `protocol-${language}.md exists`);
  }
});
