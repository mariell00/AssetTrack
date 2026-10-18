// features/analytics/routes.js — GET /api/v1/analytics/summary, GET /api/v1/analytics/dashboard
const express = require('express');
const router = express.Router();
const svc = require('./services');

router.get('/dashboard', (req, res) => {
  res.json({ ok: true, ...svc.dashboardSummary() });
});

router.get('/summary', (req, res) => {
  res.json({
    ok: true,
    stats: svc.summaryStats(),
    bar: svc.scansByBuilding(),
    heatmap: svc.activityHeatmap()
  });
});

module.exports = router;
