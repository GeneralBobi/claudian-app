'use strict';
// One capability that answers "where does this go?" so the model does not have to.
//
// Measured 13.09.2026: in an empty vault a durable fact ("I have an interview on Saturday")
// found no note shaped for it, and the protocol's "the default is not to open a new note"
// turned that into NO_OP. The admission test said write; the placement rule said nowhere;
// placement won. Two thresholds had collapsed into one decision.
//
// capture keeps them apart. The model decides only that something is worth keeping and what
// kind of thing it is. The role resolver decides the note, this module decides the section and
// the line format, and memory-store performs the guarded write with a receipt. A fact that is
// worth writing is never dropped for lack of a place: it enters the nearest role note as one
// line and is promoted to a section or a note of its own only when the subject grows.
const store = require('./memory-store.cjs');
const roles = require('./roles.cjs');

const AYLAR = ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// Which role holds each kind, and under which heading. Headings are matched in both languages
// because a vault keeps the language it was created in, whatever the profile says today.
const KINDS = {
  commitment: {role: 'reminders', headings: ['Yaklaşan', 'Upcoming'], task: true, dated: true},
  open_loop: {role: 'panel', headings: ['Açık döngüler', 'Open loops'], task: true},
  preference: {role: 'about', headings: ['Tercihler', 'Preferences']},
  agreement: {role: 'agreements', headings: ['Aktif anlaşmalar', 'Active agreements']},
  decision: {role: 'decisions', headings: ['Aktif', 'Active']},
  rejection: {role: 'decisions', headings: ['Reddedilen yaklaşımlar', 'Rejected approaches']},
  project: {role: 'projects', headings: []},
  lesson: {role: 'lessons', headings: []},
};
const SOURCES = ['user_statement', 'observation', 'inference'];

const today = () => new Date().toISOString().slice(0, 10);
const oneLine = value => String(value || '').replace(/\s+/g, ' ').trim();
const normal = value => oneLine(value).toLocaleLowerCase('tr');

function longDate(iso, language) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!match) throw Error('date must be YYYY-MM-DD. Do not invent a date; leave it out if it is unknown.');
  const month = Number(match[2]) - 1, day = Number(match[3]);
  const probe = new Date(Date.UTC(Number(match[1]), month, day));
  if (probe.getUTCMonth() !== month || probe.getUTCDate() !== day) throw Error('date is not a real calendar day.');
  const name = (language === 'tr' ? AYLAR : MONTHS)[month];
  return `${day} ${language === 'tr' ? name.charAt(0).toLocaleUpperCase('tr') + name.slice(1) : name.charAt(0).toUpperCase() + name.slice(1)} ${match[1]}`;
}

function entry(args, language) {
  const kind = KINDS[args.kind];
  const tr = language === 'tr';
  const text = oneLine(args.text);
  let line = `- ${kind.task ? '[ ] ' : ''}**${text}**`;
  if (args.date) line += ` · **${args.approximate ? '~' : ''}${longDate(args.date, language)}**`;
  if (args.kind === 'open_loop') line += ` · ${tr ? 'açıldı' : 'opened'}: ${today()}`;
  const lines = [line];
  if (oneLine(args.quote)) lines.push(`  > "${oneLine(args.quote)}"`);
  const source = {user_statement: tr ? 'kullanıcının sözü' : 'user statement', observation: tr ? 'gözlem' : 'observation', inference: tr ? 'çıkarım' : 'inference'}[args.source || 'user_statement'];
  lines.push(`  _${source} · ${tr ? 'kayıt' : 'recorded'}: ${today()}_`);
  return lines.join('\n');
}

// A note may end with a "---" rule and a related-links line. New content belongs above it.
function footerStart(lines, from) {
  for (let i = lines.length - 1; i > from; i--) {
    if (!/^---\s*$/.test(lines[i])) continue;
    const after = lines.slice(i + 1).filter(l => l.trim());
    return after.length <= 2 && after.every(l => !/^(#|- |\d+\. )/.test(l)) ? i : lines.length;
  }
  return lines.length;
}

function place(body, kind, block, language) {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const frontEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const wanted = KINDS[kind].headings.map(h => h.toLocaleLowerCase('tr'));
  const heading = lines.findIndex((l, i) => i > frontEnd && /^##\s+/.test(l) && wanted.includes(l.replace(/^##\s+/, '').trim().toLocaleLowerCase('tr')));
  let insertAt, prefix = [];
  if (heading >= 0) {
    let next = lines.findIndex((l, i) => i > heading && (/^#{1,2}\s/.test(l) || /^---\s*$/.test(l)));
    if (next < 0) next = lines.length;
    insertAt = next;
    while (insertAt - 1 > heading && !lines[insertAt - 1].trim()) insertAt--;
  } else {
    insertAt = footerStart(lines, frontEnd);
    while (insertAt - 1 > frontEnd && !lines[insertAt - 1].trim()) insertAt--;
    const name = KINDS[kind].headings[language === 'tr' ? 0 : 1];
    if (name) prefix = ['', `## ${name}`];
  }
  const block2 = [...prefix, '', ...block.split('\n')];
  const tail = lines.slice(insertAt);
  const needsGap = tail.length && tail[0].trim() ? [''] : [];
  let out = [...lines.slice(0, insertAt), ...block2, ...needsGap, ...tail].join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return eol === '\n' ? out : out.replace(/\n/g, eol);
}

function refreshUpdated(body) {
  const lines = body.split('\n');
  if (lines[0].trimEnd() !== '---') return body;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  for (let i = 1; i < end; i++) if (/^(güncellenme|updated):/.test(lines[i])) lines[i] = lines[i].replace(/:[^\r]*/, ': ' + today());
  return lines.join('\n');
}

async function capture(vault, args, actor = 'unknown', language = 'en') {
  const kind = KINDS[args?.kind];
  if (!kind) throw Error(`kind must be one of: ${Object.keys(KINDS).join(', ')}.`);
  const text = oneLine(args.text);
  if (!text || text.length > 400) throw Error('text is one distilled line of at most 400 characters, not a transcript.');
  if (args.source && !SOURCES.includes(args.source)) throw Error(`source must be one of: ${SOURCES.join(', ')}.`);
  if (kind.dated && !args.date) throw Error('A commitment needs its date. If the date is unknown, capture it as an open_loop instead of inventing one.');
  const {roles: resolved} = await roles.resolve(vault);
  const note = resolved[kind.role];
  if (!note) throw Error(`No note in this memory holds the "${kind.role}" role. Add the line to the most relevant existing note with append_note, or create the note with write_note.`);
  const current = await store.read(vault, note);
  const vaultLanguage = /^(tür|güncellenme):/m.test(current.body) ? 'tr' : /^(type|updated):/m.test(current.body) ? 'en' : language;
  const block = entry({...args, text}, vaultLanguage);
  // Compare complete active entries, not substrings of prose, quotes or retired tasks.
  // The date is part of a commitment's identity; an identically named later event is new.
  const identity = line => normal(line.replace(/ · (?:açıldı|opened): \d{4}-\d{2}-\d{2}$/, ''));
  if (current.body.split(/\r?\n/).some(line => identity(line) === identity(block.split('\n')[0]))) {
    return {status: 'duplicate', note, guidance: 'The same line already exists. Nothing was written; if something changed, update that line with patch_note.'};
  }
  const after = refreshUpdated(place(current.body, args.kind, block, vaultLanguage));
  const receipt = await store.mutate(vault, {note, operation: 'patch', expected_sha256: current.sha256, old_text: current.body, new_text: after,
    reason: oneLine(args.reason) || `capture:${args.kind}`}, actor);
  return {status: 'written', note, kind: args.kind, receipt: receipt.id};
}

module.exports = {capture, KINDS, place, entry, longDate};
