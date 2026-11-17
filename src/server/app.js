// src/server/app.js — builds the Express app (API, auth gate, static hosting). Shared by the Electron
// app (main.js) and the headless always-on server (server.js), so both serve the exact same thing.
const express = require('express');
const path = require('path');
const { requireAuth } = require('../core/security');

const ROOT = path.join(__dirname, '..', '..');

function registerFeatureRoutes(expressApp) {
  // Each feature module owns its own routes.js — mounted here so the
  // architecture stays pluggable. Adding a feature = adding one require + use().
  expressApp.use('/api/v1/auth', require('../features/auth/routes'));
  expressApp.use('/api/v1/assets', require('../features/assets/routes'));
  expressApp.use('/api/v1/assignees', require('../features/assignees/routes'));
  expressApp.use('/api/v1/specs', require('../features/specs/routes'));
  expressApp.use('/api/v1/inventory', require('../features/inventory/routes'));
  expressApp.use('/api/v1/map', require('../features/mapping/routes'));
  expressApp.use('/api/v1/qr', require('../features/qr-distribution/routes'));
  expressApp.use('/api/v1/reports', require('../features/reports/routes'));
  expressApp.use('/api/v1/analytics', require('../features/analytics/routes'));
  expressApp.use('/api/v1/system', require('../features/system/routes'));
}

function buildApp() {
  const expressApp = express();
  expressApp.disable('x-powered-by'); // don't announce the framework

  // Baseline security headers on every response.
  expressApp.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store'); // never cache API answers
    next();
  });

  // Behind a reverse proxy (nginx, Caddy…) set ASSETTRACK_TRUST_PROXY=1 so req.ip is the real client.
  if (process.env.ASSETTRACK_TRUST_PROXY) expressApp.set('trust proxy', process.env.ASSETTRACK_TRUST_PROXY === '1' ? 1 : process.env.ASSETTRACK_TRUST_PROXY);

  // Public liveness probe (no data): used by deploy health checks and by the Electron app to detect a running server.
  expressApp.get('/api/v1/health', (req, res) => res.json({ ok: true, app: 'assettrack' }));

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
    require('../features/system/services').trackRequest(req.ip);
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
    return requireAuth(req, res, () => {
      // The browser-based admin web app can't change data directly: writes are refused here, for every
      // feature at once. The one exception is proposing an asset edit, which only enters the review queue.
      const proposesEdit = req.method === 'PUT' && /^\/assets\/\d+$/.test(req.path);
      if (req.user.source === 'web' && !['GET', 'HEAD'].includes(req.method) && !proposesEdit) {
        return res.status(403).json({ ok: false, error: 'The web app can only view data and propose asset edits for the super admin to verify.' });
      }
      next();
    });
  });

  registerFeatureRoutes(expressApp);

  // Serve the renderer UI itself from this same server (instead of loading
  // it via file://). This is what makes every fetch('/api/v1/...') call in
  // the UI actually reach this server — a relative fetch from a file://
  // page does NOT resolve to http://localhost:PORT, so buttons would look
  // like they do nothing (the request silently fails). Serving everything
  // from one http:// origin keeps API calls same-origin and working.
  expressApp.use(express.static(path.join(ROOT, 'src/renderer')));

  // The renderer's router.js imports each feature's ui.js straight from
  // src/features/**  (e.g. `import ... from '../../features/auth/ui.js'`),
  // but that folder lives outside src/renderer, so it was never reachable
  // over HTTP — every feature module 404'd, the whole ES module graph
  // failed to load, and #app never updated on ANY nav click. Serving
  // src/features under /features makes those imports resolve.
  // Only the browser-side files (ui*.js) are served. The same folders also hold the server's own
  // code (services.js, models.js, routes.js, SQL seeds) which must never be downloadable.
  expressApp.use('/features', (req, res, next) => {
    if (!/^\/[a-z-]+\/ui[a-z-]*\.js$/.test(req.path)) return res.status(404).end();
    next();
  }, express.static(path.join(ROOT, 'src/features'), { dotfiles: 'deny', index: false }));

  // Anything that goes wrong inside a route answers with a plain message — never a stack trace,
  // file path or SQL text, which would help an attacker.
  expressApp.use('/api', (err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error('[AssetTrack] route error:', err);
    if (res.headersSent) return next(err);
    res.status(err && err.status >= 400 && err.status < 500 ? err.status : 500)
      .json({ ok: false, error: err && err.status >= 400 && err.status < 500 && err.expose ? err.message : 'Something went wrong on the server.' });
  });

  // Static hosting: offline map tiles + the mobile PWA bundle
  expressApp.use('/static/map_tiles', express.static(path.join(ROOT, 'src/static/map_tiles')));
  expressApp.use('/static/mobile', express.static(path.join(ROOT, 'src/static/mobile')));
  // The admin web app (browser, any computer) — its own client, separate from the phone PWA.
  expressApp.use('/admin', express.static(path.join(ROOT, 'web'), { dotfiles: 'deny' }));

  return expressApp;
}

module.exports = { buildApp };
