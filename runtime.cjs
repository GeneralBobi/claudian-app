'use strict';
/**
 * Background runtime — Claudian without a window.
 *
 * Until now closing the window quit the application, which stopped the device connection with
 * it. Every AI connection Claudian had installed went dark the moment the person closed a
 * window they had no further use for, and nothing said so: the connectors kept their saved
 * app, their grant and their URL, and simply stopped answering. The only cure was to notice
 * and reopen a desktop application whose whole purpose is to not need attention.
 *
 * Three small things fix that, and nothing here is a service architecture:
 *
 *   tray        the application keeps running with its window closed, and the person can see
 *               that it is running and what state it is in
 *   hide-close  closing the window hides it instead of quitting; Quit is explicit
 *   auto-start  opt-in, off by default, a login item rather than a scheduled task
 *
 * This tray does not start the legacy web Core. main.cjs separately owns an opt-in
 * personal OpenAI Secure MCP Tunnel through secure-tunnel.cjs.
 */
const path = require('node:path');

const LABEL = 'Claudian';

// A tray tooltip is read at a glance or not at all. One line, current state, no history.
// It reports what needs the person first and the connection second, because a tooltip that
// says "online" while three things are waiting is technically true and practically useless.
function summary(state, language, waiting = 0) {
  const tr = language === 'tr';
  if (waiting > 0) return LABEL + ' — ' + (tr
    ? `${waiting} iş seni bekliyor`
    : `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} you`);
  const line = {
    online: tr ? 'Cihaz bağlantısı açık' : 'Device connection online',
    connecting: tr ? 'Cihaz bağlantısı kuruluyor' : 'Device connection starting',
    offline: tr ? 'Cihaz bağlantısı kopuk' : 'Device connection offline',
    stopped: tr ? 'Cihaz bağlantısı kapalı' : 'Device connection off',
  }[state] || (tr ? 'Hazır' : 'Ready');
  return LABEL + ' — ' + line;
}

/**
 * @param {object} deps
 * @param {import('electron').App} deps.app
 * @param {import('electron').BrowserWindow} deps.win
 * @param {() => object} deps.status          current connector status
 * @param {() => Promise<string>} deps.language
 * @param {(value:boolean)=>Promise<void>} deps.setAutoStart
 * @param {()=>boolean} deps.autoStart
 */
function attach({ app, Tray, Menu, nativeImage, win, status, state, language, setAutoStart, autoStart,
  notifications, setNotifications }) {
  let tray = null, quitting = false, lastTooltip = '', refreshPreferences = null;
  // Set by the caller when a preference has to be re-read from disk before the menu is drawn.
  const onBeforeRebuild = fn => { refreshPreferences = fn; };

  // Quit has to stay reachable and unambiguous. Everything else hides.
  const quit = () => { quitting = true; app.quit(); };
  const show = () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); };

  async function rebuild() {
    if (!tray) return;
    const lang = await language().catch(() => 'en');
    // Read once per rebuild rather than per menu item: the menu is rebuilt on a timer.
    await refreshPreferences?.().catch(() => {});
    const tr = lang === 'tr';
    const s = (() => { try { return status() || {}; } catch { return {}; } })();
    const derived = (() => { try { return state?.() || null; } catch { return null; } })();
    const waiting = derived?.attention?.length || 0;
    const tooltip = summary(s.state, lang, waiting);
    if (tooltip !== lastTooltip) { tray.setToolTip(tooltip); lastTooltip = tooltip; }
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: tooltip, enabled: false },
      ...(waiting ? derived.attention.slice(0, 5).map(a => ({
        label: '  ' + (a.label ? a.label + ' — ' : '') + describe(a.kind, lang),
        click: show,
      })) : []),
      { type: 'separator' },
      { label: tr ? 'Claudian’ı aç' : 'Open Claudian', click: show },
      {
        label: tr ? 'Windows açılışında başlat' : 'Start with Windows',
        type: 'checkbox',
        checked: autoStart(),
        click: async item => { await setAutoStart(item.checked).catch(() => {}); await rebuild(); },
      },
      {
        label: tr ? 'Bildirimler' : 'Notifications',
        type: 'checkbox',
        checked: notifications ? notifications() : true,
        click: async item => { await setNotifications?.(item.checked).catch(() => {}); await rebuild(); },
      },
      { type: 'separator' },
      { label: tr ? 'Claudian’dan çık' : 'Quit Claudian', click: quit },
    ]));
  }

  function start() {
    if (tray) return tray;
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.ico'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.on('click', show);
    tray.on('double-click', show);
    void rebuild();
    // The tray is the only place a closed-window Claudian can report itself, so it follows
    // the connection rather than the last time someone opened a menu.
    setInterval(() => void rebuild(), 20000).unref?.();
    return tray;
  }

  // Closing the window is not quitting. It was, and that is why connections died quietly.
  function onClose(event) {
    if (quitting) return false;
    event.preventDefault();
    win.hide();
    return true;
  }

  return { start, rebuild, onClose, quit, onBeforeRebuild, isQuitting: () => quitting, summary };
}

// One short phrase per kind of attention. No sentence has to be assembled by a model, and
// nothing here describes anything the application has not derived from its own files.
function describe(kind, language) {
  const tr = language === 'tr';
  return {
    setup_incomplete: tr ? 'kurulum tamamlanmadı' : 'setup incomplete',
    connector_offline: tr ? 'cihaz bağlantısı kopuk' : 'device connection offline',
    verification_pending: tr ? 'erişim doğrulanmadı' : 'access not verified',
    verification_stale: tr ? 'doğrulama eskidi' : 'verification is stale',
    authorization_waiting: tr ? 'izin onayı bekliyor' : 'authorization waiting',
    first_review_rejected: tr ? 'rapor geri çevrildi' : 'report was refused',
    first_review_failed: tr ? 'ilk tarama başarısız' : 'first review failed',
    first_review_expired: tr ? 'ilk tarama süresi doldu' : 'first review expired',
    first_review_stale: tr ? 'ilk tarama eskidi' : 'first review is stale',
    first_review_superseded: tr ? 'ilk tarama yenilenmeli' : 'first review must be run again',
    first_review_needs_input: tr ? 'yanıtın gerekiyor' : 'your answer is needed',
    connection_broken: tr ? 'bağlantı bozuk' : 'connection is broken',
    verification_unfinished: tr ? 'doğrulama yarım kaldı' : 'verification was left unfinished',
    reminder_due: tr ? 'bugün' : 'due today',
    reminder_overdue: tr ? 'tarihi geçti' : 'past due',
  }[kind] || kind;
}

module.exports = { attach, summary, describe, LABEL };
