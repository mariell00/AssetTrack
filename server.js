// server.js — headless, always-on AssetTrack server (no Electron window).
//
// Runs the same API as the desktop app and hosts the admin web app (/admin/) and the mobile PWA
// (/static/mobile/). Start it on the always-on computer that holds the data:
//     npm run serve            (keep it alive with PM2, a Windows service, or systemd)
//
// The super admin's Electron app, opened on this same computer, detects this server and becomes a
// window onto it (see main.js) — so there is one database and one server, never two.
//
// Environment (all optional):
//   PORT                       HTTP port (default: settings.json "port")
//   ASSETTRACK_PUBLIC_URL      the public https address when you sit behind your own reverse proxy / domain;
//                              the QR screen then hands out this instead of the LAN address
//   ASSETTRACK_TRUST_PROXY=1   set when behind a reverse proxy so client IPs are real
//   ASSETTRACK_NO_HTTPS=1      skip the self-signed LAN HTTPS listener
//   ASSETTRACK_ADMIN_PASSWORD  first-run super admin password (otherwise written to data/first-login.txt)
const fs = require('fs');
const https = require('https');

const { loadConfig, discoverLocalIp } = require('./src/core/config');
const { DATA_DIR } = require('./src/core/paths');
const { initDatabase, startAutoBackup, getDb } = require('./src/core/database');
const { getOrCreateCert } = require('./src/core/tls');
const { buildApp } = require('./src/server/app');
const { setupMobileAccess, stopTunnel } = require('./src/server/tunnel');

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const config = loadConfig();
  config.localIp = discoverLocalIp();
  if (process.env.PORT) config.port = Number(process.env.PORT);

  await initDatabase(DATA_DIR);
  const { logEvent } = require('./src/features/system/services');
  logEvent('INIT', 'AssetTrack headless server starting...', 'info');
  startAutoBackup(DATA_DIR, config.backupIntervalHours);

  const app = buildApp();
  const http = app.listen(config.port, '0.0.0.0', () => console.log(`[AssetTrack] Server listening on http://0.0.0.0:${config.port}  (admin web app: /admin/)`));
  http.on('error', (err) => { console.error(`[AssetTrack] Cannot listen on port ${config.port}: ${err.message}`); process.exit(1); });

  let httpsServer;
  if (!process.env.ASSETTRACK_NO_HTTPS) {
    try {
      const { cert, key } = getOrCreateCert(DATA_DIR, config.localIp);
      httpsServer = https.createServer({ cert, key }, app).listen(config.httpsPort, '0.0.0.0',
        () => console.log(`[AssetTrack] LAN HTTPS (self-signed) on port ${config.httpsPort}`));
      httpsServer.on('error', (err) => logEvent('INIT', `LAN HTTPS failed to start (${err.message}).`, 'error'));
    } catch (err) {
      logEvent('INIT', `Could not set up the LAN certificate (${err.message}).`, 'error');
    }
  }

  await setupMobileAccess(app, config);
  const publicUrl = (process.env.ASSETTRACK_PUBLIC_URL || '').replace(/\/$/, '');
  if (publicUrl) { app.locals.mobileBaseUrl = publicUrl; app.locals.mobileAccessMode = 'public'; }
  logEvent('INIT', 'Headless server online. DATABASE online.', 'success');
  const base = (app.locals.mobileBaseUrl || `http://${config.localIp}:${config.port}`).replace(/\/$/, '');
  console.log(`[AssetTrack] Share this admin web app link (${app.locals.mobileAccessMode || 'lan'} access): ${base}/admin/`);

  const shutdown = () => {
    try { getDb().persist(); } catch { /* nothing to save */ }
    stopTunnel(); http.close(); if (httpsServer) httpsServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error('[AssetTrack] Fatal:', err); process.exit(1); });
