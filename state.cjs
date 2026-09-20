'use strict';
/**
 * Derived state — what Claudian knows about itself, without asking anyone.
 *
 * ── The problem this answers ─────────────────────────────────
 *
 * The panel could only describe the user's situation if an AI had recently been opened and
 * had written something down. "Spark verification is still pending" is not a fact that needs
 * a language model: it is application state, sitting in four files on this disk. But it was
 * computed inside a render function, shown once, and thrown away — so with the window closed
 * Claudian knew nothing, and with the window open it knew nothing it could act on later.
 *
 * Everything below is derived from files the application already owns:
 *
 *   profile.json          which folder, which access, which connections, what was verified
 *   reviews/<host>.json   the first review of each connection and how it ended
 *   remote-grants.json    which provider accounts are authorised, and what they have called
 *   remote-device.json    whether this device is connected to the relay
 *   the vault's panel and reminders notes, active sections only
 *
 * No model is consulted, nothing is inferred, and a value that cannot be derived is absent
 * rather than guessed.
 *
 * ── Levels and transitions ───────────────────────────────────
 *
 * `derive()` returns a level: the whole current picture. `diff()` turns two levels into
 * transitions — the small set of things that actually changed. Only transitions are worth
 * recording, and later, notifying on: a level repeated every twenty seconds is not news.
 */
const fs = require('node:fs/promises');
const path = require('node:path');

/** The order matters: the first unmet condition is the one to fix. */
const SETUP = ['VAULT_MISSING', 'OBSIDIAN_RESTART_REQUIRED', 'OBSIDIAN_MISSING', 'AI_NOT_SELECTED',
  'CONNECTION_FAILED', 'AI_SELECTED_NOT_CONNECTED', 'VERIFY_PENDING', 'READY'];

/** Connections that reach their provider over the device relay rather than a local file. */
const REMOTE = ['chatgpt', 'gemini', 'perplexity'];

/** A review state that is asking for something, mapped to why. */
const REVIEW_ATTENTION = {
  invalid: 'first_review_rejected',
  failed: 'first_review_failed',
  expired: 'first_review_expired',
  stale: 'first_review_stale',
  superseded: 'first_review_superseded',
  needs_input: 'first_review_needs_input',
};

/*
  Dates, in the three spellings this memory actually uses.

  The reminders note is the one place the vault holds an obligation with a moment attached,
  and "due" was the state the panel could not derive: it listed unchecked boxes and left the
  reading of them to a person, or to a model, which is the thing this engine exists to stop
  needing. Nothing is guessed — a line with no recognisable date is a reminder without a date,
  never a reminder that happens to be due today.
*/
const AYLAR = ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const TWO = value => String(value).padStart(2, '0');
const isoOf = (y, m, d) => {
  const probe = new Date(Date.UTC(y, m - 1, d));
  // 31.02 is not a date, and a memory that accepts it starts reporting obligations that
  // cannot arrive.
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return y + '-' + TWO(m) + '-' + TWO(d);
};
function findDate(text) {
  const value = String(text);
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return isoOf(+iso[1], +iso[2], +iso[3]);
  const dotted = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(value);
  if (dotted) return isoOf(+dotted[3], +dotted[2], +dotted[1]);
  // The spelling `capture` writes: "20 Eylül 2026" / "20 September 2026".
  const named = /(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/.exec(value);
  if (named) {
    const lower = named[2].toLocaleLowerCase('tr');
    const month = AYLAR.indexOf(lower) >= 0 ? AYLAR.indexOf(lower) + 1
      : MONTHS.indexOf(named[2].toLowerCase()) >= 0 ? MONTHS.indexOf(named[2].toLowerCase()) + 1 : 0;
    if (month) return isoOf(+named[3], month, +named[1]);
  }
  return null;
}
/** overdue · today · soon (within a week) · later. Only the first two are worth interrupting for. */
function whenIs(iso, todayIso) {
  if (!iso) return null;
  if (iso < todayIso) return 'overdue';
  if (iso === todayIso) return 'today';
  const days = (Date.parse(iso) - Date.parse(todayIso)) / 86400000;
  return days <= 7 ? 'soon' : 'later';
}

// Checked boxes are done; an unchecked one inside an archived section is not a task at all,
// which is why the note is read through the lifecycle filter rather than raw.
function openItems(body, limit = 20, todayIso = null) {
  const out = [];
  for (const line of String(body).split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\[ \]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    // The panel writes its entries with a bold thesis sentence first. That sentence is the
    // item; the paragraph after it is context the panel does not need.
    const bold = /^\*\*(.+?)\*\*/.exec(m[1]);
    const text = (bold ? bold[1] : m[1]).replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').trim();
    if (!text) continue;
    const short = text.length > 160 ? text.slice(0, 157) + '…' : text;
    if (todayIso === null) out.push(short);
    else {
      // The whole entry is searched for the date, not only the thesis sentence: the date is
      // usually the segment just after it.
      const date = findDate(m[1]);
      out.push({ text: short, date, due: whenIs(date, todayIso) });
    }
    if (out.length >= limit) break;
  }
  return out;
}

async function activeBody(vault, note, language) {
  if (!note) return '';
  try {
    const body = await fs.readFile(path.join(vault, note), 'utf8');
    const view = require('./lifecycle.cjs').activeOnly(body, language);
    return view.status === 'active' ? view.body : '';
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return '';
    throw error;
  }
}

/**
 * The whole picture, from disk. Pure with respect to its inputs: every caller passes the
 * same objects the panel already loads, so this adds no extra work to a render.
 */
async function derive({ profile, health, connections = [], connector = {}, reviews = {}, obsidian = {},
  selfCheck = null, language = 'en', now: injected = null }) {
  const now = injected || new Date().toISOString();
  const todayIso = now.slice(0, 10);
  if (!profile) return { setup: 'AI_NOT_SELECTED', connections: [], attention: [], openLoops: [], reminders: [], connector: {}, updatedAt: now };

  const usable = id => {
    const c = connections.find(x => x.id === id);
    return !!c && c.status === 'ready' && c.access?.state !== 'unavailable';
  };
  const hostState = id => (health?.hosts || []).find(h => h.id === id) || null;

  // The application already checks its own work: files, folder permission, and whether the
  // server a host would launch actually answers. That verdict was shown on one screen and
  // never became state, so "a connection is broken" could not be known with the window shut.
  const checkOf = id => (selfCheck?.connections || []).find(c => c.id === id) || null;
  const list = (profile.hosts || []).map(h => {
    const info = hostState(h.id), review = reviews[h.id] || null, check = checkOf(h.id);
    // A challenge was issued and the answer never came back. That is a verification someone
    // started and did not finish -- distinct from one never attempted, and the only reason
    // the panel can say which.
    const attempted = h.challenge?.issuedAt || null;
    return {
      id: h.id,
      label: info?.label || h.label || h.id,
      connected: usable(h.id),
      verified: info?.state === 'verified',
      verificationStale: info?.state === 'stale',
      verifiedAt: info?.verifiedAt || null,
      verificationAttemptedAt: info?.state === 'verified' ? null : attempted,
      failing: check?.failing?.length ? check.failing : null,
      review: review?.status || 'not_started',
      reviewReason: review?.message || (review?.status === 'superseded' ? `${review.from} → ${review.to}` : null),
    };
  });

  // The first unmet condition, in the order a person would actually fix them.
  let setup = 'READY';
  if (profile.vault && (health?.vaultMissing)) setup = 'VAULT_MISSING';
  else if (profile.storage === 'obsidian' && obsidian.needsClose) setup = 'OBSIDIAN_RESTART_REQUIRED';
  else if (profile.storage === 'obsidian' && obsidian.present === false) setup = 'OBSIDIAN_MISSING';
  else if (!list.length) setup = 'AI_NOT_SELECTED';
  // A cloud connection whose account is not set up yet reports its folder access as
  // unavailable, which is true and is not a fault: it is the ordinary state of a connection
  // nobody has finished. Reading it as a failure made a fresh install accuse itself.
  else if (connections.some(c => c.access?.state === 'unavailable' && !REMOTE.includes(c.id))) setup = 'CONNECTION_FAILED';
  else if (!list.some(c => c.connected)) setup = 'AI_SELECTED_NOT_CONNECTED';
  else if (!(health?.verifiedCount > 0) && !health?.skippedAt) setup = 'VERIFY_PENDING';

  // Attention is a list of specific, named things — never a count and never a mood.
  const attention = [];
  if (setup !== 'READY') attention.push({ kind: 'setup_incomplete', detail: setup });
  if (connector.enabled && connector.state === 'offline')
    attention.push({ kind: 'connector_offline', detail: connector.lastError || null });
  for (const c of list) {
    // A named fault outranks "not verified yet": one is broken, the other is unfinished.
    if (c.failing) attention.push({ kind: 'connection_broken', host: c.id, label: c.label, detail: c.failing.join(', ') });
    else if (c.connected && !c.verified && !health?.skippedAt)
      attention.push({
        kind: c.verificationStale ? 'verification_stale'
          : c.verificationAttemptedAt ? 'verification_unfinished' : 'verification_pending',
        host: c.id, label: c.label, detail: c.verificationAttemptedAt || null });
    const why = REVIEW_ATTENTION[c.review];
    if (why) attention.push({ kind: why, host: c.id, label: c.label, detail: c.reviewReason });
  }
  for (const r of connector.requests || []) attention.push({ kind: 'authorization_waiting', host: r.host, detail: r.name });

  const roles = profile.vault ? await require('./roles.cjs').resolve(profile.vault).catch(() => ({ roles: {} })) : { roles: {} };
  const openLoops = openItems(await activeBody(profile.vault, roles.roles?.panel, language));
  const reminders = openItems(await activeBody(profile.vault, roles.roles?.reminders, language), 20, todayIso);
  // The reminders note says it itself: remind without drowning, only the near ones. A date
  // that has passed or is today is worth a line in "needs you"; next week is a list entry.
  for (const r of reminders) if (r.due === 'overdue' || r.due === 'today')
    attention.push({ kind: r.due === 'today' ? 'reminder_due' : 'reminder_overdue', label: r.text, detail: r.date });

  return {
    setup,
    vault: profile.vault,
    access: profile.access,
    protocolVersion: profile.protocolVersion,
    connector: { state: connector.state || 'stopped', enabled: !!connector.enabled, lastError: connector.lastError || null },
    // A deliberate skip is honoured -- and stated. Nothing waiting because the check was
    // skipped is not the same as nothing waiting because everything was proven.
    verificationSkipped: !!health?.skippedAt,
    connections: list,
    attention,
    openLoops,
    reminders,
    today: todayIso,
    updatedAt: now,
  };
}

/** A stable identity for one item of attention, so the same worry is not reported twice. */
const key = a => [a.kind, a.host || '', a.label || ''].join('|');

/** Everything that is different, and nothing that is not. */
function diff(before, after) {
  if (!before) return [];
  const events = [];
  const at = after.updatedAt;
  // Attention appearing and attention going away are both news, and the second one is what
  // makes the panel a working surface rather than a list that only grows.
  const had = new Map((before.attention || []).map(a => [key(a), a]));
  const has = new Map((after.attention || []).map(a => [key(a), a]));
  for (const [k, a] of has) if (!had.has(k)) events.push({ kind: 'attention_raised', detail: a.kind, host: a.host || null, label: a.label || null, at });
  for (const [k, a] of had) if (!has.has(k)) events.push({ kind: 'attention_cleared', detail: a.kind, host: a.host || null, label: a.label || null, at });
  if (before.setup !== after.setup) events.push({ kind: 'setup_changed', from: before.setup, to: after.setup, at });
  if (before.connector?.state !== after.connector?.state) {
    const restored = after.connector?.state === 'online';
    events.push({ kind: restored ? 'connection_restored' : 'connection_changed', to: after.connector?.state, detail: after.connector?.lastError || null, at });
  }
  const was = new Map((before.connections || []).map(c => [c.id, c]));
  for (const c of after.connections || []) {
    const old = was.get(c.id);
    if (!old) continue;
    if (!old.verified && c.verified) events.push({ kind: 'verification_completed', host: c.id, at });
    if (old.verified && !c.verified) events.push({ kind: 'verification_lost', host: c.id, at });
    if (old.review !== c.review) {
      if (c.review === 'completed') events.push({ kind: 'first_review_completed', host: c.id, at });
      else if (REVIEW_ATTENTION[c.review]) events.push({ kind: 'first_review_attention', host: c.id, detail: c.review, at });
    }
  }
  return events;
}

// Two files, both small, both replaceable: this is a cache of a derivation, never a source
// of truth. Losing them costs one render.
async function persist(dataDir, next) {
  const file = path.join(dataDir, 'state.json');
  let before = null;
  try { before = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const events = diff(before, next);
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = file + '.' + require('node:crypto').randomUUID() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(next), { flag: 'wx' });
  await fs.rename(tmp, file);
  if (events.length) {
    const log = path.join(dataDir, 'events.jsonl');
    await fs.appendFile(log, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    // Append-only, but not unbounded: this is a short recent history, not an archive.
    try {
      const body = await fs.readFile(log, 'utf8');
      const lines = body.split('\n').filter(Boolean);
      if (lines.length > 500) await fs.writeFile(log, lines.slice(-500).join('\n') + '\n');
    } catch { /* trimming is best effort */ }
  }
  return { state: next, events };
}

async function recent(dataDir, limit = 20) {
  try {
    const body = await fs.readFile(path.join(dataDir, 'events.jsonl'), 'utf8');
    return body.split('\n').filter(Boolean).slice(-limit).map(line => JSON.parse(line)).reverse();
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

module.exports = { derive, diff, persist, recent, openItems, findDate, whenIs, key, SETUP, REVIEW_ATTENTION };
