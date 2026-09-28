'use strict';
/*
  Yüzük engine installer (1.1.0, madde 1): one button on a computer that has no engine.

  What it does, in order, and where:
  - Everything goes into one folder the user can write to: %LOCALAPPDATA%\Claudian\yuzuk-motor. Never Program Files,
    never the app's own install folder (an update or uninstall would wipe it), never a path that belongs to someone else.
  - The engine code comes from the public claudian-app release of this app's version (yuzuk-motor-<version>.zip). The
    source stays in a private repository; only the package is distributed. The package is unpacked only if it is listed in
    the release's checksum file and that file carries the publisher's Ed25519 signature, the same check app updates pass.
  - Python, the libraries, the Whisper model, the speaker model and cloudflared are downloaded from their publishers at
    versions and SHA-256 digests pinned below. Nothing is taken from the user's own Python or PATH.
  - Downloads resume: a partial file is kept as .part and continued with a Range request; a finished step is recorded
    in .kurulum.json and skipped on the next run. A file whose digest does not match is discarded, never used.
  - No NVIDIA card, or no working CUDA library: Whisper runs on the processor, and the installer says so after it has
    actually loaded the model, not before.
  - Finally the computer registers itself with the Claudian cloud as a processing node. It gets a new account and waits
    for approval (test phase); until then it cannot have notes written and its phones wait too. The user is told so.
*/
const fs = require('fs/promises');
const fss = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {spawn, execFile} = require('child_process');
const {Readable, Transform} = require('stream');
const {pipeline} = require('stream/promises');
const {signedSums, githubUrl} = require('./release-key.cjs');

const RELEASES = 'https://api.github.com/repos/GeneralBobi/claudian-app/releases';
const GB = 1024 ** 3;
// Free space asked for before anything is downloaded; measured on a clean install (1.1.0) with room for the download cache.
const NEED = {cpu: 3.5 * GB, gpu: 5 * GB};
const PORT = 3050;

// Pinned downloads. Digests are the publishers' own (uv: its .sha256 file; cloudflared: its release notes; models: the
// Hugging Face LFS pointer and the sherpa-onnx release asset), checked again here after each download.
const UV = {file: 'uv.zip', url: 'https://github.com/astral-sh/uv/releases/download/0.12.19/uv-x86_64-pc-windows-msvc.zip',
  size: 17955780, sha256: '6dbb02d79e419522f1c500f0adb1cddcff0cda7d59b0d66ea7f5e3b4a1b2f5f0'};
const CLOUDFLARED = {file: 'cloudflared.exe', url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-windows-amd64.exe',
  size: 55366080, sha256: 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2'};
const WHISPER_BASE = 'https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/resolve/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf/';
const WHISPER = [
  {file: 'config.json', size: 2263, sha256: 'b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e'},
  {file: 'preprocessor_config.json', size: 340, sha256: '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711'},
  {file: 'tokenizer.json', size: 2710337, sha256: '297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd'},
  {file: 'vocabulary.json', size: 1068114, sha256: 'c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1'},
  {file: 'model.bin', size: 1617884929, sha256: 'e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da'},
].map(f => ({...f, url: WHISPER_BASE + f.file}));
const SPEAKER = {file: '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  size: 28281164, sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2'};

const STEPS = ['motor', 'uv', 'python', 'kutuphane', 'whisper', 'konusmaci', 'tunel', 'dogrulama', 'kayit', 'servis'];
const KNOWN = [UV, CLOUDFLARED, SPEAKER, ...WHISPER];
const RELEASE_ZIP = /^yuzuk-motor-[0-9.]+\.zip$/;

/*
  A folder as a source (1.5.0 · 28.09.2026). Boran: "Başka bir bilgisayara kur dediğimde ve klasör seçtiğimde o
  kurulumun ilerlemesini istiyorum." Whatever folder is chosen — the package written by "Kurulum paketini hazırla", a USB
  drive, or an engine folder copied by hand before 1.1 (Hanne's) — is searched for the pinned downloads. A file is used
  only if its size and SHA-256 match the pinned value; everything else is downloaded as usual. Engine code is never
  taken from the folder unless it is the publisher's signed package with its signed checksum list: a hand-copied
  engine only lends its models.
*/
const SKIP_DIRS = new Set(['.venv', '.git', 'node_modules', '__pycache__', 'site-packages', 'Lib', 'isler', 'gelen', 'oturumlar', 'taslaklar']);

async function sourceIndex(root, {maxEntries = 20000} = {}) {
  const found = new Map(), bySize = new Map(KNOWN.map(k => [k.size, k]));
  let release = null, seen = 0;
  async function walk(dir, depth) {
    if (depth > 6 || seen > maxEntries) return;
    let entries;
    try { entries = await fs.readdir(dir, {withFileTypes: true}); } catch { return; }
    const names = entries.map(e => e.name);
    if (!release && names.some(n => RELEASE_ZIP.test(n)) && names.some(n => /^SHA256SUMS-[0-9.]+\.txt\.sig$/.test(n))) release = dir;
    for (const e of entries) {
      if (++seen > maxEntries) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      let size;
      try { size = (await fs.stat(full)).size; } catch { continue; }
      const item = bySize.get(size);
      if (item && !found.has(item.sha256) && e.name === item.file && await sha256File(full) === item.sha256) found.set(item.sha256, full);
    }
  }
  if (root) await walk(root, 0);
  return {release, files: found, has: item => found.get(item.sha256) || null};
}

function defaultTarget() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'Claudian', 'yuzuk-motor');
}

const inside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Why a folder must not hold the engine, or null. Hanne's 0.30.0 tried C:\Program Files (x86)\Yuzuk-motor. */
function forbiddenTarget(dir, {appDir = path.dirname(process.execPath), env = process.env} = {}) {
  if (!path.isAbsolute(dir)) return 'Klasör yolu tam olmalı.';
  for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'SystemRoot', 'ProgramData']) {
    if (env[key] && inside(dir, env[key])) return `${env[key]} altına kurulmaz: orası yönetici izni ister ve kullanıcıya ait değil.`;
  }
  if (appDir && inside(dir, appDir)) return 'Claudian\'ın kendi kurulum klasörüne kurulmaz: güncelleme ve kaldırma orayı siler.';
  return null;
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fss.createReadStream(file), hash);
  return hash.digest('hex');
}

function run(command, args, {cwd, env, signal, onLine} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env: {...process.env, ...env}, windowsHide: true, shell: false});
    let tail = '';
    const take = chunk => {
      const text = String(chunk);
      tail = (tail + text).slice(-4000);
      if (onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line.trim());
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const abort = () => { try { execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], {windowsHide: true}, () => {}); } catch {} };
    signal?.addEventListener('abort', abort, {once: true});
    child.on('error', e => { signal?.removeEventListener('abort', abort); reject(e); });
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(Error('Kurulum durduruldu; tekrar başlatınca kaldığı yerden devam eder.'));
      code === 0 ? resolve(tail) : reject(Object.assign(Error(`${path.basename(command)} ${code} ile bitti`), {tail}));
    });
  });
}

function gpuName() {
  return new Promise(resolve => execFile('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {windowsHide: true, timeout: 15000},
    (error, stdout) => resolve(error ? null : String(stdout).split(/\r?\n/)[0].trim() || null)));
}

async function freeBytes(dir) {
  let probe = path.resolve(dir);
  while (!await exists(probe)) { const up = path.dirname(probe); if (up === probe) break; probe = up; }
  try { const s = await fs.statfs(probe); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

function createInstaller({fetch, version, send = () => {}, services, setEngine, profile, tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')}) {
  let job = null;

  async function plan(target = defaultTarget()) {
    const gpu = await gpuName();
    const free = await freeBytes(target);
    const need = gpu ? NEED.gpu : NEED.cpu;
    return {target, forbidden: forbiddenTarget(target), gpu, free, need, enough: free === null || free >= need,
      running: !!job, resumable: await exists(path.join(target, '.kurulum.json'))};
  }

  async function install({target = defaultTarget(), source = null} = {}) {
    if (job) throw Error('Kurulum zaten sürüyor.');
    const why = forbiddenTarget(target);
    if (why) throw Error(why);
    if (source && path.resolve(source) === path.resolve(target)) source = null;
    const controller = new AbortController();
    job = {controller, target};
    try { return await steps(target, controller.signal, source); }
    finally { job = null; }
  }

  function cancel() { job?.controller.abort(); return {cancelled: !!job}; }

  async function steps(target, signal, source = null) {
    const tools = path.join(target, '.araclar');
    const cache = path.join(tools, 'indirilen');
    const stampFile = path.join(target, '.kurulum.json');
    await fs.mkdir(cache, {recursive: true});
    // Writability: a folder the user cannot write to fails here, before 3 GB are downloaded.
    const probe = path.join(target, `.yazma-${crypto.randomUUID()}`);
    try { await fs.writeFile(probe, 'ok'); await fs.rm(probe); } catch (e) { throw Error(`Bu klasöre yazılamıyor: ${target} (${e.code || e.message})`); }
    let stamp = {};
    try { stamp = JSON.parse(await fs.readFile(stampFile, 'utf8')); } catch {}
    const done = async (step, value = true) => { stamp[step] = value; await fs.writeFile(stampFile, JSON.stringify(stamp, null, 1)); };
    const gpu = await gpuName();
    const free = await freeBytes(target);
    const need = (gpu ? NEED.gpu : NEED.cpu) - (stamp.whisper ? 1.6 * GB : 0) - (stamp.kutuphane ? 0.8 * GB : 0);
    if (free !== null && free < need) {
      throw Error(`Yeterli boş alan yok: ${(free / GB).toFixed(1)} GB boş, yaklaşık ${(need / GB).toFixed(1)} GB gerekiyor (${target}).`);
    }
    const emit = (adim, extra = {}) => send('ring:install', {adim, adimlar: STEPS, gpu, hedef: target, ...extra});
    if (source) emit('motor', {kaynak: source});
    const local = source ? await sourceIndex(source) : null;
    const fetchFile = async (item, dest, adim) => {
      const from = local?.has(item);
      if (from && !(await exists(dest) && (await fs.stat(dest)).size === item.size)) {
        emit(adim, {dosya: path.basename(dest), kaynaktan: true});
        await fs.mkdir(path.dirname(dest), {recursive: true});
        await fs.copyFile(from, dest + '.part');
        await fs.rename(dest + '.part', dest);
      }
      return download(item.url, dest, {size: item.size, sha256: item.sha256, signal,
        onBytes: (n, total) => emit(adim, {indirilen: n, toplam: total, dosya: path.basename(dest)})});
    };

    // 1. Engine package from this version's signed release.
    if (stamp.motor !== version) {
      emit('motor');
      const {zip} = await enginePackage(cache, signal, n => emit('motor', {indirilen: n}), local?.release);
      await run(tar, ['-xf', zip, '-C', target, '--strip-components=1'], {signal});
      if (!await exists(path.join(target, 'sunucu.py')) || !await exists(path.join(target, 'requirements.txt'))) {
        throw Error('Motor paketi beklenen dosyaları içermiyor; kurulum durdu.');
      }
      await done('motor', version);
    }

    // 2. uv (Python and library installer).
    const uv = path.join(tools, 'uv', 'uv.exe');
    if (!stamp.uv || !await exists(uv)) {
      emit('uv');
      const zip = path.join(cache, UV.file);
      await fetchFile(UV, zip, 'uv');
      await fs.mkdir(path.dirname(uv), {recursive: true});
      await run(tar, ['-xf', zip, '-C', path.dirname(uv)], {signal});
      if (!await exists(uv)) throw Error('uv paketinden uv.exe çıkmadı.');
      await done('uv');
    }
    const uvEnv = {UV_PYTHON_INSTALL_DIR: path.join(tools, 'python'), UV_CACHE_DIR: path.join(tools, 'uv-cache'),
      UV_PYTHON_PREFERENCE: 'only-managed', UV_NO_CONFIG: '1', UV_LINK_MODE: 'copy', UV_NO_PROGRESS: '1'};
    const python = path.join(target, '.venv', 'Scripts', 'python.exe');

    // 3. Python 3.12, managed by uv inside the engine folder.
    if (!stamp.python || !await exists(python)) {
      emit('python');
      await run(uv, ['venv', '.venv', '--python', '3.12', '--allow-existing'], {cwd: target, env: uvEnv, signal});
      await done('python');
    }

    // 4. Libraries. cuBLAS only with an NVIDIA card (ctranslate2 needs it for the GPU; ~550 MB).
    const req = await sha256File(path.join(target, 'requirements.txt'));
    const libs = `${req}:${gpu ? 'gpu' : 'cpu'}`;
    if (stamp.kutuphane !== libs) {
      emit('kutuphane');
      const args = ['pip', 'install', '--python', python, '-r', 'requirements.txt'];
      if (gpu && await exists(path.join(target, 'requirements-gpu.txt'))) args.push('-r', 'requirements-gpu.txt');
      let count = 0;
      await run(uv, args, {cwd: target, env: uvEnv, signal, onLine: line => { if (/^(Prepared|Installed|Downloading|Built)/.test(line)) emit('kutuphane', {satir: line.slice(0, 120), n: ++count}); }});
      await done('kutuphane', libs);
    }

    // 5-6. Models.
    if (!stamp.whisper) {
      const dir = path.join(target, 'modeller', 'whisper-large-v3-turbo');
      await fs.mkdir(dir, {recursive: true});
      for (const f of WHISPER) { emit('whisper', {dosya: f.file}); await fetchFile(f, path.join(dir, f.file), 'whisper'); }
      await done('whisper');
    }
    if (!stamp.konusmaci) {
      const dir = path.join(target, 'modeller', 'konusmaci');
      await fs.mkdir(dir, {recursive: true});
      emit('konusmaci');
      await fetchFile(SPEAKER, path.join(dir, SPEAKER.file), 'konusmaci');
      await done('konusmaci');
    }

    // 7. cloudflared for the quick tunnel (the cloud reaches this computer through it; see the engine's tunel.py).
    if (!stamp.tunel || !await exists(path.join(tools, CLOUDFLARED.file))) {
      emit('tunel');
      await fetchFile(CLOUDFLARED, path.join(tools, CLOUDFLARED.file), 'tunel');
      await done('tunel');
    }

    // 8. Load Whisper for real: GPU or processor is reported from what happened, not from what was detected.
    emit('dogrulama');
    const check = 'import faster_whisper, fastapi, uvicorn, sherpa_onnx, sounddevice, notcikar\n'
      + "m, c = notcikar.whisper_yukle('large-v3-turbo')\nprint('CIHAZ=' + c)";
    const out = await run(python, ['-c', check], {cwd: target, env: {PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1'}, signal})
      .catch(e => { throw Error(`Motor denetimi geçmedi: ${String(e.tail || e.message).trim().split(/\r?\n/).slice(-3).join(' ')}`); });
    const device = /CIHAZ=cuda/.test(out) ? 'cuda' : 'cpu';
    await done('dogrulama', device);

    // 9. Register with the cloud as a node (new account, waits for approval). Same key twice → same node.
    emit('kayit');
    let node = stamp.kayit;
    if (!node || !await exists(path.join(target, 'bulut.json'))) {
      const p = await profile();
      const args = ['sunucu.py', '--kaydol', String(p?.name || '').slice(0, 60)];
      if (p?.vault) args.push('--vault', p.vault);
      const reply = await run(python, args, {cwd: target, env: {PYTHONIOENCODING: 'utf-8'}, signal})
        .catch(e => { throw Error(`Buluta kayıt olmadı: ${String(e.tail || e.message).trim().split(/\r?\n/).slice(-2).join(' ')}. İnternet bağlantısını kontrol edip tekrar dene.`); });
      node = JSON.parse(reply.trim().split(/\r?\n/).pop());
      await done('kayit', node);
    }

    // 10. Keep the engine running while Claudian runs (services.json), then point Yüzük at it.
    emit('servis');
    const service = await services?.add({id: 'yuzuk', label: 'Yüzük sunucusu', command: python, args: ['sunucu.py', '--port', String(PORT)],
      cwd: target, alive: {port: PORT}});
    await setEngine(target);
    await done('servis', true);
    await fs.rm(path.join(tools, 'uv-cache'), {recursive: true, force: true}).catch(() => {});
    await fs.rm(cache, {recursive: true, force: true}).catch(() => {});
    const result = {dir: target, device, gpu, node: node?.dugum || null, approval: node?.onay || null, service: service?.added ?? null,
      fromFolder: local ? local.files.size + (local.release ? 1 : 0) : 0};
    emit('bitti', result);
    return result;
  }

  async function enginePackage(cache, signal, onBytes, folder = null) {
    // A local folder with the package, its checksum file and signature: a USB package, or acceptance before a release
    // exists. The same public-key check applies, so only a package the publisher signed passes.
    const local = folder || process.env.CLAUDIAN_ENGINE_RELEASE_DIR;
    let assets, sums;
    if (local) {
      const names = await fs.readdir(local);
      assets = names.map(name => ({name, browser_download_url: `https://github.com/local/${encodeURIComponent(name)}`, local: path.join(local, name)}));
      sums = await signedSums({assets}, async url => {
        const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
        const bytes = await fs.readFile(path.join(local, name));
        return {ok: true, arrayBuffer: async () => bytes, text: async () => bytes.toString('utf8')};
      });
    } else {
      let r = await fetch(`${RELEASES}/tags/v${version}`, {headers: {Accept: 'application/vnd.github+json'}, signal});
      if (r.status === 404) r = await fetch(`${RELEASES}/latest`, {headers: {Accept: 'application/vnd.github+json'}, signal});
      if (!r.ok) throw Error('Sürüm bilgisi alınamadı (GitHub). İnternet bağlantısını kontrol edip tekrar dene.');
      const release = await r.json();
      assets = release.assets || [];
      sums = await signedSums(release, fetch);
    }
    const asset = assets.find(a => /^yuzuk-motor-[0-9.]+\.zip$/.test(String(a.name || '')));
    if (!asset) throw Error('Bu sürümde motor paketi yok.');
    const expected = sums.get(asset.name);
    if (!expected) throw Error('Motor paketi imzalı sağlama listesinde yok; açılmadı.');
    const zip = path.join(cache, asset.name);
    if (asset.local) {
      await fs.copyFile(asset.local, zip);
      if (await sha256File(zip) !== expected) { await fs.rm(zip, {force: true}); throw Error('Motor paketinin özeti imzalı listeyle tutmuyor; açılmadı.'); }
    } else {
      await download(githubUrl(asset).href, zip, {size: asset.size, sha256: expected, signal, onBytes});
    }
    return {zip};
  }

  const download = (url, file, options) => downloadFile(fetch, url, file, options);

  return {plan, install, cancel, status: () => ({running: !!job, target: job?.target || null})};
}

// Resumable download: continue a .part file with a Range request; verify size and digest before it is used.
async function downloadFile(fetch, url, file, {size, sha256, signal, onBytes} = {}) {
    if (await exists(file) && (!size || (await fs.stat(file)).size === size) && (!sha256 || await sha256File(file) === sha256)) return;
    const part = file + '.part';
    let have = 0;
    try { have = (await fs.stat(part)).size; } catch {}
    if (size && have > size) { await fs.rm(part, {force: true}); have = 0; }
    if (!size || have < size) {
      const r = await fetch(url, {headers: have ? {Range: `bytes=${have}-`} : {}, signal});
      if (r.status === 200 && have) have = 0; // the server ignored the range: start over
      else if (r.status !== 200 && r.status !== 206) throw Error(`İndirme başarısız (${r.status}): ${path.basename(file)}`);
      let n = have;
      const count = new Transform({transform(chunk, _e, cb) { n += chunk.length; onBytes?.(n, size || null); cb(null, chunk); }});
      await pipeline(Readable.fromWeb(r.body), count, fss.createWriteStream(part, {flags: have ? 'a' : 'w'}), {signal});
    }
    if (size && (await fs.stat(part)).size !== size) throw Error(`İndirme eksik kaldı: ${path.basename(file)}. Tekrar dene; kaldığı yerden devam eder.`);
    if (sha256 && await sha256File(part) !== sha256) {
      await fs.rm(part, {force: true});
      throw Error(`İndirilen dosyanın özeti tutmuyor: ${path.basename(file)}. Dosya kullanılmadı; tekrar dene.`);
    }
    await fs.rename(part, file);
}

module.exports = {createInstaller, downloadFile, defaultTarget, forbiddenTarget, sourceIndex, sha256File, STEPS, WHISPER, SPEAKER, UV, CLOUDFLARED,
  RELEASES};
