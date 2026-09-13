'use strict';
// Which note plays which part, resolved from the notes themselves.
//
// Everything used to be addressed by filename: "Claudian Home.md", "Claudian Universal
// Protocol.md". That made the memory brittle in two directions at once. The user could not
// rename a note into their own language without silently disconnecting it, and the product
// could not rename anything either -- so the vault kept a set of names that read like the
// product's internal vocabulary rather than the user's notes.
//
// A managed note declares `claudian_role` in its front matter. The role is the address; the
// filename is only what the user sees. Rename it, translate it, move it in the list -- it is
// still found. A vault written by an earlier version declares nothing, so the known older
// names are accepted as a fallback, once, and upgrading writes the role in.
const fs = require('node:fs/promises');
const path = require('node:path');

// Only the front matter is read, and only the first part of it: resolving roles must stay
// cheap enough to run at the start of every conversation.
const HEAD = 600;

// What each role was called before it had a name of its own. Order matters: the first file
// found wins, so the newest spelling is listed first.
const LEGACY = {
  entry: ['Claudian Home.md', '00 - Hub.md', 'CLAUDIAN.md'],
  start: ['Start Here.md', 'Buradan Başla.md'],
  protocol: ['Vault Protocol.md', 'Vault Protokolü.md', 'Claudian Universal Protocol.md', 'Claudian Memory Protocol.md'],
  panel: ['Control Panel.md', 'Kontrol Paneli.md'],
  reminders: ['Reminders.md', 'Hatırlatıcılar.md'],
  agreements: ['Working Agreements.md', 'Çalışma Anlaşmaları.md', 'Claudian Working agreements.md'],
  decisions: ['Decisions.md', 'Kararlar.md', 'Claudian Decisions.md'],
  about: ['About Me.md', 'Hakkımda.md', 'Claudian About me.md'],
  projects: ['Projects.md', 'Projeler.md', 'Claudian Projects.md'],
  lessons: ['Lessons.md', 'Öğrenilenler.md', 'Claudian Lessons.md'],
  system: ['System.md', 'Sistem.md'],
  graph: ['Graph View.md'],
  tools: ['Connected Tools.md', 'Bağlı Araçlar.md'],
  guide: ['Record Guide.md', 'Kayıt Rehberi.md', 'Claudian Record Guide.md'],
  claudian: ['Claudian.md'],
};

const declared = async file => {
  let handle;
  try { handle = await fs.open(file, 'r'); } catch { return null; }
  try {
    const {buffer, bytesRead} = await handle.read(Buffer.alloc(HEAD), 0, HEAD, 0);
    const head = buffer.slice(0, bytesRead).toString('utf8');
    if (!head.startsWith('---')) return null;
    const end = head.indexOf('\n---', 3);
    const block = end === -1 ? head : head.slice(0, end);
    const match = /^claudian_role:\s*([A-Za-z][\w:-]*)\s*$/m.exec(block);
    return match ? match[1] : null;
  } catch { return null; }
  finally { await handle.close().catch(() => {}); }
};

/**
 * @param {string} vault
 * @returns {Promise<{roles: Record<string,string>, adapters: Record<string,string>}>}
 *   roles maps a role to a file name inside the vault; adapters maps a host id to its note.
 */
async function resolve(vault) {
  const roles = {}, adapters = {};
  let entries = [];
  try { entries = await require('./memory-store.cjs').list(vault); }
  catch (error) { if (['ENOENT', 'EPERM', 'EACCES', 'ENOTDIR'].includes(error.code)) return {roles, adapters}; throw error; }
  // Role notes may live in any ordinary subfolder. Use the same protected-path
  // boundary as read/search, so moving a note does not disconnect its role.
  const files = entries.map(e => e.note);

  for (const name of files) {
    const role = await declared(path.join(vault, name));
    if (!role) continue;
    if (role.startsWith('adapter:')) { adapters[role.slice('adapter:'.length)] ??= name; continue; }
    // A duplicated role is a real condition -- two entry maps is the failure this addresses.
    // The first one alphabetically wins so the choice is at least stable between sessions.
    roles[role] ??= name;
  }

  // A vault from an earlier version declares nothing. Accept what it was called then, so a
  // memory that already exists is not treated as empty.
  const present = new Set(files);
  for (const [role, names] of Object.entries(LEGACY)) {
    if (roles[role]) continue;
    const found = names.find(name => present.has(name));
    if (found) roles[role] = found;
  }
  // An entry map is named after its owner, so it cannot be listed by name. The "00 -" prefix
  // is what keeps it first in an alphabetical folder, and it is the one convention worth
  // recognising by shape rather than by spelling.
  if (!roles.entry) {
    const numbered = files.filter(name => /^00\s*[-–—]\s*.+\.md$/.test(name)).sort();
    if (numbered.length) roles.entry = numbered[0];
  }
  return {roles, adapters};
}

/** The reading order a session entry follows, as file names that actually exist. */
async function entryOrder(vault) {
  const {roles} = await resolve(vault);
  return ['entry', 'agreements', 'decisions', 'panel', 'reminders'].map(role => roles[role]).filter(Boolean);
}

module.exports = {resolve, entryOrder, LEGACY, ROLE_NAMES: Object.keys(LEGACY)};
