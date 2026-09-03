// features/inventory/routes.js — POST /api/v1/inventory/sync (mobile check-in).
const express = require('express');
const router = express.Router();
const svc = require('./services');

router.post('/sync', (req, res) => {
  const { scans, scanned_by } = req.body || {};
  if (!Array.isArray(scans) || scans.length === 0) {
    return res.status(400).json({ ok: false, error: 'scans[] is required.' });
  }
  res.json(svc.recordSyncBatch(scans, scanned_by));
});

router.get('/progress', (req, res) => {
  res.json({ ok: true, rooms: svc.allRoomsProgress() });
});

router.get('/progress/:roomId', (req, res) => {
  res.json({ ok: true, progress: svc.roomProgress(req.params.roomId) });
});

router.get('/logs', (req, res) => {
  const limit = Number(req.query.limit) || 50;
  res.json({ ok: true, logs: svc.recentLogs(limit) });
});

module.exports = router;
