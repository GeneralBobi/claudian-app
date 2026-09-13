'use strict';
// Local connector implementation. Scope and ownership are checked before changes.
const path = require('node:path');

const SERVER = 'claudian';

/** Istemcinin baslatacagi komut. Electron, pencere acmadan duz Node olarak kosar. */
function serverEntry({ exe, script, dataDir }) {
  return { command: exe, args: [script], env: { ELECTRON_RUN_AS_NODE: '1', CLAUDIAN_DATA: dataDir } };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Var olan yapilandirmaya Claudian sunucusunu ekler.
 * @returns {{content:string}|{satisfied:true}}
 */
function mcpGrant(previous, entry) {
  let config = {};
  if (previous !== null && previous.trim()) {
    try { config = JSON.parse(previous); }
    catch { throw new Error('Claude yapilandirmasi okunamadi; dosya korundu. Gecerli JSON oldugunu dogrulayin.'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Claude yapilandirmasi beklenen bicimde degil; dosya korundu.');
    }
  }
  const servers = config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
    ? config.mcpServers : {};
  if (same(servers[SERVER], entry)) return { satisfied: true };
  if (servers[SERVER]) throw new Error('A different claudian MCP connection already exists; its configuration was preserved. Reconcile the existing connection before installing.');
  // Kullanicinin kendi sunuculari korunur; yalnizca bizim adimiz yazilir.
  const next = { ...config, mcpServers: { ...servers, [SERVER]: entry } };
  return { content: JSON.stringify(next, null, 2) + '\n' };
}

/** Yalnizca bu kurulumun ekledigi sunucuyu geri alir. */
function mcpRevoke(previous, expected) {
  let config;
  try { config = JSON.parse(previous); } catch { return null; }
  if (!config?.mcpServers || !Object.hasOwn(config.mcpServers, SERVER)) return null;
  if(expected && !same(config.mcpServers[SERVER],expected))throw new Error('The Claudian server entry changed; review it before removing the connection.');
  const { [SERVER]: removed, ...kept } = config.mcpServers;
  return JSON.stringify({ ...config, mcpServers: kept }, null, 2) + '\n';
}

const configFile = home => path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');

/**
 * ChatGPT icin yapilacak adim.
 *
 * Olculdu: ChatGPT yerel surec baslatamaz, stdio secenegi yoktur; baglanti Gelistirici
 * Kipinde genel bir HTTPS ucu ister. Bu yuzden burada bir dosya yazilmaz.
 */
const chatgptStep = (url, language) => !url ? (language === 'tr'
  ? 'ChatGPT bağlantısı henüz kullanıma hazır değil. Kullanıcıya özel, izinli cihaz bağlantısını sağlayacak Claudian relay hizmeti gerekiyor. Bu kurulum ChatGPT hesabına bağlanmadı.'
  : 'The ChatGPT connection is not ready yet. It requires the Claudian relay service for an authorized connection to your device. This installation has not connected your ChatGPT account.') : language === 'tr'
  ? `ChatGPT yerel bir sunucuyu kendisi baslatamaz; baglanti yalnizca bir web adresinden kurulur. Claudian'i tunelden yayina alip ChatGPT > Ayarlar > Uygulamalar ve Baglantilar > Gelistirici Kipi icine ${url} adresini ekleyin. Kapsamlari orada onaylarsiniz.`
  : `ChatGPT cannot start a local server; it connects only over a web address. Publish Claudian through the tunnel, then add ${url} under ChatGPT > Settings > Apps & Connectors > Developer Mode. You approve the scopes there.`;

module.exports = { SERVER, serverEntry, mcpGrant, mcpRevoke, configFile, chatgptStep };
