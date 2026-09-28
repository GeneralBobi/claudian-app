'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../ring-context.cjs');

test('link targets must stay inside the vault and cannot break a wikilink', () => {
  for (const bad of ['', '../x', '/etc/x', 'C:/x', 'a]]b', 'a|b', 'a/../b', 'a//b', 'x'.repeat(300)]) assert.equal(c.target(bad), null, bad);
  assert.equal(c.target('Dersler/KOD101 - Ders'), 'Dersler/KOD101 - Ders');
});

test('context text from the vault is reduced to plain text', () => {
  const line = c.contextLine({tur: 'ders', ad: 'Ders [[Kararlar]] <script>', zaman: 'Pzt\n# başlık', hoca: 'A | B', not: 'Dersler/D'});
  assert.equal(line, '**Ders:** [[Dersler/D|Ders Kararlar script]] · Pzt başlık · A B');
  assert.equal(c.contextLine({tur: 'bilinmeyen', ad: 'x'}), null);
  assert.equal(c.frontmatterLine({tur: 'hatirlatici', ad: 'x', not: 'a'}), null);
  assert.equal(c.frontmatterLine({tur: 'etkinlik', ad: 'x', not: 'Etkinlikler/Zirve'}), 'etkinlik: "[[Etkinlikler/Zirve]]"');
});

test('a recording row goes under the existing table and matches its columns', () => {
  const four = '# Zirve\n\n## Oturumlar\n\n| Gün | Saat | Oturum | Bağ |\n|---|---|---|---|\n| 26.09 | 18:50 | A | [[a]] |\n\nSon paragraf.\n';
  const out = c.addRecordRow(four, {date: '27.09 Paz', time: '19:19', heading: 'B', link: 'b'});
  assert.ok(out.includes('| 26.09 | 18:50 | A | [[a]] |\n| 27.09 Paz | 19:19 | B | [[b]] |\n\nSon paragraf.'));
  assert.equal(c.addRecordRow(out, {date: '27.09 Paz', time: '19:19', heading: 'B', link: 'b'}), null, 'same recording is not listed twice');
});

test('a note without a recordings section gets one at the end', () => {
  const out = c.addRecordRow('# Ders\n\nMetin.\n\n', {date: '05.10 Pzt', time: '08:32', heading: 'Konu', link: 'k'});
  assert.ok(out.endsWith('## Kayıtlar\n\n| Tarih | Konu | Not |\n|---|---|---|\n| 05.10 Pzt | Konu | [[k]] |\n'));
});

test('the section ends at the next heading', () => {
  const body = '# D\n\n## Ders kayıtları\n\n| Tarih | Konu | Not |\n|---|---|---|\n| 1 | a | [[a]] |\n\n## Açık işler\n\n| x | y |\n';
  const out = c.addRecordRow(body, {date: '2', time: '', heading: 'b', link: 'b'});
  assert.ok(out.includes('| 1 | a | [[a]] |\n| 2 | b | [[b]] |\n\n## Açık işler'));
});

test('an appointment is linked under its own line, after its detail lines', () => {
  const body = '## Yaklaşan\n\n- [ ] **Toplantı · saat 19:00** · **5 Ekim 2026**\n  _kaynak_\n- [ ] **Başka** · **6 Ekim 2026**\n';
  const out = c.linkReminder(body, 'Toplantı', 'kayit');
  assert.ok(out.includes('  _kaynak_\n  → kayıt: [[kayit]]\n- [ ] **Başka**'));
  assert.equal(c.linkReminder(body, 'Yok', 'k'), null);
  assert.equal(c.linkReminder(body, 'Topla…', 'k'), null, 'a shortened name is not guessed');
});
