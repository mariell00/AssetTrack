// main.js — Electron entry point. Boots the Express API inside the main
// process, then opens a BrowserWindow pointed at that local server.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const express = require('express');
const fs = require('fs');

const { loadConfig, discoverLocalIp } = require('./src/core/config');
const { initDatabase, startAutoBackup } = require('./src/core/database');
const { requireAuth } = require('./src/core/security');

// ---- Portability: keep all runtime data NEXT TO the executable ----
// Moving the whole AssetTrack_Desktop folder to another PC just works.
const userDataPath = path.join(__dirname, 'data');
if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

let mainWindow;
let server;

function registerFeatureRoutes(expressApp) {
  // Each feature module owns its own routes.js — mounted here so the
  // architecture stays pluggable. Adding a feature = adding one require + use().
  expressApp.use('/api/v1/auth', require('./src/features/auth/routes'));
  expressApp.use('/api/v1/assets', require('./src/features/assets/routes'));
  expressApp.use('/api/v1/inventory', require('./src/features/inventory/routes'));
  expressApp.use('/api/v1/map', require('./src/features/mapping/routes'));
  expressApp.use('/api/v1/qr', require('./src/features/qr-distribution/routes'));
  expressApp.use('/api/v1/reports', require('./src/features/reports/routes'));
  expressApp.use('/api/v1/analytics', require('./src/features/analytics/routes'));
  expressApp.use('/api/v1/system', require('./src/features/system/routes'));
}

function startServer(config) {
  const expressApp = express();
  expressApp.use(express.json({ limit: '10mb' }));

  // The mobile PWA runs on the phone's own origin (its own IP/port context
  // in the browser) while talking to this server over the LAN, so it needs
  // permissive CORS — this is a closed office network, not a public API.
  expressApp.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Lightweight runtime counters feeding the QR Distribution "Network
  // Status" panel (requests/min, distinct clients on the LAN).
  expressApp.use((req, res, next) => {
    require('./src/features/system/services').trackRequest(req.ip);
    next();
  });

  // Require a valid, verified session token on every API route except the
  // login endpoint itself (which is how you GET a token in the first
  // place). Previously nothing enforced this server-side — the frontend
  // attached a Bearer token, but no route ever checked it, so the entire
  // API (desktop and mobile) was reachable by anyone who could reach the
  // port, no login needed. This matters even more now that the server can
  // optionally be exposed to the public internet (see setupMobileAccess).
  expressApp.use('/api/v1', (req, res, next) => {
    if (req.path === '/auth/login') return next();
    return requireAuth(req, res, next);
  });

  registerFeatureRoutes(expressApp);

  // Serve the renderer UI itself from this same server (instead of loading
  // it via file://). This is what makes every fetch('/api/v1/...') call in
  // the UI actually reach this server — a relative fetch from a file://
  // page does NOT resolve to http://localhost:PORT, so buttons would look
  // like they do nothing (the request silently fails). Serving everything
  // from one http:// origin keeps API calls same-origin and working.
  expressApp.use(express.static(path.join(__dirname, 'src/renderer')));

  // The renderer's router.js imports each feature's ui.js straight from
  // src/features/**  (e.g. `import ... from '../../features/auth/ui.js'`),
  // but that folder lives outside src/renderer, so it was never reachable
  // over HTTP — every feature module 404'd, the whole ES module graph
  // failed to load, and #app never updated on ANY nav click. Serving
  // src/features under /features makes those imports resolve.
  expressApp.use('/features', express.static(path.join(__dirname, 'src/features')));

  // Static hosting: offline map tiles + the mobile PWA bundle
  expressApp.use('/static/map_tiles', express.static(path.join(__dirname, 'src/static/map_tiles')));
  expressApp.use('/static/mobile', express.static(path.join(__dirname, 'src/static/mobile')));

  server = expressApp.listen(config.port, '0.0.0.0', () => {
    console.log(`[AssetTrack] API + PWA host listening on port ${config.port}`);
  });

  setupMobileAccess(expressApp, config);
}

// Decides what URL the QR Distribution screen encodes for mobile access.
// Default (and always the immediate fallback): the desktop's LAN IP — only
// reachable if the phone is on the same WiFi, which is the constraint we're
// trying to lift.
//
// If settings.json has publicAccess.enabled = true, this additionally opens
// a Cloudflare "quick tunnel" (via the `cloudflared` package — no account or
// domain required) that maps a random https://*.trycloudflare.com URL to
// this local server. Once that URL is live, the QR code switches to it, and
// the phone can reach the mobile app over ANY internet connection, not just
// this network. The tunnel URL is stored on expressApp.locals so the
// /api/v1/qr/code route can read whichever is current.
//
// This is deliberately opt-in and off by default: it makes the API (now
// protected by requireAuth, see startServer) reachable from the public
// internet, and that's a real change in exposure worth an explicit choice
// rather than a silent default.
async function setupMobileAccess(expressApp, config) {
  const lanUrl = `http://${config.localIp}:${config.port}`;
  expressApp.locals.mobileBaseUrl = lanUrl;
  expressApp.locals.mobileAccessMode = 'lan';
  expressApp.locals.tunnelStarting = false;

  if (!config.publicAccess || !config.publicAccess.enabled) return;

  const logEvent = require('./src/features/system/services').logEvent;
  expressApp.locals.tunnelStarting = true;

  try {
    const { bin, install, Tunnel } = require('cloudflared');

    if (!fs.existsSync(bin)) {
      logEvent('TUNNEL', 'Downloading cloudflared (first run only)...', 'info');
      await install(bin);
    }

    const tunnel = Tunnel.quick(`http://127.0.0.1:${config.port}`);
    tunnel.on('error', (err) => {
      logEvent('TUNNEL', `Tunnel process error: ${err.message}`, 'error');
    });
    tunnel.on('exit', (code) => {
      if (expressApp.locals.mobileAccessMode === 'public') {
        logEvent('TUNNEL', `Tunnel process exited (code ${code}) — falling back to LAN-only access.`, 'error');
        expressApp.locals.mobileBaseUrl = lanUrl;
        expressApp.locals.mobileAccessMode = 'lan';
      }
    });

    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for tunnel URL (30s)')), 30000);
      tunnel.once('url', (u) => { clearTimeout(timer); resolve(u); });
    });

    expressApp.locals.mobileBaseUrl = url;
    expressApp.locals.mobileAccessMode = 'public';
    expressApp.locals.tunnelStarting = false;
    logEvent('TUNNEL', `Public access ready: ${url}`, 'success');
  } catch (err) {
    expressApp.locals.tunnelStarting = false;
    logEvent('TUNNEL', `Could not start public tunnel (${err.message}) — QR code will use the LAN address instead.`, 'error');
    // mobileBaseUrl/mode were already set to the LAN fallback above.
  }
}

function createWindow(config) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111844',
    title: 'AssetTrack — Admin Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load from the same http:// origin the API is served on (see the
  // express.static() line in startServer) — NOT loadFile()/file://. This is
  // what makes every relative fetch('/api/v1/...') in the UI actually reach
  // the Express server instead of silently failing against the filesystem.
  mainWindow.loadURL(`http://127.0.0.1:${config.port}/`);

  // Open external links (e.g. help docs) in the OS browser, not Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  const config = loadConfig(userDataPath);
  config.localIp = discoverLocalIp();

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
  if (process.platform !== 'darwin') app.quit();
});
