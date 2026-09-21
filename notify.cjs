'use strict';
/**
 * Notifications — few, deterministic, and only for things the person can act on.
 *
 * ── What this is not ─────────────────────────────────────────
 *
 * It is not a model deciding that something feels important, and it is not a level being
 * announced on a timer. A toast here is caused by a state transition the application derived
 * from its own files (see state.cjs), and by nothing else.
 *
 * ── The three rules ──────────────────────────────────────────
 *
 *   allowed    only a short, closed list of kinds may interrupt. Everything else is a line in
 *              the panel, which is where most things belong.
 *   cooldown   the same worry does not arrive twice in a day. The key is the kind plus the
 *              connection it is about, so two different connections failing are two notices
 *              and one connection failing twice is one.
 *   budget     a small daily ceiling. A notifier that can fire twenty times has already
 *              taught the person to ignore it, which costs more than it ever delivered.
 *
 * Resolution is silent on purpose. "Your connection came back" is good news that interrupts
 * for nothing; the tray and the panel show it without a toast.
 */
const fs = require('node:fs/promises');
const path = require('node:path');

/** Only these interrupt. Adding to this list is a product decision, not a detail. */
const ALLOWED = {
  authorization_waiting: { urgency: 'critical' },
  connection_broken: {},
  connector_offline: {},
  reminder_overdue: {},
  reminder_due: {},
};

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_BUDGET = 3;

const text = (kind, label, language) => {
  const tr = language === 'tr';
  const who = label ? label + ' — ' : '';
  return {
    authorization_waiting: tr ? who + 'bir uygulama Claudian erişimi istiyor' : who + 'an application is asking for access to Claudian',
    connection_broken: tr ? who + 'bağlantı kontrol istiyor' : who + 'this connection needs attention',
    connector_offline: tr ? 'Bu cihaza AI hesaplarından ulaşılamıyor' : 'Your AI accounts cannot reach this device',
    reminder_overdue: tr ? 'Geçmiş tarihli: ' + (label || '') : 'Past due: ' + (label || ''),
    reminder_due: tr ? 'Bugün: ' + (label || '') : 'Today: ' + (label || ''),
  }[kind] || null;
};

const file = dataDir => path.join(dataDir, 'notified.json');

async function ledger(dataDir) {
  try { return JSON.parse(await fs.readFile(file(dataDir), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { sent: {}, day: null, count: 0 }; throw error; }
}

async function save(dataDir, value) {
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = file(dataDir) + '.' + require('node:crypto').randomUUID() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value), { flag: 'wx' });
  await fs.rename(tmp, file(dataDir));
}

/**
 * Decides what should be shown, and records that it was. Pure decision plus one small write;
 * the caller does the showing, so this stays testable without a desktop.
 *
 * @param {string} dataDir
 * @param {Array} events      transitions from state.diff()
 * @param {object} options    {language, now, enabled}
 * @returns {Promise<Array<{kind,label,host,body,urgency}>>}
 */
async function decide(dataDir, events, { language = 'en', now = Date.now(), enabled = true } = {}) {
  if (!enabled) return [];
  const raised = (events || []).filter(e => e.kind === 'attention_raised' && ALLOWED[e.attention]);
  if (!raised.length) return [];

  const book = await ledger(dataDir);
  const today = new Date(now).toISOString().slice(0, 10);
  if (book.day !== today) { book.day = today; book.count = 0; }

  const out = [];
  for (const event of raised) {
    if (book.count >= DAILY_BUDGET) break;
    const id = [event.attention, event.host || '', event.label || ''].join('|');
    const last = book.sent[id];
    if (last && now - Date.parse(last) < COOLDOWN_MS) continue;
    const body = text(event.attention, event.label, language);
    if (!body) continue;
    book.sent[id] = new Date(now).toISOString();
    book.count += 1;
    out.push({ kind: event.attention, host: event.host || null, label: event.label || null, body, urgency: ALLOWED[event.attention].urgency || 'normal' });
  }

  // Keep the ledger from growing forever: a record older than a week can no longer suppress
  // anything, because the cooldown is a day.
  const cutoff = now - 7 * COOLDOWN_MS;
  for (const [id, at] of Object.entries(book.sent)) if (Date.parse(at) < cutoff) delete book.sent[id];

  // Only a decision to notify is worth a write. A day that rolled over without anything being
  // raised did not spend any budget, and the roll-over above happens again the next time one
  // is -- so the window is always right at the moment it is used.
  if (out.length) await save(dataDir, book);
  return out;
}

module.exports = { decide, ALLOWED, COOLDOWN_MS, DAILY_BUDGET, text };
