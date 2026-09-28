'use strict';
/* Release identity (security report 0.29.0, finding 3). Every release carries SHA256SUMS-<version>.txt and its Ed25519
   signature (.sig), made with a key that never leaves the publisher's computer (scripts/surum-imzala.mjs). The public
   half is built into the app. The app update and, since 1.1.0, the Yüzük engine package are both checked against it:
   a file that is not listed in a validly signed checksum file is not run and not unpacked. */
const crypto = require('crypto');

const RELEASE_KEY = crypto.createPublicKey(['-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAAtmuynvkifcOpWzfKwuL/2vmW9CkiXcIRCZMhmtmLrE=', '-----END PUBLIC KEY-----', ''].join('\n'));

const GITHUB_HOST = /(^|\.)github(usercontent)?\.com$/i;

function githubUrl(asset) {
  const u = new URL(String(asset?.browser_download_url || ''));
  if (u.protocol !== 'https:' || !GITHUB_HOST.test(u.hostname)) throw Error('Unexpected download location; nothing was run.');
  return u;
}

/** Downloads a release's checksum file and signature, verifies the signature, and returns {name → sha256}. */
async function signedSums(release, fetch) {
  const assets = release.assets || [];
  const sums = assets.find(a => /^SHA256(?:SUMS)?[-0-9.]*\.txt$/i.test(String(a.name || '')));
  if (!sums) throw Error('This release publishes no checksum.');
  const sig = assets.find(a => String(a.name || '') === `${sums.name}.sig`);
  if (!sig) throw Error('This release is not signed by the Claudian publisher.');
  const [sumsResponse, sigResponse] = await Promise.all([
    fetch(githubUrl(sums).href, {signal: AbortSignal.timeout(30000)}),
    fetch(githubUrl(sig).href, {signal: AbortSignal.timeout(30000)})]);
  if (!sumsResponse.ok || !sigResponse.ok) throw Error('The release signature could not be downloaded.');
  const bytes = Buffer.from(await sumsResponse.arrayBuffer());
  const signature = Buffer.from((await sigResponse.text()).trim(), 'base64');
  if (signature.length !== 64 || !crypto.verify(null, bytes, RELEASE_KEY, signature)) throw Error('The release signature is not valid.');
  const map = new Map();
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && /^[0-9a-f]{64}$/i.test(parts[0])) map.set(parts[parts.length - 1].replace(/^\*/, ''), parts[0].toLowerCase());
  }
  return map;
}

module.exports = {RELEASE_KEY, githubUrl, signedSums};
