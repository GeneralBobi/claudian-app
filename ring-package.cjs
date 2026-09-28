'use strict';

/*
  "Kurulum paketini hazırla" (1.5.0 · 28.09.2026). Boran: "Başka bir bilgisayara kur dediğimde ve klasör seçtiğimde o
  kurulumun ilerlemesini istiyorum."

  Before 1.5.0 this copied the engine folder without its Python environment: on the other computer the copy could not
  run and nothing told the user what to do next (Hanne's 0.30.0). Now the chosen folder gets a self-contained
  "Yuzuk-kurulum" folder:

    Claudian-Setup-<v>.exe, yuzuk-motor-<v>.zip, SHA256SUMS-<v>.txt(.sig)   the publisher's signed release
    modeller/…, araclar/uv.zip, araclar/cloudflared.exe                     the pinned downloads (~1.7 GB)

  On the other computer: run Claudian-Setup, then in Yüzük choose "Klasörden kur" and pick this folder. The installer
  takes every file whose SHA-256 matches (ring-install.cjs, sourceIndex) and downloads only the rest; engine code is
  unpacked only from the signed package. Keys, voiceprints, the cloud link and the vault never enter the package.
*/

const fs = require('fs/promises');
const path = require('path');
const {downloadFile, sourceIndex, WHISPER, SPEAKER, UV, CLOUDFLARED, RELEASES} = require('./ring-install.cjs');
const {githubUrl, signedSums} = require('./release-key.cjs');

const RELEASE_FILES = [/^Claudian-Setup-[0-9.]+\.exe$/, /^yuzuk-motor-[0-9.]+\.zip$/, /^SHA256SUMS-[0-9.]+\.txt$/, /^SHA256SUMS-[0-9.]+\.txt\.sig$/];
const LAYOUT = [
  ...WHISPER.map(item => ({item, rel: path.join('modeller', 'whisper-large-v3-turbo', item.file)})),
  {item: SPEAKER, rel: path.join('modeller', 'konusmaci', SPEAKER.file)},
  {item: UV, rel: path.join('araclar', UV.file)},
  {item: CLOUDFLARED, rel: path.join('araclar', CLOUDFLARED.file)},
];

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function release(fetch, version, signal) {
  // Tests and acceptance: a local folder standing in for the GitHub release (same signature check).
  const local = process.env.CLAUDIAN_ENGINE_RELEASE_DIR;
  if (local) {
    const names = await fs.readdir(local);
    const assets = names.map(name => ({name, size: null, browser_download_url: `https://github.com/local/${encodeURIComponent(name)}`, local: path.join(local, name)}));
    const read = async url => {
      const bytes = await fs.readFile(path.join(local, decodeURIComponent(new URL(url).pathname.split('/').pop())));
      return {ok: true, arrayBuffer: async () => bytes, text: async () => bytes.toString('utf8')};
    };
    return {assets, sums: await signedSums({assets}, read)};
  }
  let r = await fetch(`${RELEASES}/tags/v${version}`, {headers: {Accept: 'application/vnd.github+json'}, signal});
  if (r.status === 404) r = await fetch(`${RELEASES}/latest`, {headers: {Accept: 'application/vnd.github+json'}, signal});
  if (!r.ok) throw Error('Sürüm bilgisi alınamadı (GitHub). İnternet bağlantısını kontrol edip tekrar dene.');
  const rel = await r.json();
  return {assets: rel.assets || [], sums: await signedSums(rel, fetch)};
}

/** Writes <folder>/Yuzuk-kurulum. Resumable: a second run continues where the first stopped. */
async function writePackage({folder, version, fetch, engineDir, send = () => {}, signal}) {
  const dest = path.join(folder, 'Yuzuk-kurulum');
  await fs.mkdir(dest, {recursive: true});
  const emit = extra => send('ring:event', {olay: 'paket', durum: 'suruyor', ...extra});
  const {assets, sums} = await release(fetch, version, signal);
  const wanted = assets.filter(a => RELEASE_FILES.some(re => re.test(String(a.name || ''))));
  if (!wanted.some(a => /\.zip$/.test(a.name)) || !wanted.some(a => /\.exe$/.test(a.name))) throw Error('Bu sürümde kurulum dosyası ya da motor paketi yok.');
  for (const a of wanted) {
    const file = path.join(dest, a.name);
    const sha = sums.get(a.name) || null; // the checksum list and its signature are checked again when installing
    if (!sha && !/^SHA256SUMS-/.test(a.name)) throw Error(`${a.name} imzalı sağlama listesinde yok.`);
    emit({dosya: a.name});
    if (a.local) { if (!await exists(file)) await fs.copyFile(a.local, file); continue; }
    await downloadFile(fetch, githubUrl(a).href, file, {size: a.size || undefined, sha256: sha || undefined, signal,
      onBytes: (n, total) => emit({dosya: a.name, indirilen: n, toplam: total})});
  }
  const here = engineDir ? await sourceIndex(engineDir) : null;
  for (const {item, rel} of LAYOUT) {
    const file = path.join(dest, rel);
    await fs.mkdir(path.dirname(file), {recursive: true});
    const from = here?.has(item);
    emit({dosya: item.file, kaynaktan: !!from});
    if (from && !await exists(file)) { await fs.copyFile(from, file + '.part'); await fs.rename(file + '.part', file); }
    await downloadFile(fetch, item.url, file, {size: item.size, sha256: item.sha256, signal,
      onBytes: (n, total) => emit({dosya: item.file, indirilen: n, toplam: total})});
  }
  await fs.writeFile(path.join(dest, 'paket.json'), JSON.stringify({surum: version, olusturuldu: new Date().toISOString()}, null, 1));
  let size = 0;
  for (const name of [...wanted.map(a => a.name), ...LAYOUT.map(l => l.rel)]) size += (await fs.stat(path.join(dest, name))).size;
  send('ring:event', {olay: 'paket', durum: 'bitti', hedef: dest, boyut: size});
  return {target: dest, size};
}

module.exports = {writePackage, LAYOUT};
