'use strict';
// Does the connection this application installed actually work?
//
// Until now the only answer was a chore handed back to the user: open your AI, paste an
// instruction, come back. That proves the most, and it is also the reason most installations
// were never proven at all -- and a connection that quietly stopped working looked exactly
// like one nobody had checked yet.
//
// Three of the four layers can be checked here, with no AI open and nothing for the user to
// do. What cannot be checked here is the fourth: whether the model chooses to use any of it.
//
//   files       the skill, rule and configuration are on disk and unmodified   → connections()
//   access      the folder is inside the host's own permission list            → connections()
//   server      the exact command the host will run starts and answers         → this file
//   behaviour   the model reads and writes during a real conversation          → challenge()
//
// The server check runs the configured command verbatim -- same executable, same arguments,
// same environment. A probe that takes a shortcut proves the shortcut, not the product.
const {spawn} = require('node:child_process');

const TIMEOUT = 15000;

/**
 * Speaks JSON-RPC to a freshly spawned server over stdio, exactly as a host would.
 * @returns {Promise<{ok: boolean, tools?: string[], detail?: string}>}
 */
function ask(entry, requests) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(entry.command, entry.args || [], {
        env: {...process.env, ...(entry.env || {})},
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) { return resolve({ok: false, detail: error.message}); }

    const replies = new Map();
    let buffer = '', stderr = '', done = false;
    const finish = result => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* already gone */ } resolve(result); };
    const timer = setTimeout(() => finish({ok: false, detail: 'timeout'}), TIMEOUT);

    child.on('error', error => finish({ok: false, detail: error.message}));
    // A server that dies before answering is the failure this probe exists to catch, so its
    // own words are carried out rather than replaced with a generic message.
    child.on('exit', code => finish({ok: false, detail: (stderr.trim().split('\n').pop() || '').slice(0, 200) || 'exit ' + code}));
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== undefined) replies.set(message.id, message);
      }
      if (requests.every(r => replies.has(r.id))) finish({ok: true, replies});
    });

    for (const request of requests) child.stdin.write(JSON.stringify(request) + '\n');
  });
}

/**
 * @param {{command: string, args?: string[], env?: object}} entry the host's own configuration
 * @param {string} host which connection this is, so the server applies that host's scope
 */
async function server(entry, host) {
  if (!entry?.command) return {state: 'unknown', detail: 'no local server is configured for this connection'};
  const requests = [
    {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'claudian-self-check', version: '1'}}},
    {jsonrpc: '2.0', id: 2, method: 'tools/list'},
    // A real call, not just a listing: a server can advertise capabilities it cannot perform.
    {jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'list_notes', arguments: {}}},
  ];
  const outcome = await ask({...entry, env: {...(entry.env || {}), CLAUDIAN_HOST: host || entry.env?.CLAUDIAN_HOST}}, requests);
  if (!outcome.ok) return {state: 'broken', detail: outcome.detail};

  const initialize = outcome.replies.get(1), list = outcome.replies.get(2), call = outcome.replies.get(3);
  if (initialize?.error) return {state: 'broken', detail: initialize.error.message};
  if (!initialize?.result?.serverInfo?.name) return {state: 'broken', detail: 'the server did not introduce itself'};
  if (list?.error) return {state: 'broken', detail: list.error.message};
  const tools = (list?.result?.tools || []).map(t => t.name);
  if (!tools.length) return {state: 'broken', detail: 'the server offers no capabilities'};
  // list_notes is a read operation. Even a read-only installation must be able to
  // perform it. MCP tool failures are usually result.isError, not JSON-RPC errors.
  if (call?.error) return {state: 'broken', detail: call.error.message || 'the vault read was refused'};
  if (!call?.result || call.result.isError) {
    const detail = (call?.result?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    return {state: 'broken', detail: detail.slice(0, 200) || 'the vault read failed'};
  }
  return {state: 'ready', tools, detail: null};
}

module.exports = {server, ask, TIMEOUT};
