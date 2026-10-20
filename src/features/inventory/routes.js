// features/inventory/routes.js — POST /api/v1/inventory/sync (mobile check-in).
const express = require('express');
const router = express.Router();
const svc = require('./services');
const { simplifyUserAgent } = require('../../core/device');
const { requireRole } = require('../../core/security');

// req.user comes from the requireAuth middleware in main.js (mounted on
// every /api/v1 route except /auth/login) and is decoded from a verified
// JWT — so username/source here are trustworthy, unlike a client-supplied
// "scanned_by" field in the request body, which anyone could type in.
// deviceName is parsed fresh from this request's own User-Agent header
// rather than the JWT, so it stays accurate even if the same phone is
// later used with a different browser without logging out.
function requestMeta(req) {
  return {
    scannedBy: req.user?.username || req.body?.scanned_by || 'unknown',
    source: req.user?.source || null,
    ip: req.ip,
    deviceName: simplifyUserAgent(req.headers['user-agent'])
  };
}

// One sync request from the phone: scans, edits and new-asset registrations
// (see recordSyncBatch). The list is still called `scans` for older phones.
router.post('/sync', (req, res) => {
  const { scans } = req.body || {};
  if (!Array.isArray(scans) || scans.length === 0) {
    return res.status(400).json({ ok: false, error: 'scans[] is required.' });
  }
  res.json(svc.recordSyncBatch(scans, requestMeta(req)));
});

// The phone asks what became of the registrations it sent (it knows them only by the
// ids it made itself). Open to the sender — any signed-in account — but each caller
// only ever gets answers for their own registrations.
router.post('/registrations/status', (req, res) => {
  res.json({ ok: true, registrations: svc.registrationStatuses((req.body || {}).uuids, req.user?.username) });
});

router.get('/progress', (req, res) => {
  res.json({ ok: true, rooms: svc.allRoomsProgress() });
});

router.get('/progress/:roomId', (req, res) => {
  res.json({ ok: true, progress: svc.roomProgress(req.params.roomId) });
});

router.get('/sync-log', (req, res) => {
  const limit = Number(req.query.limit) || 20;
  res.json({ ok: true, log: svc.syncLog(limit) });
});

router.get('/logs', (req, res) => {
  const limit = Number(req.query.limit) || 50;
  res.json({ ok: true, logs: svc.recentLogs(limit) });
});

router.post('/mark-scanned', (req, res) => {
  const { asset_id } = req.body || {};
  if (!asset_id) return res.status(400).json({ ok: false, error: 'asset_id is required.' });
  res.json(svc.markScanned(asset_id, requestMeta(req)));
});

router.post('/sync-session', (req, res) => {
  const meta = requestMeta(req);
  res.json(svc.recordSyncSession({
    ...req.body,
    scanned_by: meta.scannedBy,
    device_source: meta.source,
    device_ip: meta.ip,
    device_name: meta.deviceName
  }));
});

// Review queue: what phones send at sync waits here until the super admin
// verifies or rejects it (Inventory Sync screen). Super admin only.
//   registrations — a new asset      scans — an existing asset scanned / edited
router.get('/pending', requireRole('superadmin'), (req, res) => {
  res.json({ ok: true, ...svc.pendingQueue() });
});

router.get('/pending/count', requireRole('superadmin'), (req, res) => {
  res.json({ ok: true, ...svc.pendingCount() });
});

router.get('/pending/registrations/:id', requireRole('superadmin'), (req, res) => {
  const detail = svc.registrationDetail(req.params.id);
  if (!detail) return res.status(404).json({ ok: false, error: 'This registration was already handled.' });
  res.json({ ok: true, registration: detail });
});

router.get('/pending/scans/:id', requireRole('superadmin'), (req, res) => {
  const detail = svc.scanDetail(req.params.id);
  if (!detail) return res.status(404).json({ ok: false, error: 'This scan was already handled.' });
  res.json({ ok: true, scan: detail });
});

router.post('/pending/review', requireRole('superadmin'), (req, res) => {
  const result = svc.reviewPending(req.body || {}, req.user?.username);
  res.status(result.ok ? 200 : result.status || 400).json(result.ok ? result : { ok: false, error: result.error });
});

module.exports = router;
