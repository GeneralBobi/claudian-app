'use strict';
/* Yüzük denetimi (27.09.2026): an AI can ask Claudian whether the note-taking engine's privacy rules are the
   published ones and whether any audio is sitting on disk. The rules live in the engine's code, not in a note the
   user (or anyone) can edit; the engine reports a hash of the rule files, and the publisher signs that hash with the
   release key. This module fetches the engine's content-free report and checks the signature against the public
   key built into the app. It never returns note text or audio. */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PUBLISHER_KEY = crypto.createPublicKey(['-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAAtmuynvkifcOpWzfKwuL/2vmW9CkiXcIRCZMhmtmLrE=', '-----END PUBLIC KEY-----', ''].join('\n'));
const PORT = 3050;

function verdict(report) {
  const m = report?.mahremiyet || {};
  const sig = m.imza;
  if (!sig) return {signed: false, reason: 'The engine has no signed rule manifest (kural-imzasi.json); the rules cannot be matched to a published version.'};
  if (sig.kural_ozeti !== m.kural_ozeti || sig.surum !== m.surum)
    return {signed: false, reason: 'The running rule files differ from the signed version: someone changed them after publication.'};
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(`yuzuk-kurallar:${sig.surum}:${sig.kural_ozeti}`, 'utf8'), PUBLISHER_KEY, Buffer.from(sig.imza, 'base64')); } catch {}
  return ok ? {signed: true, reason: `Rules match the published, signed version ${sig.surum}.`}
    : {signed: false, reason: 'The rule manifest signature is not the publisher\'s.'};
}

async function audit(dataDir, fetchImpl = fetch) {
  let engine;
  try { engine = JSON.parse(await fs.readFile(path.join(dataDir, 'ring.json'), 'utf8')).engine; } catch {}
  engine = engine || path.join(require('node:os').homedir(), 'Desktop', 'Yuzuk', 'laya-kapi');
  let key;
  try { key = (await fs.readFile(path.join(engine, 'sunucu_anahtar.txt'), 'utf8')).trim(); }
  catch { return {available: false, reason: 'Yüzük engine is not installed on this computer.'}; }
  let report;
  try {
    const r = await fetchImpl(`http://127.0.0.1:${PORT}/v1/denetim`, {headers: {authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(4000)});
    if (!r.ok) return {available: false, reason: `Yüzük engine answered ${r.status}.`};
    report = await r.json();
  } catch { return {available: false, reason: 'Yüzük engine is not running.'}; }
  return {available: true, rules: verdict(report), report};
}

module.exports = {audit, verdict};
