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

// Checked boxes are done; an unchecked one inside an archived section is not a task at all,
// which is why the note is read through the lifecycle filter rather than raw.
function openItems(body, limit = 20) {
  const out = [];
  for (const line of String(body).split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\[ \]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    // The panel writes its entries with a bold thesis sentence first. That sentence is the
    // item; the paragraph after it is context the panel does not need.
    const bold = /^\*\*(.+?)\*\*/.exec(m[1]);
    const text = (bold ? bold[1] : m[1]).replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').trim();
    if (text) out.push(text.length > 160 ? text.slice(0, 157) + '…' : text);
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
async function derive({ profile, health, connections = [], connector = {}, reviews = {}, obsidian = {}, language = 'en' }) {
  const now = new Date().toISOString();
  if (!profile) return { setup: 'AI_NOT_SELECTED', connections: [], attention: [], openLoops: [], reminders: [], connector: {}, updatedAt: now };

  const usable = id => {
    const c = connections.find(x => x.id === id);
    return !!c && c.status === 'ready' && c.access?.state !== 'unavailable';
  };
  const hostState = id => (health?.hosts || []).find(h => h.id === id) || null;

  const list = (profile.hosts || []).map(h => {
    const info = hostState(h.id), review = reviews[h.id] || null;
    return {
      id: h.id,
      label: info?.label || h.label || h.id,
      connected: usable(h.id),
      verified: info?.state === 'verified',
      verificationStale: info?.state === 'stale',
      verifiedAt: info?.verifiedAt || null,
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
    if (c.connected && !c.verified && !health?.skippedAt)
      attention.push({ kind: c.verificationStale ? 'verification_stale' : 'verification_pending', host: c.id, label: c.label });
    const why = REVIEW_ATTENTION[c.review];
    if (why) attention.push({ kind: why, host: c.id, label: c.label, detail: c.reviewReason });
  }
  for (const r of connector.requests || []) attention.push({ kind: 'authorization_waiting', host: r.host, detail: r.name });

  const roles = profile.vault ? await require('./roles.cjs').resolve(profile.vault).catch(() => ({ roles: {} })) : { roles: {} };
  const openLoops = openItems(await activeBody(profile.vault, roles.roles?.panel, language));
  const reminders = openItems(await activeBody(profile.vault, roles.roles?.reminders, language));

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
    updatedAt: now,
  };
}

/** Everything that is different, and nothing that is not. */
function diff(before, after) {
  if (!before) return [];
  const events = [];
  const at = after.updatedAt;
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

module.exports = { derive, diff, persist, recent, openItems, SETUP, REVIEW_ATTENTION };
