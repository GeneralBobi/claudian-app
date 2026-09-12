'use strict';
/**
 * MCP sunucusunun giriş noktası.
 *
 * Bir AI uygulaması bunu stdio üzerinden başlatır. Electron'un kendisi olarak değil, düz
 * Node olarak koşar (`ELECTRON_RUN_AS_NODE=1`): pencere açmaz, ve stdout yalnız protokole
 * kalır -- Electron'un kendi çıktısı protokolü kirletirdi.
 *
 * Kurulumun yazdığı yapılandırma şuna benzer:
 *
 *   "claudian": {
 *     "command": "…/Claudian.exe",
 *     "args": ["…/resources/app.asar/mcp-server.cjs"],
 *     "env": { "ELECTRON_RUN_AS_NODE": "1" }
 *   }
 *
 * Vault ve kapsam profilden okunur; burada bir yol ya da izin tahmin edilmez.
 */
const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.CLAUDIAN_DATA
  || path.join(process.env.APPDATA || path.join(require('node:os').homedir(), 'AppData', 'Roaming'), 'Claudian Desktop');

let profile = null;
try { profile = JSON.parse(fs.readFileSync(path.join(dataDir, 'profile.json'), 'utf8')); }
catch { /* aşağıda söylenir */ }

if (!profile?.vault) {
  process.stderr.write('[claudian-mcp] Hafıza kurulu değil. Claudian uygulamasını açıp kurulumu tamamlayın.\n');
  process.exit(1);
}

// Kapsam kullanıcının seçtiği şey. Profilde yoksa okuma: verilmemiş bir yetkiyi
// varsaymaktansa az verip kullanıcının açmasını beklemek doğru taraf.
const access = profile.access === 'write' ? 'write' : 'read';
const actor=process.env.CLAUDIAN_HOST || 'claude-desktop';
function authorize(scope){
  let current;
  try{current=JSON.parse(fs.readFileSync(path.join(dataDir,'profile.json'),'utf8'));}
  catch{throw Error('Claudian profile is unavailable. Reconnect through the application.');}
  if(current.vault!==profile.vault)throw Error('The selected vault changed. Restart this connection before continuing.');
  if(!current.hosts?.some(host=>host.id===actor))throw Error('This connection has been removed.');
  if(scope==='write'&&current.access!=='write')throw Error('Write permission has been revoked.');
}

require('./mcp.cjs').serve({
  vault: profile.vault,
  access,
  dataDir,
  actor,
  authorize,
  language: profile.language,
  version: profile.appVersion || '0',
  notice: () => require('./notice.cjs').look({
    vault: profile.vault,
    ledgerFile: path.join(dataDir, 'noticed.json'),
  }),
});
