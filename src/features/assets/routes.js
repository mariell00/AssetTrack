// features/assets/routes.js — GET /api/v1/assets, POST /api/v1/assets/import, etc.
const express = require('express');
const router = express.Router();
const svc = require('./services');

router.get('/', (req, res) => {
  const { roomId, search } = req.query;
  res.json({ ok: true, assets: svc.listAssets({ roomId, search }) });
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
  res.json({ ok: true, asset });
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
