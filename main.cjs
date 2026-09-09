'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { MemorySetup } = require('./core.cjs');
const smoke = process.argv.includes('--smoke');
if (smoke) app.setPath('userData', require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'claudian-smoke-profile-')));
if (smoke) app.disableHardwareAcceleration();
const origin = 'claudian://app';
let win, core;
protocol.registerSchemesAsPrivileged([{ scheme: 'claudian', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!smoke) app.setPath('userData', path.join(app.getPath('appData'), 'Claudian Desktop'));
if (!app.requestSingleInstanceLock({ smoke })) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
async function start() {
  let home = os.homedir();
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
  core = new MemorySetup({ home, dataDir: app.getPath('userData'), codexHome: !smoke && process.env.CODEX_HOME ? process.env.CODEX_HOME : path.join(home, '.codex'), emit: event => {
    if (win && !win.isDestroyed()) win.webContents.send('setup:event', event);
  } });
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
  handle('app:snapshot', () => core.snapshot());
  handle('app:preferences', language => core.preferences(language));
  handle('memory:connections', () => core.connections());
  handle('memory:check-files', () => core.checkFiles());
  handle('memory:remove', host => core.removeHost(host));
  handle('memory:configuration', async (host, kind) => {
    if (!['skill','rule'].includes(kind)) throw new Error('Invalid configuration type.');
    const profile = (await core.snapshot()).profile;
    const files = await core.hostPaths(profile,host);
    if (smoke) return files[kind];
    shell.showItemInFolder(files[kind]);
  });
  handle('memory:obsidian', async () => {
    const profile = (await core.snapshot()).profile;
    if (!profile) throw new Error('Memory is not configured.');
    const uri = 'obsidian://open?vault=' + encodeURIComponent(profile.vault);
    if (smoke) return uri;
    await shell.openExternal(uri);
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
  handle('memory:challenge', host => mutate(() => core.challenge(host)));
  handle('memory:verify', host => mutate(() => core.verify(host)));
  handle('app:copy', text => { if (typeof text !== 'string' || text.length > 5000) throw new Error('Geçersiz metin.'); clipboard.writeText(text); });
  handle('app:open', async kind => {
    const target = kind === 'logs' ? path.join(core.dataDir, 'logs') : kind === 'vault' ? (await core.snapshot()).profile?.vault : null;
    if (!target) throw new Error('Klasör henüz hazır değil.');
    if (smoke) return target;
    const error = await shell.openPath(target); if (error) throw new Error(error);
  });
  await win.loadURL(origin + (installed ? '/index.html' : '/setup.html'));
  if (smoke) await require('./smoke.cjs').run({ win, core, app, home });
  else win.show();
}
app.on('window-all-closed', () => app.quit());
