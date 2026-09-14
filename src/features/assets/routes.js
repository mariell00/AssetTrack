// features/assets/routes.js — GET /api/v1/assets, POST /api/v1/assets/import, etc.
const express = require('express');
const router = express.Router();
const svc = require('./services');

router.get('/', (req, res) => {
  const { roomId, search } = req.query;
  res.json({ ok: true, assets: svc.listAssets({ roomId, search }) });
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
  if (!req.body.asset_tag || !req.body.name) {
    return res.status(400).json({ ok: false, error: 'asset_tag and name are required.' });
  }
  res.status(201).json({ ok: true, asset: svc.createAsset(req.body) });
});

router.put('/:id', (req, res) => {
  const updated = svc.updateAsset(req.params.id, req.body);
  if (!updated) return res.status(404).json({ ok: false, error: 'Asset not found.' });
  res.json({ ok: true, asset: updated });
});

router.delete('/:id', (req, res) => {
  res.json(svc.deleteAsset(req.params.id));
});

router.post('/:id/nfc', (req, res) => {
  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ ok: false, error: 'uid is required.' });
  res.status(201).json({ ok: true, tag: svc.registerNfcTag(uid, req.params.id) });
});

router.get('/nfc/:uid', (req, res) => {
  const asset = svc.findAssetByNfcUid(req.params.uid);
  if (!asset) return res.status(404).json({ ok: false, error: 'No asset registered to this tag.' });
  const detail = svc.getAssetDetail(asset.id);
  res.json({ ok: true, asset: detail });
});

// Looked up by the mobile Scan screen right after a QR read, so staff can
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
router.post('/import', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  try {
    const result = svc.importFromExcelBuffer(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: 'Import failed: ' + err.message });
  }
});

module.exports = router;// features/assets/routes.js — GET /api/v1/assets, POST /api/v1/assets/import, etc.
const express = require('express');
const router = express.Router();
const svc = require('./services');

router.get('/', (req, res) => {
  const { roomId, search } = req.query;
  res.json({ ok: true, assets: svc.listAssets({ roomId, search }) });
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
  if (!req.body.asset_tag || !req.body.name) {
    return res.status(400).json({ ok: false, error: 'asset_tag and name are required.' });
  }
  res.status(201).json({ ok: true, asset: svc.createAsset(req.body) });
});

router.put('/:id', (req, res) => {
  const updated = svc.updateAsset(req.params.id, req.body);
  if (!updated) return res.status(404).json({ ok: false, error: 'Asset not found.' });
  res.json({ ok: true, asset: updated });
});

router.delete('/:id', (req, res) => {
  res.json(svc.deleteAsset(req.params.id));
});

router.post('/:id/nfc', (req, res) => {
  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ ok: false, error: 'uid is required.' });
  res.status(201).json({ ok: true, tag: svc.registerNfcTag(uid, req.params.id) });
});

router.get('/nfc/:uid', (req, res) => {
  const asset = svc.findAssetByNfcUid(req.params.uid);
  if (!asset) return res.status(404).json({ ok: false, error: 'No asset registered to this tag.' });
  const detail = svc.getAssetDetail(asset.id);
  res.json({ ok: true, asset: detail });
});

// Looked up by the mobile Scan screen right after a QR read, so staff can
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
router.post('/import', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  try {
    const result = svc.importFromExcelBuffer(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: 'Import failed: ' + err.message });
  }
});

module.exports = router;
