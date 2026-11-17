// src/server/tunnel.js — optional public access (Cloudflare quick/named tunnel). Shared by main.js and server.js.
const fs = require('fs');

let namedTunnelProcess;

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

  const logEvent = require('../features/system/services').logEvent;
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

function stopTunnel() { if (namedTunnelProcess) namedTunnelProcess.kill(); }

module.exports = { setupMobileAccess, stopTunnel };
