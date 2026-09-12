'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session, clipboard, Notification } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { MemorySetup, assertOrdinaryPath } = require('./core.cjs');
const {execFile,spawn}=require('node:child_process');
const runFile=require('node:util').promisify(execFile);
const welcome=require('./welcome.cjs');
const smoke = process.argv.includes('--smoke');
const acceptanceRoot=process.env.CLAUDIAN_ACCEPTANCE_ROOT;
if(acceptanceRoot && (!path.isAbsolute(acceptanceRoot)||!require('node:fs').existsSync(path.join(acceptanceRoot,'.claudian-acceptance'))))throw Error('Acceptance mode requires an explicit marked test directory.');
if (smoke) app.setPath('userData', require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'claudian-smoke-profile-')));
if (smoke) app.disableHardwareAcceleration();
const origin = 'claudian://app';
let win, core, migrationError='';
protocol.registerSchemesAsPrivileged([{ scheme: 'claudian', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!smoke) app.setPath('userData', acceptanceRoot?path.join(acceptanceRoot,'data'):path.join(app.getPath('appData'), 'Claudian Desktop'));
if (!app.requestSingleInstanceLock({ smoke })) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
async function start() {
  let home = acceptanceRoot?path.join(acceptanceRoot,'home'):os.homedir();
  if (smoke) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-desktop-smoke-'));
    home = path.join(root, 'home'); await fs.mkdir(home);
    await fs.mkdir(path.join(home, '.agents')); await fs.mkdir(path.join(home, '.claude'));
    app.setPath('userData', path.join(root, 'data'));
  }
  protocol.handle('claudian', request => {
    const url = new URL(request.url);
    const allowed = { '/': 'index.html', '/index.html': 'index.html', '/setup.html': 'setup.html', '/styles.css': 'styles.css', '/fonts.css': 'fonts.css', '/renderer.js': 'renderer.js', '/errors.js': 'errors.js', '/lottie.min.js': 'lottie.min.js', '/claudian-memory.json': 'claudian-memory.json' };
    if (url.hostname === 'app' && /^\/fonts\/[a-zA-Z0-9_.-]+\.woff2$/.test(url.pathname)) return net.fetch(pathToFileURL(path.join(__dirname, 'ui', url.pathname.slice(1))).href);
    if (url.hostname !== 'app' || !allowed[url.pathname]) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, 'ui', allowed[url.pathname])).href);
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  core = new MemorySetup({ home, dataDir: app.getPath('userData'), codexHome: !smoke && !acceptanceRoot && process.env.CODEX_HOME ? process.env.CODEX_HOME : path.join(home, '.codex'), emit: event => {
    if (win && !win.isDestroyed()) win.webContents.send('setup:event', event);
  } });
  try {
    const preferencesFile=path.join(app.getPath('userData'),'preferences.json');
    let selectedLanguage;
    if(!smoke){
      const marker=path.join(path.dirname(process.resourcesPath),'install-language.txt');
      try { selectedLanguage=(await fs.readFile(marker,'utf8')).trim()==='1055'?'tr':'en'; } catch(error) { if(error.code!=='ENOENT')throw error; }
    }
    if(!selectedLanguage)try { selectedLanguage=(JSON.parse(await fs.readFile(preferencesFile,'utf8'))).language; } catch(error) { if(error.code!=='ENOENT')throw error; }
    // The diagnostic run must not depend on the developer's OS locale: on a Turkish machine
    // the smoke test started in tr and failed its first assertion, so the panel path was
    // never actually exercised here. Smoke starts from en and switches languages itself.
    selectedLanguage=selectedLanguage||(smoke?'en':((app.getLocale()||'').toLowerCase().startsWith('tr')?'tr':'en'));
    const languageChanged=await core.useLanguage(selectedLanguage);
    if(languageChanged||(await core.snapshot()).profile?.protocolVersion !== require('./policy.cjs').VERSION) await core.upgrade();
  } catch(error) { migrationError=error.message; }
  const installed = Boolean((await core.snapshot()).profile);
  win = new BrowserWindow({ icon: path.join(__dirname, 'assets', 'icon.ico'), width: installed ? 940 : 720, height: installed ? 760 : 640, minWidth: 680, minHeight: 560,
    title: installed ? 'claudian.app' : 'claudian.app — Setup', backgroundColor: '#0e0e10', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: smoke } });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => {
    if (core.running) { event.preventDefault(); core.cancel(); }
  });
  function handle(name, fn) {
    ipcMain.handle(name, async (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw new Error('Geçersiz uygulama isteği.');
      try { return { ok: true, value: await fn(...args) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
  }
  require('./companion-bridge.cjs').attach(handle,session);
  handle('app:snapshot', async () => ({...await core.snapshot(),appVersion:app.getVersion(),migrationError}));

  handle('app:preferences', language => core.preferences(language));
  handle('memory:connections', () => core.connections());
  const scanPaths=new Map();
  handle('memory:choose-cli', async id=>{
    if(!['codex','claude-code'].includes(id))throw new Error('This host does not support direct launch yet.');
    const result=await dialog.showOpenDialog(win,{title:'Select '+id,properties:['openFile'],filters:[{name:'Application',extensions:['exe']}]});
    if(result.canceled)return false;
    const selected=result.filePaths[0];if(!await require('./scan.cjs').resolve(id,selected))throw new Error('Invalid executable.');
    scanPaths.set(id,selected);return true;
  });
  handle('memory:existing-skill', async id=>{
    const host=require('./core.cjs').HOSTS[id];if(!host)throw new Error('Unknown connection.');
    const target=path.join(home,...host.parts,host.filename||'SKILL.md');await assertOrdinaryPath(target);shell.showItemInFolder(target);
  });
  handle('memory:open-app',async id=>{const relative={'antigravity':'antigravity/Antigravity.exe','cursor':'cursor/Cursor.exe'}[id];if(!relative)throw Error('No desktop launch adapter.');const file=path.join(process.env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Programs',relative);await fs.access(file);const message=await shell.openPath(file);if(message)throw Error(message);return true;});
  handle('memory:scan-preview', async language => {
    const profile=(await core.snapshot()).profile;if(!profile)throw new Error('Memory is not configured.');
    const scan=require('./scan.cjs');return {prompt:scan.prompt({...profile,language:language==='tr'?'tr':'en'}),hosts:await Promise.all(profile.hosts.map(async h=>({...h,available:!!await scan.resolve(h.id,scanPaths.get(h.id))})))};
  });
  handle('memory:scan-send', async (id,prompt) => {
    const profile=(await core.snapshot()).profile;if(!profile)throw new Error('Memory is not configured.');
    return require('./scan.cjs').launch(profile,id,prompt,scanPaths.get(id));
  });
  handle('memory:repair', host => core.upgrade(host));
  const RELEASES='https://api.github.com/repos/GeneralBobi/claudian-app/releases/latest';
  handle('app:updates', async () => {
    const response=await net.fetch(RELEASES,{headers:{'Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('Update service unavailable. Try again later.');
    const release=await response.json(); const latest=String(release.tag_name||'').replace(/^v/,'');
    if(!/^\d+\.\d+\.\d+$/.test(latest))throw new Error('Invalid release version.');
    const a=latest.split('.').map(Number),b=app.getVersion().split('.').map(Number);
    const index=a.findIndex((n,i)=>n!==b[i]);return {latest,available:index>=0&&a[index]>b[index]};
  });
  handle('app:download-update', async () => {
    const response=await net.fetch(RELEASES,{headers:{'Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('Update service unavailable. Try again later.');
    const release=await response.json();
    const asset=(release.assets||[]).find(a=>/^Claudian-Setup-[0-9.]+\.exe$/i.test(String(a.name||'')));
    if(!asset||typeof asset.browser_download_url!=='string')throw new Error('This release has no Windows installer to download.');
    const url=new URL(asset.browser_download_url);
    if(url.protocol!=='https:'||!/(^|\.)github(usercontent)?\.com$/i.test(url.hostname))throw new Error('Unexpected download location; nothing was downloaded.');
    const target=path.join(app.getPath('temp'),`claudian-update-${crypto.randomUUID()}`,asset.name);
    await assertOrdinaryPath(target); await fs.mkdir(path.dirname(target),{recursive:true});
    const file=await net.fetch(url.href,{signal:AbortSignal.timeout(600000)});
    if(!file.ok)throw new Error('The installer could not be downloaded.');
    const bytes=Buffer.from(await file.arrayBuffer());
    if(!bytes.length||(asset.size&&bytes.length!==asset.size))throw new Error('The download was incomplete; it was discarded.');
    const sums=(release.assets||[]).find(a=>/^SHA256SUMS[-0-9.]*\.txt$/i.test(String(a.name||'')));
    if(!sums)throw new Error('This release publishes no checksum; the installer was not run.');
    const sumsUrl=new URL(sums.browser_download_url);
    if(sumsUrl.protocol!=='https:'||!/(^|\.)github(usercontent)?\.com$/i.test(sumsUrl.hostname))throw new Error('Unexpected checksum location; nothing was run.');
    const sumsResponse=await net.fetch(sumsUrl.href,{signal:AbortSignal.timeout(30000)});
    if(!sumsResponse.ok)throw new Error('The checksum file could not be downloaded.');
    const expected=(await sumsResponse.text()).split(/\r?\n/).map(line=>line.trim().split(/\s+/))
      .find(parts=>parts.length>=2&&parts[parts.length-1].replace(/^\*/,'')===asset.name)?.[0];
    if(!/^[0-9a-f]{64}$/i.test(expected||''))throw new Error('The release checksum is missing or malformed; the installer was not run.');
    const actual=crypto.createHash('sha256').update(bytes).digest('hex');
    if(actual.toLowerCase()!==expected.toLowerCase())throw new Error('The installer checksum does not match the release; it was discarded.');
    await fs.writeFile(target,bytes,{flag:'wx'});
    const opened=await shell.openPath(target);
    if(opened)throw new Error(opened);
    return {launched:true,version:String(release.tag_name||'').replace(/^v/,''),installer:target};
  });
  handle('memory:check-files', () => core.checkFiles());
  handle('memory:remove', host => core.removeHost(host));
  handle('memory:configuration', async (host, kind) => {
    if (!['skill','rule','config','hooks'].includes(kind)) throw new Error('Invalid configuration type.');
    const profile = (await core.snapshot()).profile;
    const files = await core.hostPaths(profile,host);
    if(kind==='config'&&!files.config)files.config=files.access?.file;
    if(typeof files[kind]!=='string')throw Error('Configuration file not available.');
    if (smoke) return files[kind];
    shell.showItemInFolder(files[kind]);
  });
  handle('app:download-obsidian', () => shell.openExternal('https://obsidian.md/download'));
  handle('app:obsidian-installed', async () => {
    if (smoke) return true;
    // `\o`, `\s` and `\c` are not escape sequences, so the backslashes were dropped and
    // reg.exe received `HKCRobsidianshellopencommand` -- an invalid key name that could
    // never match. Detection therefore always answered no, and the app kept offering the
    // Obsidian download button to people who already had it installed.
    try { await runFile('reg.exe',['query','HKCR\\obsidian\\shell\\open\\command'],{windowsHide:true}); return true; }
    catch {}
    // A missing registry key is not proof of a missing app, so the known install path
    // is checked before answering no.
    try { await fs.access(path.join(process.env.LOCALAPPDATA || path.join(home,'AppData','Local'),'Programs','Obsidian','Obsidian.exe')); return true; }
    catch { return false; }
  });
  handle('memory:obsidian', async () => {
    const profile = (await core.snapshot()).profile;
    if (!profile) throw new Error('Memory is not configured.');
    if (smoke) return 'obsidian://open?path='+encodeURIComponent(path.join(profile.vault,'Claudian Home.md'));
    // Registering a vault that is not on disk would either fail obscurely or quietly recreate
    // it behind the user's back. Say what is wrong; the panel offers the way to fix it.
    try { await fs.access(profile.vault); } catch { throw new Error('Not klasörü bulunamadı.'); }
    try { await runFile('reg.exe',['query','HKCR\\obsidian\\shell\\open\\command'],{windowsHide:true}); }
    catch { return {notInstalled:true}; }
    await welcome.ensure(profile,assertOrdinaryPath);
    const processes=await runFile('tasklist.exe',['/FI','IMAGENAME eq Obsidian.exe','/FO','CSV','/NH'],{windowsHide:true});
    const result=await require('./obsidian.cjs').register(path.join(app.getPath('appData'),'obsidian','obsidian.json'),profile.vault,{running:/obsidian\.exe/i.test(processes.stdout),assertPath:assertOrdinaryPath});
    if(result.needsClose)return result;
    const uri = 'obsidian://open?vault=' + encodeURIComponent(result.id) + '&file=Claudian%20Home';
    if (smoke) return uri;
    await shell.openExternal(uri);
    return result;
  });
  handle('app:discover', () => core.discover());
  handle('app:enter', async () => {
    if (!(await core.snapshot()).profile) throw new Error('Önce kurulumu tamamlayın.');
    win.setSize(940, 760); win.center(); win.setTitle('claudian.app');
    await win.loadURL(origin + '/index.html');
  });
  handle('app:folder', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Not klasörünü seç', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('setup:prepare', input => core.prepare(input));
  handle('setup:install', id => core.install(id));
  handle('setup:cancel', () => core.cancel());
  handle('memory:activity', () => core.activity());
  // Serialize profile mutations; concurrent tests must not lose another host's state.
  let mutations = Promise.resolve();
  const mutate = fn => { const next = mutations.then(fn); mutations = next.catch(() => {}); return next; };
  handle('memory:health', () => core.health());
  // Fark etme katmani: klasoru okur, adaylari dondurur, hicbir sey yazmaz.
  handle('memory:notice', async () => {
    const profile = (await core.snapshot()).profile;
    if (!profile) throw new Error('Memory is not configured.');
    await assertOrdinaryPath(profile.vault);
    return require('./notice.cjs').look({
      vault: profile.vault,
      ledgerFile: path.join(core.dataDir, 'noticed.json'),
    });
  });
  handle('memory:adopt-protocol', () => mutate(() => core.adoptProtocol()));
  handle('memory:relocate', target => mutate(() => core.relocate(target)));
  handle('memory:skip-verification', () => core.skipVerification());
  handle('memory:challenge', host => mutate(() => core.challenge(host)));
  handle('memory:verify', host => mutate(() => core.verify(host)));
  handle('memory:verify-watch', host => core.watchVerification(host, event => {
    if (win && !win.isDestroyed()) win.webContents.send('verify:event', {host, ...event});
  }));
  handle('app:copy', text => { if (typeof text !== 'string' || text.length > 5000) throw new Error('Geçersiz metin.'); clipboard.writeText(text); });
  handle('app:open', async kind => {
    const target = kind === 'logs' ? path.join(core.dataDir, 'logs') : kind === 'vault' ? (await core.snapshot()).profile?.vault : null;
    if (!target) throw new Error('Klasör henüz hazır değil.');
    if (smoke) return target;
    // Opening a folder that is gone returned the OS string "Failed to open path", which says
    // nothing about what is wrong or what to do.
    try { await fs.access(target); } catch { throw new Error('Not klasörü bulunamadı.'); }
    const error = await shell.openPath(target); if (error) throw new Error(error);
  });
  /**
   * Fark etme turu.
   *
   * Sıradan uygulama kodu, ajan oturumu değil: izin sormaz çünkü soracak bir merci yok.
   * [[Claudian Dispatcher]]'da ölçülen şey buydu -- sohbet ürünü üstüne kurulan bir
   * "sürekli çalışan ajan", durumu diske yazmak zorunda kaldığı anda izin kapısına çarpar.
   *
   * Açılışta bir telafi turu, sonra yarım saatte bir. Soğuk turun bedeli yok: hiçbir şey
   * değişmemişse ne dosya yazılır ne bildirim çıkar.
   */
  const noticed = async () => {
    const profile = (await core.snapshot()).profile;
    if (!profile || profile.automaticWatch !== true || profile.access !== 'write') return;
    try {
      await assertOrdinaryPath(profile.vault);
      const outcome = await require('./watch.cjs').tick({
        vault: profile.vault,
        ledgerFile: path.join(core.dataDir, 'noticed.json'),
        language: profile.language || 'en',
        notify: ({title, body}) => {
          if (!Notification.isSupported()) return;
          const alert = new Notification({title, body, silent: false});
          // Tıklayınca not klasörü açılır. Uygulamayı öne getirmek yanlış olurdu: bu
          // ürünün yüzeyi uygulama değil, notların kendisi.
          alert.on('click', () => { void shell.openPath(profile.vault); });
          alert.show();
        },
      });
      if (outcome.wrote || outcome.notified) {
        console.log(`[claudian] fark etme turu: ${outcome.candidates} aday` +
          (outcome.wrote ? ` · ${outcome.note} yazıldı` : '') +
          (outcome.notified ? ' · bir bildirim' : ''));
      }
    } catch (error) { console.error('[claudian] fark etme turu:', error.message); }
  };
  if (!smoke) {
    setTimeout(() => void noticed(), 8000);
    setInterval(() => void noticed(), 30 * 60 * 1000);
  }

  await win.loadURL(origin + (installed ? '/index.html' : '/setup.html'));
  if (smoke) await require('./smoke.cjs').run({ win, core, app, home });
  else win.show();
}
app.on('window-all-closed', () => app.quit());
