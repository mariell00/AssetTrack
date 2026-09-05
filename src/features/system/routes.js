// features/system/routes.js — GET /api/v1/system/status, GET /api/v1/system/activity
const express = require('express');
const router = express.Router();
const { loadConfig } = require('../../core/config');
const svc = require('./services');

router.get('/status', (req, res) => {
  const config = loadConfig();
  res.json({ ok: true, status: svc.systemStatus(config.port) });
});

router.get('/activity', (req, res) => {
  const limit = Number(req.query.limit) || 30;
  res.json({ ok: true, events: svc.recentActivity(limit) });
});

module.exports = router;
