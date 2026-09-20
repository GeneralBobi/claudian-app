'use strict';
// Information lifecycle. Protocol 2.9.0.
//
// Measured on the reference vault 20.09.2026: decisions from 0.11.x, 0.13.x, 0.16.x, the
// abandoned Next/1.0.0 architecture and the current 0.19.0 line all sat in one note, all
// reachable at the same level by the same startup read. Old information is worth keeping --
// rollback, provenance, "why did we do it this way" -- but it was being handed to the model
// with exactly the authority of a current decision, and an unchecked box inside an abandoned
// plan looked like an open task.
//
// Four states, only three of which are states:
//   ACTIVE      in force; normal retrieval and startup context use it.
//   SUPERSEDED  a newer record explicitly took its place; kept for provenance.
//   ARCHIVED    not in force, kept for rollback and historical research.
//   DELETE      NOT a state. An explicit forget removes content; it is never quietly turned
//               into an archive entry. That rule belongs to privacy and lives in the protocol.
//
// The marker is human-readable and sits directly under the heading it retires, because a
// status the owner cannot see in their own note is a status they cannot correct. The same
// string is the parse anchor: one token, one meaning, no hidden metadata beside it.

const TOKEN = {
  archived: {tr: '⚠ Arşiv — yürürlükte değil', en: '⚠ Archive — no longer in force'},
  superseded: {tr: '⚠ Yerine geçti — yürürlükte değil', en: '⚠ Superseded — no longer in force'},
};
const BODY = {
  archived: {
    tr: 'Bu bölüm tarihsel kayıttır. Aktif karar, görev veya güncel ürün davranışı olarak kullanılmaz. Yalnız rollback, provenance veya geçmiş incelemesi gerektiğinde başvurulur.',
    en: 'This section is a historical record. It is not used as an active decision, task or current product behaviour. It is consulted only for rollback, provenance or historical review.',
  },
  superseded: {
    tr: 'Bu bölüm tarihsel kayıttır. Aktif karar, görev veya güncel ürün davranışı olarak kullanılmaz. Yalnız rollback, provenance veya geçmiş incelemesi gerektiğinde başvurulur.',
    en: 'This section is a historical record. It is not used as an active decision, task or current product behaviour. It is consulted only for rollback, provenance or historical review.',
  },
};
const SUCCESSOR = {tr: 'Yerine geçen', en: 'Replaced by'};

// Both spellings of both tokens, whatever language the vault was created in.
const ANCHOR = /^>\s*\**\s*⚠\s*(Arşiv|Archive|Yerine geçti|Superseded)\b/;
const ARCHIVED_WORD = /^(Arşiv|Archive)$/;

// Headings that already said "not in force" before this mechanism existed. A vault written by
// an earlier version carries no marker, and rewriting every one of those notes to add one
// would be a migration nobody asked for. These are recognised by shape instead.
const HISTORICAL_HEADING = /^(Tarihçe|History|Yürürlükten düşenler|Retired|Kapanan|Closed|Arşiv|Archive|Sürüm geçmişi|Version history)\b/i;

const LANG = language => (language === 'tr' ? 'tr' : 'en');

/**
 * The visible marker for a retired heading.
 * A date or a successor is shown only when it is actually known; neither is invented.
 */
function marker(status, options = {}) {
  if (status !== 'archived' && status !== 'superseded') throw Error('marker: status must be archived or superseded');
  const language = LANG(options.language);
  const when = options.date ? ` (${options.date})` : '';
  const lines = [`> **${TOKEN[status][language]}${when}**`];
  if (status === 'superseded' && options.successor) lines.push(`> ${SUCCESSOR[language]}: ${options.successor}`);
  lines.push(`> ${BODY[status][language]}`);
  return lines.join('\n');
}

/** Note-level status from front matter. A whole note is retired only when it says so itself. */
function noteStatus(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) return 'active';
  const end = text.indexOf('\n---', 3);
  const front = end === -1 ? text : text.slice(0, end);
  const match = /^(?:claudian_lifecycle|lifecycle|durum|status):\s*(.+?)\s*$/m.exec(front);
  if (!match) return 'active';
  const value = match[1].replace(/["'`]/g, '').trim().toLocaleLowerCase('tr');
  if (['archived', 'arşiv', 'arsiv', 'arşivlendi'].includes(value)) return 'archived';
  if (['superseded', 'yerine geçti', 'yerine gecti', 'düştü'].includes(value)) return 'superseded';
  return 'active';
}

/**
 * Every `##`+ section of a note with its lifecycle status.
 * A heading is retired when it carries the marker directly beneath it, or when its own name
 * is one the product has always used for history. Only one heading being old never retires
 * the note: section-level archival is the default, note-level is the exception.
 */
function sections(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const frontEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const found = [];
  for (let i = frontEnd + 1; i < lines.length; i++) {
    const heading = /^(#{2,6})\s+(.*\S)\s*$/.exec(lines[i]);
    if (!heading) continue;
    if (found.length) found[found.length - 1].end = i;
    const title = heading[2];
    let status = HISTORICAL_HEADING.test(title) ? 'archived' : 'active';
    let successor = null;
    // The marker sits under the heading, past blank lines, before any content.
    for (let j = i + 1; j < lines.length && j <= i + 4; j++) {
      if (!lines[j].trim()) continue;
      const anchor = ANCHOR.exec(lines[j]);
      if (anchor) {
        status = ARCHIVED_WORD.test(anchor[1]) ? 'archived' : 'superseded';
        const link = /^>\s*(?:Yerine geçen|Replaced by):\s*(.+?)\s*$/.exec(lines[j + 1] || '');
        if (link) successor = link[1];
      }
      break;
    }
    found.push({title, level: heading[1].length, start: i, end: lines.length, status, successor});
  }
  return found;
}

/**
 * The note as startup context and open-loop projection are allowed to see it.
 *
 * Retired sections are removed rather than summarised, so an unchecked box inside an abandoned
 * plan cannot become today's task. What is NOT done is hide that they exist: "the evidence is
 * unreachable" and "there is no such evidence" are different claims, and a model that cannot
 * tell them apart answers a history question with silence. A one-line notice names each
 * retired heading and says how to read it in full.
 */
function activeOnly(body, language = 'en') {
  const text = String(body || '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const normalised = text.replace(/\r\n/g, '\n');
  if (noteStatus(normalised) !== 'active') {
    return {body: text, status: noteStatus(normalised), retired: [], changed: false};
  }
  const found = sections(normalised);
  const retired = found.filter(s => s.status !== 'active');
  if (!retired.length) return {body: text, status: 'active', retired: [], changed: false};

  const lines = normalised.split('\n');
  // A retired heading takes its nested subsections with it: they belong to the plan that was
  // retired, not to whatever heading happens to follow it.
  const drop = new Set();
  for (const section of retired) {
    let end = lines.length;
    for (const other of found) if (other.start > section.start && other.level <= section.level) {end = other.start; break;}
    for (let i = section.start; i < end; i++) drop.add(i);
  }
  const kept = lines.filter((_, i) => !drop.has(i));
  const tr = LANG(language) === 'tr';
  const names = retired.map(s => s.title).join(' · ');
  const notice = tr
    ? `> ⚠ Bu notun ${retired.length} bölümü yürürlükte değil ve bu görünümden çıkarıldı: ${names}. Geçmiş, rollback veya karar kökeni sorulduğunda notun tamamı read_note ile okunur.`
    : `> ⚠ ${retired.length} section(s) of this note are no longer in force and were left out of this view: ${names}. Read the whole note with read_note when history, rollback or decision provenance is asked for.`;
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const out = [...kept, '', notice, ''].join('\n');
  return {body: eol === '\n' ? out : out.replace(/\n/g, eol), status: 'active', retired: retired.map(s => ({title: s.title, status: s.status, successor: s.successor})), changed: true};
}

module.exports = {marker, noteStatus, sections, activeOnly, TOKEN, BODY, SUCCESSOR, ANCHOR, HISTORICAL_HEADING};
