// features/specs/routes.js — /api/v1/specs
// Read-only: specs are saved together with the asset (see assets/services.js).
const express = require('express');
const router = express.Router();
const svc = require('./services');

// The category list plus each category's spec fields, for the register/edit form.
router.get('/categories', (req, res) => {
  res.json({ ok: true, categories: svc.catalog() });
});

// The saved spec values of one asset (keyed by field), for pre-filling the edit form.
router.get('/asset/:id', (req, res) => {
  const asset = require('../assets/services').getAsset(req.params.id);
  if (!asset) return res.status(404).json({ ok: false, error: 'Asset not found.' });
  res.json({ ok: true, values: svc.values(asset.id, asset.category) });
});

module.exports = router;
