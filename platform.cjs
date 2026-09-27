'use strict';
/* Where things live on each operating system (macOS support, 0.31.0).

   Claudian was written on Windows and several paths were spelled out as AppData/…; on a Mac
   the same folders are under ~/Library/Application Support and applications are bundles in
   /Applications. Every such path goes through this module so a new path cannot quietly be
   Windows-only again. Hook commands differ too: Windows hosts run PowerShell, macOS hosts a
   POSIX shell. */
const os = require('node:os');
const path = require('node:path');

const platform = () => process.env.CLAUDIAN_PLATFORM || process.platform;
const isMac = () => platform() === 'darwin';
const isWindows = () => platform() === 'win32';

/** Per-user application data (roaming on Windows). */
function appData(home = os.homedir()) {
  if (isWindows()) return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (isMac()) return path.join(home, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
}

/** Machine-local application data (LocalAppData on Windows; the same folder elsewhere). */
function localData(home = os.homedir()) {
  if (isWindows()) return process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return appData(home);
}

/** Obsidian's own list of vaults. */
const obsidianConfig = home => isWindows() ? path.join(home, 'AppData', 'Roaming', 'obsidian', 'obsidian.json')
  : path.join(appData(home), 'obsidian', 'obsidian.json');

/** Candidate install locations of a desktop application, most likely first. */
function appCandidates(id, home = os.homedir()) {
  if (isMac()) {
    const bundle = {'claude-code': 'Claude', 'claude-desktop': 'Claude', chatgpt: 'ChatGPT', cursor: 'Cursor',
      antigravity: 'Antigravity', 'antigravity-cli': 'Antigravity', obsidian: 'Obsidian', codex: 'Codex'}[id];
    return bundle ? [path.join('/Applications', bundle + '.app'), path.join(home, 'Applications', bundle + '.app')] : [];
  }
  const local = localData(home);
  if (['claude-code', 'claude-desktop'].includes(id)) return [path.join(local, 'AnthropicClaude', 'claude.exe'), path.join(local, 'Programs', 'Claude', 'Claude.exe')];
  if (id === 'obsidian') return [path.join(local, 'Programs', 'Obsidian', 'Obsidian.exe')];
  const rel = {antigravity: 'antigravity/Antigravity.exe', 'antigravity-cli': 'antigravity/Antigravity.exe', cursor: 'cursor/Cursor.exe'}[id];
  return rel ? [path.join(local, 'Programs', rel)] : [];
}

/** Home-relative folders whose presence means an application's configuration exists. */
function detectPaths(id) {
  const mac = {'claude-desktop': ['Library/Application Support/Claude'], chatgpt: ['Library/Application Support/com.openai.chat', 'Library/Application Support/ChatGPT']};
  const win = {'claude-desktop': ['AppData/Roaming/Claude'], chatgpt: ['AppData/Roaming/ChatGPT', 'AppData/Local/Programs/ChatGPT']};
  return (isMac() ? mac : win)[id];
}

module.exports = {platform, isMac, isWindows, appData, localData, obsidianConfig, appCandidates, detectPaths};
