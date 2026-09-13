'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session, clipboard, Notification, safeStorage } = require('electron');
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
// Uninstalling the program used to leave everything it had written: the profile, and the
// skill, startup rule, MCP entry and hook it put inside each AI application. A reinstall then
// found a profile, opened the review screen instead of setup, and pointed at a notes folder
// the user had already deleted -- so the wizard never asked where notes should live and no
// vault was ever created. Measured 12.09.2026 on a clean reinstall. The uninstaller now runs
// this first: every connection is withdrawn the same way the panel withdraws one, and only
// then is the application's own state removed. Notes are never touched.
const purge = process.argv.includes('--purge');
const acceptanceRoot=process.env.CLAUDIAN_ACCEPTANCE_ROOT;
if(acceptanceRoot && (!path.isAbsolute(acceptanceRoot)||!require('node:fs').existsSync(path.join(acceptanceRoot,'.claudian-acceptance'))))throw Error('Acceptance mode requires an explicit marked test directory.');
if (smoke) app.setPath('userData', require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'claudian-smoke-profile-')));
if (smoke) app.disableHardwareAcceleration();
const origin = 'claudian://app';
let win, core, remoteConnector, migrationError='', setupReview=false, installStamp='';
protocol.registerSchemesAsPrivileged([{ scheme: 'claudian', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!smoke) app.setPath('userData', acceptanceRoot?path.join(acceptanceRoot,'data'):path.join(app.getPath('appData'), 'Claudian Desktop'));
if (purge) app.whenReady().then(purgeInstallation).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
else if (!app.requestSingleInstanceLock({ smoke })) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
// Runs with no window, from the uninstaller. Each failure is reported and the next connection
// is still attempted: a single unreachable file must not leave the other five installed.
async function purgeInstallation() {
  const dataDir = app.getPath('userData');
  const home = acceptanceRoot ? path.join(acceptanceRoot, 'home') : os.homedir();
  const setup = new MemorySetup({ home, dataDir, codexHome: !acceptanceRoot && process.env.CODEX_HOME ? process.env.CODEX_HOME : path.join(home, '.codex') });
  const profile = await setup.snapshot().then(s => s.profile).catch(() => null);
  for (const host of profile?.hosts || []) {
    // Uninstalling is not the moment to refuse over a file that drifted: the user asked for
    // this to be gone. Originals are copied into the removal journal before anything changes.
    try { await setup.removeHost(host.id, {force: true}); console.log('removed ' + host.id); }
    catch (error) { console.error('could not remove ' + host.id + ': ' + error.message); }
  }
  // The notes folder is the user's, so it stays. Only what this application wrote about
  // itself is removed, and only after the connections above are gone.
  await fs.rm(dataDir, { recursive: true, force: true });
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
    const installedLanguage=(await core.snapshot()).profile?.language;
    let selectedLanguage=installedLanguage;
    // An installed profile's language belongs to the notes on disk, so nothing here may
    // change it. The NSIS marker records which language the INSTALLER ran in, and it
    // reached the profile on every launch: a reinstall in the other language flipped
    // profile.language, upgrade() rewrote every managed protocol file in that language and
    // kept the previous one as a "(yours ...)" copy, and the next run did the reverse.
    // Measured 12.09.2026 on a real vault: 18 notes, 11 of them protocol files, two
    // languages, both stamp formats present. The marker now only seeds a first install.
    if(!selectedLanguage){
      if(!smoke){
        const marker=path.join(path.dirname(process.resourcesPath),'install-language.txt');
        try { selectedLanguage=(await fs.readFile(marker,'utf8')).trim()==='1055'?'tr':'en'; } catch(error) { if(error.code!=='ENOENT')throw error; }
      }
      if(!selectedLanguage)try { selectedLanguage=(JSON.parse(await fs.readFile(preferencesFile,'utf8'))).language; } catch(error) { if(error.code!=='ENOENT')throw error; }
      // The diagnostic run must not depend on the developer's OS locale: on a Turkish machine
      // the smoke test started in tr and failed its first assertion, so the panel path was
      // never actually exercised here. Smoke starts from en and switches languages itself.
      selectedLanguage=selectedLanguage||(smoke?'en':((app.getLocale()||'').toLowerCase().startsWith('tr')?'tr':'en'));
    }
    const languageChanged=await core.useLanguage(selectedLanguage);
    if(languageChanged||(await core.snapshot()).profile?.protocolVersion !== require('./policy.cjs').VERSION) await core.upgrade();
    await core.sweepResidue();
  } catch(error) { migrationError=error.message; }
  const installed = Boolean((await core.snapshot()).profile);
  installStamp = app.getVersion()+':'+await fs.readFile(path.join(path.dirname(process.resourcesPath),'install-session.txt'),'utf8').catch(e=>{if(e.code==='ENOENT')return 'legacy';throw e;});
  setupReview = !smoke && await require('./setup-review.cjs').pending(core.dataDir,installStamp,(await core.snapshot()).profile);
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
  handle('app:snapshot', async () => ({...await core.snapshot(),appVersion:app.getVersion(),migrationError,setupReview}));
  handle('setup:review', async (hosts, consent, withdraw) => {
    const result=await require('./setup-review.cjs').apply(core,hosts,consent,withdraw);
    return result;
  });
  handle('setup:review-done', async () => {
    await require('./setup-review.cjs').acknowledge(core.dataDir,installStamp);setupReview=false;return true;
  });

  handle('app:preferences', language => core.preferences(language));
  handle('memory:connections', () => core.connections());
  remoteConnector = await new (require('./remote-connector.cjs').RemoteConnector)({dataDir:core.dataDir,profile:async()=>(await core.snapshot()).profile,safeStorage}).load();
  handle('connector:status',async()=>({...await remoteConnector.status(),desktopExtension:await require('./connector-package.cjs').desktopStatus(home,core.dataDir)}));
  handle('connector:desktop-install',async()=>{
    const profile=(await core.snapshot()).profile;
    if(!profile?.hosts.some(h=>h.id==='claude-desktop'))throw Error('Select Claude in Claudian connections first.');
    await fs.access(profile.vault);
    const result=await require('./connector-package.cjs').writeDesktop(path.join(core.dataDir,'extensions'),{
      launcher:core.launcher,mcpScript:core.mcpScript,dataDir:core.dataDir,language:profile.language});
    clipboard.writeText(result.archive);
    shell.showItemInFolder(result.archive);
    return {archive:result.archive};
  });
  handle('connector:start',url=>remoteConnector.start(url));
  handle('connector:stop',()=>remoteConnector.stop());
  handle('connector:approve',(id,allowed)=>remoteConnector.approve(id,allowed===true));
  handle('connector:revoke',id=>remoteConnector.revoke(id));
  handle('connector:export',async provider=>{
    const status=remoteConnector.status(),url=status.urls[provider];
    if(!url)throw Error('Start the device connection before exporting its plugin.');
    const profile=(await core.snapshot()).profile;
    const result=await dialog.showOpenDialog(win,{title:'Save Claudian plugin',properties:['openDirectory','createDirectory']});
    if(result.canceled)return null;
    const target=result.filePaths[0];await assertOrdinaryPath(target);
    const exported=await require('./connector-package.cjs').write(target,{provider,url,language:profile.language});
    shell.showItemInFolder(exported.archive);return exported;
  });
  handle('connector:provider',async provider=>{
    const url={chatgpt:'https://chatgpt.com/plugins','claude-desktop':'https://claude.ai/customize/connectors'}[provider];
    if(!url)throw Error('Unknown provider');await shell.openExternal(url);return true;
  });
  handle('memory:self-check', () => core.selfCheck());
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
  handle('memory:open-app',async id=>{
    if(id==='codex'){
      const exe=await require('./scan.cjs').resolve(id);
      if(!exe||!/\.exe$/i.test(exe))throw Error('Codex desktop launcher was not found. Open Codex and paste the copied instruction.');
      await runFile(exe,['app',(await core.snapshot()).profile.vault],{windowsHide:true,timeout:15000});return true;
    }
    if(id==='chatgpt'){await shell.openExternal('https://chatgpt.com/');return true;}
    const local=process.env.LOCALAPPDATA||path.join(home,'AppData','Local');
    const candidates=['claude-code','claude-desktop'].includes(id)
      ?[path.join(local,'AnthropicClaude','claude.exe'),path.join(local,'Programs','Claude','Claude.exe')]
      :[path.join(local,'Programs',{'antigravity':'antigravity/Antigravity.exe','antigravity-cli':'antigravity/Antigravity.exe','cursor':'cursor/Cursor.exe'}[id]||'unavailable')];
    if(['claude-code','claude-desktop'].includes(id)){
      const command="Get-AppxPackage -Name Claude | Select-Object -First 1 -ExpandProperty InstallLocation";
      const result=await runFile('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,timeout:10000}).catch(()=>({stdout:''}));
      const location=result.stdout.trim();if(path.isAbsolute(location))candidates.push(path.join(location,'app','Claude.exe'));
    }
    for(const file of candidates){try{await fs.access(file);}catch{continue;}const message=await shell.openPath(file);if(message)throw Error(message);return true;}
    throw Error('The desktop application was not found. Open it manually and paste the copied instruction.');
  });
  handle('memory:scan-preview', async language => {
    const profile=(await core.snapshot()).profile;if(!profile)throw new Error('Memory is not configured.');
    const scan=require('./scan.cjs');return {prompt:scan.prompt({...profile,language:language==='tr'?'tr':'en'}),hosts:await Promise.all(profile.hosts.map(async h=>({...h,available:!!await scan.resolve(h.id,scanPaths.get(h.id))})))};
  });
  handle('memory:gemini-login',async()=>{
    const profile=(await core.snapshot()).profile;
    if(!profile)throw Error('Memory is not configured.');
    return require('./scan.cjs').launch(profile,'gemini-cli',null,undefined,true);
  });
  handle('memory:scan-send', async (id,prompt) => {
    const profile=(await core.snapshot()).profile;if(!profile)throw new Error('Memory is not configured.');
    return require('./scan.cjs').launch(profile,id,prompt,scanPaths.get(id));
  });
  handle('memory:review-start',async id=>{
    const profile=(await core.snapshot()).profile;
    const host=(await core.health()).hosts.find(h=>h.id===id);
    if(host?.state!=='verified')throw Error('Verify this connection before starting its review.');
    return require('./first-review.cjs').begin(core.dataDir,profile,id);
  });
  handle('memory:review-status',async id=>{
    const profile=(await core.snapshot()).profile;
    return require('./first-review.cjs').status(core.dataDir,profile.vault,id);
  });
  // Generated for the connection it is meant for: the sentence has to be true on that surface,
  // and it has to name the folder that was actually selected.
  handle('memory:trigger', async host => {
    const profile = (await core.snapshot()).profile;
    const connection = profile?.hosts.find(h => h.id === host);
    return require('./policy.cjs').memoryTrigger(profile?.language || (await core.preferences()).language,
      {vault: profile?.vault, server: connection?.artifacts?.server});
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
    await require('./setup-review.cjs').acknowledge(core.dataDir,installStamp);setupReview=false;
    win.setSize(940, 760); win.center(); win.setTitle('claudian.app');
    await win.loadURL(origin + '/index.html');
  });
  handle('app:folder', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Not klasörünü seç', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('setup:prepare', input => core.prepare(input));
  handle('setup:install', async (id, consent) => {
    const profile = await core.install(id, consent);
    // A setup that just finished is not a previous installation to review. Without this the
    // next launch opened "we found settings from your previous installation" straight after
    // the wizard, and applying there ran an install with no grant attached -- so the screen
    // answered "nothing is connected without approving these permissions" on a setup the user
    // had just approved. Measured 13.09.2026 on a first run.
    await require('./setup-review.cjs').acknowledge(core.dataDir, installStamp);
    setupReview = false;
    return profile;
  });
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
  const verificationWatches=new Map();
  handle('memory:verify-cancel', host => {verificationWatches.get(host)?.abort();return true;});
  handle('memory:verify-watch', async (host,requestId) => {
    verificationWatches.get(host)?.abort();
    const controller=new AbortController();verificationWatches.set(host,controller);
    try{return await core.watchVerification(host,event=>{
      if(win&&!win.isDestroyed())win.webContents.send('verify:event',{host,requestId,...event});
    },{signal:controller.signal});}
    finally{if(verificationWatches.get(host)===controller)verificationWatches.delete(host);}
  });
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
