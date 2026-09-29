'use strict';
/*
  Clean-profile acceptance for the Yüzük engine installer (1.1.0, madde 1):
  install from nothing → start the engine → quick tunnel → register → pair a phone → a transcript becomes a note.

    node acceptance/temiz-profil.cjs <release dir with yuzuk-motor-*.zip + SHA256SUMS.txt(.sig)> [--birak]
    node acceptance/temiz-profil.cjs --paket <engine folder to lend models> [--surum 1.5.0] [--birak]

  --paket (1.5.0): "Kurulum paketini hazırla" first writes a real Yuzuk-kurulum folder from the published GitHub
  release and the given engine's models, then the clean profile installs with "Klasörden kur" from that folder.

  "Clean" means: the user profile folders (LOCALAPPDATA, APPDATA, USERPROFILE, TEMP) point into a new empty folder
  whose name has a space and Turkish letters (usernames like "Boran Birtanır" exist), and PATH holds only Windows
  itself — no Python, no Node, no CUDA toolkit. The installer runs outside Electron with the same code the app uses.
  Everything happens against the live cloud with a new test account; its rows are deleted at the end (--birak keeps
  them). The note text is fictional and is not written into anyone's vault.
*/
const fs = require('fs/promises');
const path = require('path');
const {spawn, execFileSync} = require('child_process');

const argv = process.argv.slice(2);
const packageFrom = argv.includes('--paket') ? path.resolve(argv[argv.indexOf('--paket') + 1]) : null;
const version = argv.includes('--surum') ? argv[argv.indexOf('--surum') + 1] : packageFrom ? '1.5.0' : '1.1.0';
const releaseDir = packageFrom ? null : path.resolve(argv[0] || '');
const keep = process.argv.includes('--birak');
const BULUT = 'https://yuzuk-api.claudian.app';
const PORT = 3060; // 3050 belongs to this computer's real engine
const BULUT_REPO = process.env.YUZUK_BULUT_REPO || 'C:\\src\\yuzuk_bulut';
// KABUL_PROFIL: a run that stopped half-way continues with the same profile (the installer resumes; nothing is downloaded twice).
const root = process.env.KABUL_PROFIL || path.join(process.env.KABUL_KOK || 'C:\\src', `Temiz Profil Şğü ${Date.now().toString(36)}`);
const local = path.join(root, 'AppData', 'Local');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cleanEnv() {
  const sys = process.env.SystemRoot || 'C:\\Windows';
  const keepVars = ['SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
    'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'CommonProgramFiles', 'COMPUTERNAME'];
  const env = {};
  for (const k of keepVars) if (process.env[k]) env[k] = process.env[k];
  Object.assign(env, {PATH: [path.join(sys, 'System32'), sys, path.join(sys, 'System32', 'Wbem'), path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    USERPROFILE: root, HOME: root, LOCALAPPDATA: local, APPDATA: path.join(root, 'AppData', 'Roaming'),
    TEMP: path.join(local, 'Temp'), TMP: path.join(local, 'Temp'), USERNAME: 'Temiz Profil'});
  return env;
}

async function cihaz(...args) {
  return execFileSync(process.execPath, [path.join(BULUT_REPO, 'scripts', 'cihaz.mjs'), ...args], {cwd: BULUT_REPO, encoding: 'utf8'});
}
function d1(sql) {
  const wrangler = path.join(BULUT_REPO, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'yuzuk', '--remote', '--json', '--command', sql], {cwd: BULUT_REPO, encoding: 'utf8'});
}
async function api(method, yol, anahtar, govde) {
  const r = await fetch(BULUT + yol, {method, headers: {'Content-Type': 'application/json', ...(anahtar ? {Authorization: `Bearer ${anahtar}`} : {})},
    body: govde ? JSON.stringify(govde) : undefined});
  return {s: r.status, j: await r.json().catch(() => null)};
}

(async () => {
  const report = {baslangic: new Date().toISOString(), kok: root, adimlar: {}};
  const env = cleanEnv();
  await fs.mkdir(env.TEMP, {recursive: true});
  const vault = path.join(root, 'Belgeler', 'Kabul Vault');
  await fs.mkdir(vault, {recursive: true});
  // --paket: the package is written first, the way "Kurulum paketini hazırla" does on the computer that has an engine.
  let source = null;
  if (packageFrom) {
    const {writePackage} = require('../ring-package.cjs');
    const t = Date.now();
    const pkg = await writePackage({folder: path.join(root, 'USB'), version, fetch, engineDir: packageFrom,
      send: (_c, ev) => { if (!ev.indirilen || ev.indirilen % (100 * 1048576) < 2e6) log('paket', ev.durum, ev.dosya || '', ev.kaynaktan ? 'kopya' : '', ev.indirilen ? `${Math.round(ev.indirilen / 1048576)} MB` : ''); }});
    report.adimlar.paket = {...pkg, sure_dk: +((Date.now() - t) / 60000).toFixed(1)};
    source = pkg.target;
    log('paket hazır', JSON.stringify(pkg));
  }
  // Child processes of the installer inherit process.env: replace it with the clean profile.
  const saved = {...process.env};
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, env, releaseDir ? {CLAUDIAN_ENGINE_RELEASE_DIR: releaseDir} : {});
  const {createInstaller, defaultTarget} = require('../ring-install.cjs');
  const target = defaultTarget();
  let engineSet = null, serviceSpec = null;
  const installer = createInstaller({fetch, version, setEngine: async d => { engineSet = d; },
    services: {add: async s => { serviceSpec = s; return {added: true}; }}, profile: async () => ({name: 'Kabul Testi', vault}),
    send: (_c, ev) => { if (!ev.indirilen || ev.indirilen % (200 * 1048576) < 2e6) log('kurulum', ev.adim, ev.dosya || '', ev.indirilen ? `${Math.round(ev.indirilen / 1048576)} MB` : '', ev.satir || ''); }});
  const t0 = Date.now();
  const plan = await installer.plan();
  log('plan', JSON.stringify(plan));
  report.adimlar.plan = plan;
  let result;
  try { result = await installer.install(source ? {source} : {}); }
  catch (e) { report.adimlar.kurulum = {hata: e.message, tail: e.tail}; throw e; }
  finally { Object.assign(process.env, saved); }
  report.adimlar.kurulum = {...result, sure_dk: +((Date.now() - t0) / 60000).toFixed(1), motor: engineSet, servis: serviceSpec};
  log('kuruldu', JSON.stringify(result));
  if (!/AppData[\\/]Local[\\/]Claudian[\\/]yuzuk-motor$/.test(target) || !target.startsWith(root)) throw Error('hedef temiz profilin dışında: ' + target);

  // Start the engine the way the service would, with the clean environment, on a free port.
  const python = path.join(target, '.venv', 'Scripts', 'python.exe');
  const server = spawn(python, ['sunucu.py', '--port', String(PORT)], {cwd: target, env: {...env, PYTHONIOENCODING: 'utf-8'}, windowsHide: true});
  let serverOut = '';
  server.stdout.on('data', c => { serverOut += c; });
  server.stderr.on('data', c => { serverOut += c; });
  const bulut = JSON.parse(await fs.readFile(path.join(target, 'bulut.json'), 'utf8'));
  const node = bulut.dugum;
  try {
    let url = null;
    for (let i = 0; i < 90 && !url; i++) {
      await sleep(2000);
      url = (serverOut.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) || [])[0] || null;
    }
    if (!url) throw Error('hızlı tünel adresi gelmedi:\n' + serverOut.slice(-1500));
    report.adimlar.tunel = {url};
    log('tünel', url);
    let dbUrl = null;
    for (let i = 0; i < 12 && dbUrl !== url; i++) {
      await sleep(10000);
      dbUrl = JSON.parse(d1(`SELECT url, onay FROM dugumler WHERE id = '${node}'`))[0].results[0]?.url;
    }
    if (dbUrl !== url) throw Error(`nabız adresi buluta yazmadı (${dbUrl})`);
    report.adimlar.nabiz = {tamam: true};
    log('nabız bulutta');
    log(await cihaz('onayla', node));

    const code = execFileSync(python, ['sunucu.py', '--eslestirme-kodu'], {cwd: target, env: {...env, PYTHONIOENCODING: 'utf-8'}, encoding: 'utf8'}).trim().split(/\s+/).pop();
    const phone = await api('POST', '/v1/eslestir', null, {kod: code, ad: 'Kabul telefonu'});
    if (phone.s !== 200) throw Error('eşleşme: ' + JSON.stringify(phone));
    report.adimlar.eslesme = {cihaz: phone.j.cihaz, onay_once: phone.j.onay};
    const waiting = await api('GET', '/v1/saglik', phone.j.anahtar);
    report.adimlar.eslesme.onaysiz_saglik = {s: waiting.s, tur: waiting.j?.tur};
    log(await cihaz('onayla', phone.j.cihaz));
    const health = await api('GET', '/v1/saglik', phone.j.anahtar);
    report.adimlar.eslesme.saglik = {s: health.s, stt: health.j?.stt, laya: health.j?.laya, konusmaci: health.j?.konusmaci};
    log('sağlık', health.s, JSON.stringify(health.j));
    if (health.s !== 200) throw Error('telefon düğüme ulaşamadı: ' + JSON.stringify(health.j));

    const cumleler = [
      'Bugünkü derste veri yapılarına giriş yaptık.', 'İkili arama ağacında her düğümün solundakiler küçük, sağındakiler büyüktür.',
      'Silme işleminde iki çocuklu düğüm için sıralı ardıl kullanılır.', 'Gelecek hafta perşembe günü kısa sınav var.',
    ].map((metin, i) => ({bas: i * 6, son: i * 6 + 5, metin}));
    const job = await api('POST', '/v1/dokum', phone.j.anahtar, {dokum: {dil: 'tr', sure_sn: 30, cumleler}, baslangic: '2026-09-28T10:00', baslik: 'Kabul · veri yapıları'});
    if (job.s !== 200) throw Error('döküm: ' + JSON.stringify(job));
    let st = null;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      st = await api('GET', `/v1/oturum/${job.j.id}`, phone.j.anahtar);
      if (['hazir', 'hata'].includes(st.j?.durum)) break;
    }
    report.adimlar.not = {durum: st?.j?.durum, hata: st?.j?.hata || null, baslik: st?.j?.sonuc?.baslik || null,
      not_md: st?.j?.sonuc?.not_md || null, yazici: st?.j?.sonuc?.yazici || null};
    log('not', st?.j?.durum, st?.j?.hata || st?.j?.sonuc?.baslik || '');
  } finally {
    try { execFileSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], {stdio: 'ignore'}); } catch {}
    // The engine's own tunnel child is found through its pid file.
    try { const pid = (await fs.readFile(path.join(target, '.araclar', 'tunel.pid'), 'utf8')).trim(); execFileSync('taskkill', ['/pid', pid, '/f'], {stdio: 'ignore'}); } catch {}
    if (!keep && node) {
      const acc = bulut.dugum ? JSON.parse(d1(`SELECT hesap_id FROM dugumler WHERE id = '${node}'`))[0].results[0]?.hesap_id : null;
      if (acc && /^h_[0-9a-f]{16}$/.test(acc)) {
        d1(`DELETE FROM kullanim WHERE hesap_id = '${acc}'; DELETE FROM isler WHERE hesap_id = '${acc}'; DELETE FROM eslestirme_kodlari WHERE hesap_id = '${acc}'; DELETE FROM cihazlar WHERE hesap_id = '${acc}'; DELETE FROM dugumler WHERE hesap_id = '${acc}'; DELETE FROM hesaplar WHERE id = '${acc}';`);
        report.temizlik = {hesap: acc, silindi: true};
        log('bulut kayıtları silindi', acc);
      }
    }
    report.bitis = new Date().toISOString();
    await fs.writeFile(path.join(__dirname, `temiz-profil-rapor-${Date.now().toString(36)}.json`), JSON.stringify(report, null, 1));
    log('rapor yazıldı');
  }
})().catch(e => { console.error('KABUL DURDU:', e.message); process.exitCode = 1; });
