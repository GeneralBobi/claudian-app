'use strict';
// The Core bridge knows exactly why a connection failed; the panel used to print one
// sentence for all three reasons. An unreachable Core then read as a rejected code, and
// the reader concluded their data was gone. These tests hold the three apart.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'renderer.js'), 'utf8');

// renderer.js is a browser script, not a module. Lift the one function out by brace balance
// so the test reads the shipped code rather than a copy that can drift from it.
function lift(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in the shipped renderer`);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is unbalanced`);
}

// `t` picks English or Turkish; both languages are exercised through it.
const build = language => new Function('t', `${lift('coreIssue')}; return coreIssue;`)(
  (en, tr) => (language === 'tr' ? tr : en));

const CODES = ['CORE_AUTH_REQUIRED', 'CORE_RATE_LIMIT', 'CORE_UNAVAILABLE'];

for (const language of ['en', 'tr']) {
  test(`[${language}] each failure reason gets its own sentence`, () => {
    const coreIssue = build(language);
    const said = CODES.map(code => coreIssue(new Error(code), false));
    assert.equal(new Set(said).size, CODES.length, `collapsed into: ${said.join(' | ')}`);
    for (const text of said) assert.ok(text.trim().length > 0, 'no reason may be silent');
  });

  test(`[${language}] an unreachable Core is not reported as a rejected code`, () => {
    const coreIssue = build(language);
    const offline = coreIssue(new Error('CORE_UNAVAILABLE'), false);
    assert.doesNotMatch(offline, /not accepted|kabul edilmedi/i,
      'an offline Core must not be blamed on the code the user typed');
    assert.match(offline, /never checked|hiç denenmedi/i,
      'it must say the code was not even tried');
    assert.match(offline, /nothing was changed|hiçbir şey değişmedi/i,
      'it must say nothing was changed, which is what the reader actually fears');
  });

  test(`[${language}] an unknown or empty failure still explains itself`, () => {
    const coreIssue = build(language);
    for (const error of [new Error(''), new Error('something else'), undefined]) {
      assert.ok(coreIssue(error, false).trim().length > 0, 'never an empty alert');
    }
  });
}

test('the stale flag adds the last-state note only when there is one', () => {
  const coreIssue = build('en');
  assert.match(coreIssue(new Error('CORE_UNAVAILABLE'), true), /last received state/i);
  assert.doesNotMatch(coreIssue(new Error('CORE_UNAVAILABLE'), false), /last received state/i);
});

// Guard against a real slip made while writing this fix: `catch{...}` with an unbound `e`
// parses fine and throws ReferenceError only when the Core is actually down — the exact
// moment the message is needed.
test('every handler that reports a Core failure binds the error it reports', () => {
  for (const [, bound] of source.matchAll(/catch(\([A-Za-z_$][\w$]*\))?\s*\{([^}]*coreIssue\([^}]*)\}/g)) {
    assert.ok(bound, 'a catch block calling coreIssue must bind its error parameter');
  }
  assert.ok(/coreIssue\(/.test(source), 'the helper is actually wired up');
});
