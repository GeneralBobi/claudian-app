'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const {verdict} = require('../ring-audit.cjs');

// The real publisher key is not in the repository; a signature from any other key must be rejected.
const other = crypto.generateKeyPairSync('ed25519');
const signed = (surum, ozet, key = other.privateKey) =>
  crypto.sign(null, Buffer.from(`yuzuk-kurallar:${surum}:${ozet}`), key).toString('base64');

test('rules without a manifest are reported as unsigned', () => {
  const v = verdict({mahremiyet: {surum: '2026.09.27', kural_ozeti: 'a'.repeat(64), imza: null}});
  assert.equal(v.signed, false);
  assert.match(v.reason, /no signed rule manifest/);
});

test('changed rule files are detected even with an intact manifest', () => {
  const ozet = 'a'.repeat(64);
  const v = verdict({mahremiyet: {surum: '2026.09.27', kural_ozeti: 'b'.repeat(64),
    imza: {surum: '2026.09.27', kural_ozeti: ozet, imza: signed('2026.09.27', ozet)}}});
  assert.equal(v.signed, false);
  assert.match(v.reason, /differ from the signed version/);
});

test('a manifest signed by anyone but the publisher is rejected', () => {
  const ozet = 'c'.repeat(64);
  const v = verdict({mahremiyet: {surum: '2026.09.27', kural_ozeti: ozet,
    imza: {surum: '2026.09.27', kural_ozeti: ozet, imza: signed('2026.09.27', ozet)}}});
  assert.equal(v.signed, false);
  assert.match(v.reason, /not the publisher/);
});
