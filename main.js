// main.js — Electron entry point. Boots the Express API inside the main
// process, then opens a BrowserWindow pointed at that local server.
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const { loadConfig, discoverLocalIp } = require('./src/core/config');
const { initDatabase, startAutoBackup } = require('./src/core/database');
const { buildApp } = require('./src/server/app');
const { setupMobileAccess, stopTunnel } = require('./src/server/tunnel');
const { getOrCreateCert } = require('./src/core/tls');

// ---- Portability: keep all runtime data NEXT TO the executable ----
// Moving the whole AssetTrack_Desktop folder to another PC just works.
const userDataPath = require('./src/core/paths').DATA_DIR;
if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

let mainWindow;
let server;
let httpsServer;

function startServer(config) {
  const expressApp = buildApp();

  server = expressApp.listen(config.port, '0.0.0.0', () => {
    console.log(`[AssetTrack] API + PWA host listening on http://0.0.0.0:${config.port}`);
  });

  // A second listener on the SAME Express app, but over HTTPS with a
  // self-signed LAN certificate (see core/tls.js) — this is what lets the
  // camera (getUserMedia) work for phones on the LAN with zero internet
  // access, since plain http:// never counts as a "secure context" no
  // matter what camera permission the phone grants. The Admin Hub window
  // itself keeps loading the plain http:// server above unchanged; only
  // the mobile-facing URL switches to this one (see setupMobileAccess).
  try {
    const { cert, key } = getOrCreateCert(userDataPath, config.localIp);
    httpsServer = https.createServer({ cert, key }, expressApp);
    httpsServer.listen(config.httpsPort, '0.0.0.0', () => {
      console.log(`[AssetTrack] Mobile HTTPS (self-signed) host listening on port ${config.httpsPort}`);
    });
    httpsServer.on('error', (err) => {
      require('./src/features/system/services').logEvent(
        'INIT', `Mobile HTTPS server failed to start (${err.message}) — camera access on LAN will not work until this is resolved.`, 'error'
      );
    });
  } catch (err) {
    require('./src/features/system/services').logEvent(
      'INIT', `Could not generate/load the self-signed certificate (${err.message}) — camera access on LAN will not work; the public tunnel (if enabled) is unaffected.`, 'error'
    );
  }

  setupMobileAccess(expressApp, config);
}

// Custom title bar (Windows/Linux): the native black title strip is hidden and
// only the minimize/maximize/close buttons stay, tinted to match whichever
// screen is showing. macOS keeps its normal traffic-light title bar.
const TITLEBAR_HEIGHT = 32; // keep in sync with #titlebar-drag in index.html and .screen-login padding
const TITLEBAR_THEMES = {
  login: { color: '#0F172A', symbolColor: '#F8F8FF' }, // Navy login stage (light window buttons)
  app:   { color: '#F8F8FF', symbolColor: '#0F172A' }  // Off-White page
};

function createWindow(config) {
  const customTitleBar = process.platform !== 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    center: true,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#F8F8FF',
    title: 'AssetTrack — Admin Hub',
    ...(customTitleBar && {
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...TITLEBAR_THEMES.login, height: TITLEBAR_HEIGHT }
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Electron (notably on Windows) leaves the window without keyboard focus after a native
  // alert()/confirm(): the page looks normal but no text box accepts typing until the window is
  // clicked away and back. The page asks for focus back after each such dialog (focus-fix.js),
  // and it is also restored whenever the window regains focus.
  ipcMain.removeAllListeners('assettrack:refocus');
  ipcMain.on('assettrack:refocus', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    win.blur();
    win.focus();
    win.webContents.focus();
  });
  mainWindow.on('focus', () => { if (!mainWindow.isDestroyed()) mainWindow.webContents.focus(); });

  // Drop Electron's default File/Edit/View/Window/Help menu bar (Windows/Linux;
  // no-op on macOS, which keeps its own app menu).
  mainWindow.removeMenu();

  // Re-tint the window buttons when the router switches between login and the app.
  if (customTitleBar) {
    mainWindow.webContents.on('did-navigate-in-page', (_e, url) => {
      const theme = /#\/login\b/.test(url) ? TITLEBAR_THEMES.login : TITLEBAR_THEMES.app;
      try { mainWindow.setTitleBarOverlay({ ...theme, height: TITLEBAR_HEIGHT }); } catch (_) { /* window closing */ }
    });
  }

  // Load from the same http:// origin the API is served on (see the
  // express.static() line in startServer) — NOT loadFile()/file://. This is
  // what makes every relative fetch('/api/v1/...') in the UI actually reach
  // the Express server instead of silently failing against the filesystem.
  //
  // The ?boot=<id> is new for every window we create. router.js compares it with
  // the id saved next to the login token and drops the token when they differ, so
  // quitting the app (or closing its window) always means the next launch opens
  // on the login screen.
  const bootId = crypto.randomBytes(8).toString('hex');
  mainWindow.loadURL(`http://127.0.0.1:${config.port}/?boot=${bootId}`);

  // Open external links (e.g. help docs) in the OS browser, not Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Is the always-on server (server.js) already running on this computer? Then this app must not start a
// second server on the same database — it just opens its window onto the running one.
function serverAlreadyRunning(port) {
  return new Promise((resolve) => {
    const req = require('http').get({ host: '127.0.0.1', port, path: '/api/v1/health', timeout: 1000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data).app === 'assettrack'); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

app.whenReady().then(async () => {
  const config = loadConfig(userDataPath);
  config.localIp = discoverLocalIp();

  if (await serverAlreadyRunning(config.port)) {
    createWindow(config);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(config); });
    return;
  }

  await initDatabase(userDataPath);
  require('./src/features/system/services').logEvent('INIT', 'AssetTrack Mainframe v2.4.1 starting...', 'info');

  startAutoBackup(userDataPath, config.backupIntervalHours);

  startServer(config);
  require('./src/features/system/services').logEvent('INIT', 'System boot complete. DATABASE online.', 'success');

  createWindow(config);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
  });
});

app.on('window-all-closed', () => {
  try { require('./src/core/database').getDb().persist(); } catch { /* db never initialized */ }
  if (server) server.close();
  if (httpsServer) httpsServer.close();
  stopTunnel();
  if (process.platform !== 'darwin') app.quit();
});
