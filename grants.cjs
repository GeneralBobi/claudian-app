'use strict';
// Host permission grants.
//
// Measured 11.09.2026: installing the skill and the startup rule is not enough.
// The host reaches the vault, is refused by its own permission layer, and the
// model drops the attempt silently. The user then believes memory is working.
// The installer therefore has to grant read/write on the selected vault the same
// way the host itself would record an approved prompt.
const path = require('node:path');

// Claude Code records absolute allow-rules as //<drive>/<posix path>.
const rulePath = vault => {
  const resolved = path.resolve(vault).split(String.fromCharCode(92)).join('/');
  const drive = /^([A-Za-z]):\//.exec(resolved);
  return drive ? `//${drive[1].toLowerCase()}/${resolved.slice(3)}` : resolved;
};

// Kapsam kullanicinin sectigi sey.
//
// 12.09.2026'ya kadar burasi kosulsuz Read+Edit+Write veriyordu ve kullaniciya hicbir sey
// sorulmuyordu -- oysa web tarafindaki onay ekrani okuma ile yazmayi ayri ayri soruyor.
// Kullaniciya "yalniz okuma" deyip arka planda yazma izni birakmak, onay ekranini bir sus
// perdesine cevirir; o yuzden secim burada gercek bir sinir.
const entries = (vault, access = 'write') => {
  const target = `${rulePath(vault)}/**`;
  const read = `Read(${target})`;
  return access === 'read' ? [read] : [read, `Edit(${target})`, `Write(${target})`];
};

// Returns the settings text that grants access, or null when nothing is missing.
function grant(previous, vault, access = 'write') {
  let config = {};
  if (previous !== null && previous.trim()) {
    try { config = JSON.parse(previous); }
    catch { throw new Error('Claude Code settings.json okunamadı; dosya korundu. Geçerli JSON olduğunu doğrulayın.'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Claude Code settings.json beklenen biçimde değil; dosya korundu.');
  }
  const permissions = config.permissions && typeof config.permissions === 'object' && !Array.isArray(config.permissions) ? config.permissions : {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const missing = entries(vault, access).filter(e => !allow.includes(e));
  if (!missing.length) return null;
  const next = { ...config, permissions: { ...permissions, allow: [...allow, ...missing] } };
  return JSON.stringify(next, null, 2) + '\n';
}

// Removes only the entries this installation added; unrelated rules survive.
function revoke(previous, vault) {
  let config;
  try { config = JSON.parse(previous); } catch { return null; }
  if (!config?.permissions || !Array.isArray(config.permissions.allow)) return null;
  // Kapsam ne olursa olsun ustkume temizlenir: bir baglanti once yazma kapsamiyla
  // kurulup sonra daraltilmis olabilir ve geride kalan Write kurali sessizce yasar.
  const ours = new Set(entries(vault, 'write'));
  const allow = config.permissions.allow.filter(e => !ours.has(e));
  if (allow.length === config.permissions.allow.length) return null;
  return JSON.stringify({ ...config, permissions: { ...config.permissions, allow } }, null, 2) + '\n';
}


// Per-host access adapters.
//
// Verified 11.09.2026 on this machine, from each host's own configuration surface:
//  claude-code  settings.json permissions.allow - proven in a live session
//  codex        config.toml [sandbox_workspace_write] writable_roots - the binary's own
//               help states workspace-write "permits reading files, and editing files in
//               cwd and writable_roots", so reads already work and writes need the root
//  gemini-cli   settings.json context.includeDirectories - declared in the settings schema
//               and consumed as an allowed path by the sandbox
// Cursor and the two Antigravity surfaces are NOT verified here. They get an explicit
// manual step instead of a guessed file write: an unverified grant that silently does
// nothing is worse than a named gap the user can close in one action.
const MANUAL = {
  cursor: vault => `Cursor: add ${vault} to the agent workspace (Settings > Agent).`,
  antigravity: vault => `Antigravity: grant workspace access to ${vault}.`,
  'antigravity-cli': vault => `Antigravity CLI: add ${vault} to the context directories.`,
};

function geminiGrant(previous, vault) {
  let config = {};
  if (previous !== null && previous.trim()) {
    try { config = JSON.parse(previous); } catch { throw new Error('Gemini settings.json okunamadi; dosya korundu.'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Gemini settings.json beklenen bicimde degil; dosya korundu.');
  }
  const context = config.context && typeof config.context === 'object' && !Array.isArray(config.context) ? config.context : {};
  const current = Array.isArray(context.includeDirectories) ? context.includeDirectories : [];
  const target = path.resolve(vault);
  if (current.some(d => typeof d === 'string' && path.resolve(d) === target)) return null;
  return JSON.stringify({ ...config, context: { ...context, includeDirectories: [...current, target] } }, null, 2) + '\n';
}

// TOML has no parser in the runtime. Appending a fresh section is safe; editing an existing
// one is not, so an existing section is reported as a manual step rather than rewritten.
// Codex izni kendi dosyasinda: sanal alan kipi olmadan writable_roots olu harftir ve
// bu bir kez olculdu. Ayrintili gerekce codex-grant.cjs basinda.
const { codexGrant } = require('./codex-grant.cjs');

const posix = value => path.resolve(value).split(String.fromCharCode(92)).join('/');

// Returns {host, file, content, previous} for a write, {host, satisfied} when nothing is
// missing, or {host, manual} for a step the user has to take.
async function planFor(host, home, vault, read, access = 'write', codexHome = path.join(home,'.codex')) {
  if (host === 'claude-code') {
    const file = module.exports.settingsFile(home);
    const previous = await read(file);
    const content = grant(previous, vault, access);
    return content ? { host, file, content, previous } : { host, satisfied: true };
  }
  if (host === 'gemini-cli') {
    const file = path.join(home, '.gemini', 'settings.json');
    const previous = await read(file);
    const content = geminiGrant(previous, vault);
    return content ? { host, file, content, previous } : { host, satisfied: true };
  }
  if (host === 'codex') {
    // Okuma kapsaminda Codex'in sanal alanina dokunulmaz. `sandbox_mode` yalnizca YAZMA
    // icin gerekli; kullanici okuma istedigi halde kipi workspace-write'a cekmek, tam da
    // duzeltmeye calistigimiz asiri izin davranisinin kendisi olurdu.
    if (access === 'read') return { host, satisfied: true };
    const file = path.join(codexHome, 'config.toml');
    const previous = await read(file);
    const result = codexGrant(previous, vault);
    if (result.satisfied) return { host, satisfied: true };
    if (result.manual) return { host, manual: result.manual };
    return { host, file, content: result.content, previous };
  }
  // MCP ile baglanan konaklarda not klasorunun yolu izin dosyasinda hic yazmaz: sunucu
  // onu profilden okur. Yani tasima sirasinda burada degisecek bir sey yoktur -- ve bu
  // dal olmadan tasima MANUAL tablosunda karsiligi olmayan bir konakta patliyordu.
  if (['claude-desktop', 'chatgpt'].includes(host)) return { host, satisfied: true };
  return { host, manual: MANUAL[host](vault) };
}


// Withdraws only what this installation added, for any host.
function revokeFor(host, previous, vault) {
  if (host === 'claude-code') return revoke(previous, vault);
  // Claude Desktop'in izni bir kural degil, bir sunucu girdisidir; geri alinmasi da
  // yalnizca o girdiyi silmek demek. Kullanicinin kendi MCP sunuculari korunur.
  if (host === 'claude-desktop') return require('./mcp-hosts.cjs').mcpRevoke(previous);
  if (host === 'gemini-cli') {
    let config; try { config = JSON.parse(previous); } catch { return null; }
    const current = config?.context?.includeDirectories;
    if (!Array.isArray(current)) return null;
    const target = path.resolve(vault);
    const kept = current.filter(d => typeof d !== 'string' || path.resolve(d) !== target);
    if (kept.length === current.length) return null;
    return JSON.stringify({ ...config, context: { ...config.context, includeDirectories: kept } }, null, 2) + '\n';
  }
  if (host === 'codex') {
    const marker = '# Claudian: the selected memory folder stays writable from any working directory.';
    if (!previous.includes(marker)) return null;
    const index = previous.indexOf(marker);
    const rest = previous.slice(index + marker.length);
    const after = rest.indexOf('\n[');
    const trimmed = previous.slice(0, index) + (after === -1 ? '' : rest.slice(after + 1));
    return trimmed.replace(/\n{3,}/g, '\n\n');
  }
  return null;
}

module.exports = { entries, grant, revoke, rulePath, geminiGrant, codexGrant, planFor, revokeFor, settingsFile: home => path.join(home, '.claude', 'settings.json') };
