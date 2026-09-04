// features/analytics/routes.js — GET /api/v1/analytics/summary
const express = require('express');
const router = express.Router();
const svc = require('./services');

router.get('/summary', (req, res) => {
  res.json({
    ok: true,
    stats: svc.summaryStats(),
    bar: svc.scansByBuilding(),
    heatmap: svc.activityHeatmap()
  });
});

module.exports = router;
