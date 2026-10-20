// features/assets/routes.js — GET /api/v1/assets, POST /api/v1/assets/import, etc.
const express = require('express');
const router = express.Router();
const svc = require('./services');
const { requireRole } = require('../../core/security');

// A taken Asset Tag is a user mistake, not a server fault — answer with a
// readable 409 instead of letting the UNIQUE error become an HTML 500.
function duplicateTag(err, res, tag) {
  if (/UNIQUE/i.test(err && err.message)) {
    res.status(409).json({ ok: false, error: `The asset tag “${tag}” is already registered.` });
    return true;
  }
  return false;
}

function mobileMeta(req) {
  const { simplifyUserAgent } = require('../../core/device');
  return { scannedBy: req.user?.username, source: 'mobile', ip: req.ip, deviceName: simplifyUserAgent(req.headers['user-agent']) };
}

router.get('/', (req, res) => {
  const { roomId, search, lite } = req.query;
  let assets = svc.listAssets({ roomId, search });
  // ?lite=1 (the mobile Asset Registry list) leaves out the base64 photos,
  // which make up nearly all of this payload and aren't shown in a list.
  if (lite) assets = assets.map(({ photo, assigned_photo, ...rest }) => rest);
  res.json({ ok: true, assets });
});

router.get('/dashboard-stats', (req, res) => {
  res.json({ ok: true, stats: svc.dashboardStats() });
});

router.get('/:id', (req, res) => {
  const asset = svc.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ ok: false, error: 'Asset not found.' });
  res.json({ ok: true, asset });
});

router.post('/', (req, res) => {
  // asset_tag is optional: when it's missing the server generates the Asset ID.
  if (!req.body.name) {
    return res.status(400).json({ ok: false, error: 'name is required.' });
  }
  // From the mobile app a registration is never added directly: it waits in the
  // Inventory Sync review queue until the super admin verifies it.
  if (req.user?.source === 'mobile') {
    const queued = require('../inventory/services').queueMobileRegistration(req.body, mobileMeta(req));
    return res.status(queued.ok ? 202 : queued.status || 400).json(queued.ok ? queued : { ok: false, error: queued.error });
  }
  let asset;
  try {
    asset = svc.createAsset(req.body);
  } catch (err) {
    if (duplicateTag(err, res, req.body.asset_tag)) return;
    throw err;
  }
  // Registered from the desktop app (the database itself) = verified on the
  // spot: it gets a "verified" scan so it counts on the Dashboard right away.
  // Assets registered from the mobile app are NOT auto-verified. Staff scan
  // them and the super admin verifies that scan in Inventory Sync.
  if (req.user?.source !== 'mobile') {
    require('../inventory/services').markScanned(asset.id, {
      scannedBy: req.user?.username || 'unknown',
      source: 'desktop',
      ip: req.ip,
      deviceName: 'Admin Hub'
    });
  }
  res.status(201).json({ ok: true, asset });
});

router.put('/:id', (req, res) => {
  // Likewise a phone's edit is proposed, not applied: the super admin confirms it first.
  if (req.user?.source === 'mobile') {
    const queued = require('../inventory/services').queueMobileEdit(req.params.id, req.body, mobileMeta(req));
    return res.status(queued.ok ? 202 : queued.status || 400).json(queued.ok ? queued : { ok: false, error: queued.error });
  }
  let updated;
  try {
    updated = svc.updateAsset(req.params.id, req.body);
  } catch (err) {
    if (duplicateTag(err, res, req.body.asset_tag)) return;
    throw err;
  }
  if (!updated) return res.status(404).json({ ok: false, error: 'Asset not found.' });
  res.json({ ok: true, asset: updated });
});

// Deleting assets and bulk import are desktop (superadmin) actions; admins on
// the mobile app can register and edit assets but not remove them.
router.delete('/:id', requireRole('superadmin'), (req, res) => {
  res.json(svc.deleteAsset(req.params.id));
});

// Looked up by the mobile Scan screen right after a QR read, so admins can
// pull up and edit the asset's details on the spot — QR labels encode the
// Asset Tag (see generateAssetQrDataUrl below), not the numeric id.
router.get('/by-tag/:tag', (req, res) => {
  const asset = svc.findAssetByTag(req.params.tag);
  if (!asset) return res.status(404).json({ ok: false, error: 'No asset registered with this tag.' });
  const detail = svc.getAssetDetail(asset.id);
  res.json({ ok: true, asset: detail });
});

router.get('/:id/detail', (req, res) => {
  const detail = svc.getAssetDetail(req.params.id);
  if (!detail) return res.status(404).json({ ok: false, error: 'Asset not found.' });
  res.json({ ok: true, asset: detail });
});

// Printable QR label for one asset — encodes the Asset Tag, which the
// mobile Scan screen already matches against on sync (see
// features/inventory/services.js). Called right after registering a new
// asset, and available any time from the row's QR button to reprint a
// lost/damaged label.
router.get('/:id/qr', async (req, res) => {
  const asset = svc.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ ok: false, error: 'Asset not found.' });
  const dataUrl = await svc.generateAssetQrDataUrl(asset.asset_tag);
  res.json({ ok: true, asset_tag: asset.asset_tag, name: asset.name, dataUrl });
});

router.post('/:id/report-issue', (req, res) => {
  const { note, reported_by } = req.body || {};
  if (!note) return res.status(400).json({ ok: false, error: 'note is required.' });
  res.status(201).json({ ok: true, issue: svc.reportIssue(req.params.id, note, reported_by) });
});

// Bulk import: expects raw .xlsx bytes as the request body
// (Content-Type: application/octet-stream).
router.post('/import', requireRole('superadmin'), express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  try {
    const result = svc.importFromExcelBuffer(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: 'Import failed: ' + err.message });
  }
});

module.exports = router;
