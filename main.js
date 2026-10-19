// main.js — Electron entry point. Boots the Express API inside the main
// process, then opens a BrowserWindow pointed at that local server.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const express = require('express');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const { loadConfig, discoverLocalIp } = require('./src/core/config');
const { initDatabase, startAutoBackup } = require('./src/core/database');
const { requireAuth } = require('./src/core/security');
const { getOrCreateCert } = require('./src/core/tls');

// ---- Portability: keep all runtime data NEXT TO the executable ----
// Moving the whole AssetTrack_Desktop folder to another PC just works.
const userDataPath = require('./src/core/paths').DATA_DIR;
if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

let mainWindow;
let server;
let httpsServer;
let namedTunnelProcess;

function registerFeatureRoutes(expressApp) {
  // Each feature module owns its own routes.js — mounted here so the
  // architecture stays pluggable. Adding a feature = adding one require + use().
  expressApp.use('/api/v1/auth', require('./src/features/auth/routes'));
  expressApp.use('/api/v1/assets', require('./src/features/assets/routes'));
  expressApp.use('/api/v1/assignees', require('./src/features/assignees/routes'));
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Type');
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
  // The two recovery endpoints are also token-free (you're locked out), but
  // auth/routes.js restricts them to this computer's own Admin Hub window.
  const PUBLIC_API_PATHS = new Set(['/auth/login', '/auth/recovery/request', '/auth/recovery/reset']);
  expressApp.use('/api/v1', (req, res, next) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
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

// Decides what URL the QR Distribution screen encodes for mobile access.
// Default (and always the immediate fallback): the desktop's LAN IP over
// the self-signed HTTPS listener (see startServer/core/tls.js) — only
// reachable if the phone is on the same WiFi, but unlike a plain http://
// LAN address, this one IS a secure context, so the camera/QR scanner
// works even with zero internet access on this machine.
//
// If settings.json has publicAccess.enabled = true, this additionally opens
// a Cloudflare tunnel so the phone can reach the mobile app over ANY
// internet connection, not just this network, with a properly-trusted
// certificate (no browser warning). Two modes, chosen by publicAccess.mode:
//
//   "quick" (default) — a Cloudflare "quick tunnel" (via the `cloudflared`
//   package — no account or domain required) that maps a random
//   https://*.trycloudflare.com URL to this local server. Simplest to turn
//   on, but that random URL is reassigned every time the app restarts,
//   which means every phone that already logged in (see mobile's
//   core/api-client.js, which caches the URL) silently starts failing with
//   "No connection to desktop host" until someone updates it from the
//   mobile app's SYNC screen.
//
//   "named" — a Cloudflare Tunnel created once in the Cloudflare Zero Trust
//   dashboard (Networks > Tunnels), with a public hostname on your own
//   domain (e.g. assettrack.yourdomain.com) mapped to this local server.
//   That hostname never changes across restarts, so phones stay connected
//   permanently. Requires a free Cloudflare account + a domain added to it,
//   plus the run token from the dashboard's connector install step, stored
//   in settings.json under publicAccess.namedTunnel.{token,hostname}.
//
// Either way, the resulting URL is stored on expressApp.locals so the
// /api/v1/qr/code route can read whichever is current.
//
// This is deliberately opt-in and off by default: it makes the API (now
// protected by requireAuth, see startServer) reachable from the public
// internet, and that's a real change in exposure worth an explicit choice
// rather than a silent default.
async function setupMobileAccess(expressApp, config) {
  const lanUrl = `https://${config.localIp}:${config.httpsPort}`;
  expressApp.locals.mobileBaseUrl = lanUrl;
  expressApp.locals.mobileAccessMode = 'lan';
  expressApp.locals.tunnelStarting = false;

  if (!config.publicAccess || !config.publicAccess.enabled) return;

  const logEvent = require('./src/features/system/services').logEvent;
  const mode = config.publicAccess.mode || 'quick';

  if (mode === 'named') {
    return setupNamedTunnel(expressApp, config, lanUrl, logEvent);
  }
  return setupQuickTunnel(expressApp, config, lanUrl, logEvent);
}

async function setupQuickTunnel(expressApp, config, lanUrl, logEvent) {
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

// Runs `cloudflared tunnel run --token <token>` directly (bypassing the
// `cloudflared` package's Tunnel.quick() helper, which only knows how to
// start random quick tunnels) — this is the exact command Cloudflare's own
// dashboard shows you after creating a named tunnel and adding a public
// hostname to it. The hostname itself is fixed at creation time in the
// dashboard, so unlike the quick tunnel we already know the final URL
// up front from settings.json rather than needing to wait for one to be
// assigned.
async function setupNamedTunnel(expressApp, config, lanUrl, logEvent) {
  const { token, hostname } = (config.publicAccess && config.publicAccess.namedTunnel) || {};
  if (!token || !hostname) {
    logEvent(
      'TUNNEL',
      'publicAccess.mode is "named" but settings.json is missing publicAccess.namedTunnel.token and/or .hostname — falling back to LAN-only access.',
      'error'
    );
    return;
  }

  expressApp.locals.tunnelStarting = true;

  try {
    const { bin, install } = require('cloudflared');
    if (!fs.existsSync(bin)) {
      logEvent('TUNNEL', 'Downloading cloudflared (first run only)...', 'info');
      await install(bin);
    }

    const { spawn } = require('child_process');
    const proc = spawn(bin, ['tunnel', 'run', '--token', token], { stdio: ['ignore', 'pipe', 'pipe'] });
    namedTunnelProcess = proc;

    let connected = false;
    const markConnected = () => {
      if (connected) return;
      connected = true;
      expressApp.locals.mobileBaseUrl = `https://${hostname}`;
      expressApp.locals.mobileAccessMode = 'public';
      expressApp.locals.tunnelStarting = false;
      logEvent('TUNNEL', `Public access ready: https://${hostname}`, 'success');
    };

    // cloudflared logs a "Registered tunnel connection" line once it's
    // actually live — that's the same "it's ready" signal the quick tunnel
    // gets from its 'url' event. A fallback timeout below covers older/newer
    // cloudflared builds that phrase that log line differently, so a wording
    // change upstream doesn't leave the QR code stuck on "starting" forever.
    const watchForConnection = (chunk) => {
      if (/registered tunnel connection/i.test(chunk.toString())) markConnected();
    };
    proc.stdout.on('data', watchForConnection);
    proc.stderr.on('data', watchForConnection);
    const fallbackTimer = setTimeout(markConnected, 8000);

    proc.on('error', (err) => {
      clearTimeout(fallbackTimer);
      expressApp.locals.tunnelStarting = false;
      logEvent('TUNNEL', `Named tunnel process error: ${err.message}`, 'error');
    });
    proc.on('exit', (code) => {
      clearTimeout(fallbackTimer);
      if (expressApp.locals.mobileAccessMode === 'public' || expressApp.locals.tunnelStarting) {
        logEvent('TUNNEL', `Named tunnel process exited (code ${code}) — falling back to LAN-only access.`, 'error');
        expressApp.locals.mobileBaseUrl = lanUrl;
        expressApp.locals.mobileAccessMode = 'lan';
        expressApp.locals.tunnelStarting = false;
      }
      namedTunnelProcess = null;
    });
  } catch (err) {
    expressApp.locals.tunnelStarting = false;
    logEvent('TUNNEL', `Could not start named tunnel (${err.message}) — QR code will use the LAN address instead.`, 'error');
  }
}

// Custom title bar (Windows/Linux): the native black title strip is hidden and
// only the minimize/maximize/close buttons stay, tinted to match whichever
// screen is showing. macOS keeps its normal traffic-light title bar.
const TITLEBAR_HEIGHT = 32; // keep in sync with #titlebar-drag in index.html and .screen-login padding
const TITLEBAR_THEMES = {
  login: { color: '#060F26', symbolColor: '#FFFFFF' }, // navy login stage
  app:   { color: '#060F26', symbolColor: '#FFFFFF' }  // navy app stage (matches the login)
};

function createWindow(config) {
  const customTitleBar = process.platform !== 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    center: true,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#060F26',
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
  if (httpsServer) httpsServer.close();
  if (namedTunnelProcess) namedTunnelProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
