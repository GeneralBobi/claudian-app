'use strict';
// Local connector implementation. Scope and ownership are checked before changes.


const readline = require('node:readline');

const PROTOCOL = '2024-11-05';
const log = message => process.stderr.write(`[claudian-mcp] ${message}\n`);

const text = value => ({ content: [{ type: 'text', text: value }] });

/** Tek bir isteği karşılar. Protokol hatası ile yetenek hatası ayrı şeylerdir. */
async function handle(message, tools, info) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: {
      protocolVersion: info.supportedProtocols
        ? (info.supportedProtocols.includes(params?.protocolVersion)?params.protocolVersion:info.supportedProtocols[0])
        : PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: 'claudian', version: info.version },
      instructions: require('./memory-runtime.cjs').instructionsFor(info.language),
    } };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: {
      tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
    } };
  }
  if (method === 'tools/call') {
    const tool = tools.find(t => t.name === params?.name);
    if (!tool) {
      // Kapsam dışı bir ad da buraya düşer: liste onu hiç göstermediği için bu bir
      // "verilmemiş yetenek" durumudur ve öyle söylenir.
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Bu bağlantıda "${params?.name}" diye bir yetenek yok.` } };
    }
    try {
      if(info.authorize)await info.authorize(tool.scope);
      return { jsonrpc: '2.0', id, result: await tool.run(params?.arguments || {}) };
    } catch (error) {
      // Yetenek hatası protokol hatası değildir: istemci bağlantıyı düşürmesin, model
      // ne olduğunu okusun.
      return { jsonrpc: '2.0', id, result: { ...text(`Yapılamadı: ${error.message}`), isError: true } };
    }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

/**
 * stdio üzerinde satır-ayrımlı JSON-RPC konuşur.
 *
 * @param {object} input
 * @param {string} input.vault
 * @param {'read'|'write'} input.access  kullanıcının seçtiği kapsam
 * @param {function} input.notice        fark etme katmanını çağıran fonksiyon
 * @param {string} input.version
 */
function serve({ vault, access = 'read', notice, version = '0', dataDir, actor, language, authorize }) {
  const all = capabilities(vault, notice, {access,dataDir,actor,language});
  const tools = all.filter(t => t.scope === 'read' || access === 'write');
  log(`vault: ${vault}`);
  log(`kapsam: ${access} · ${tools.length}/${all.length} yetenek açık — ${tools.map(t => t.name).join(', ')}`);

  // Uçuştaki çağrılar sayılır. stdin kapandığında hemen çıkmak, cevabı hazırlanmakta olan
  // bir isteği ortadan keser. Gerçek bir stdio denemesinde tam olarak bu oldu: initialize
  // cevaplandı, sonraki iki çağrı sessizce kayboldu. İstemci beklerken sessizce ölen bir
  // sunucu, bu ürünün kapatmaya çalıştığı sessiz başarısızlığın ta kendisi.
  let pending = 0, ended = false;
  const settle = () => { if (ended && pending === 0) process.exit(0); };

  const reader = readline.createInterface({ input: process.stdin });
  reader.on('line', async line => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch { return log('ayrıştırılamayan satır atlandı'); }
    // Bildirimlerin (id taşımayan) cevabı olmaz.
    if (message.id === undefined) return;
    pending++;
    try {
      const reply = await handle(message, tools, { version, authorize, language });
      // Yazmanin bitmesi beklenir. Bir borunun ucundaki stdout tamponludur ve
      // process.exit tamponu bosaltmaz; beklenmezse son cevap yarida kalabilir.
      await new Promise(done => process.stdout.write(JSON.stringify(reply) + '\n', done));
    } finally {
      pending--;
      settle();
    }
  });
  reader.on('close', () => { ended = true; settle(); });
}

const {capabilities} = require('./memory-capabilities.cjs');
module.exports = { serve, capabilities, handle, inside:require('./memory-store.cjs').inside, PROTOCOL };
