// features/qr-distribution/routes.js — serves the QR code + the PWA static files.
// (Static file serving for /static/mobile itself is wired up in main.js so it
// sits at a stable /static/mobile path regardless of feature routing.)
const express = require('express');
const router = express.Router();
const { generateMobileQrDataUrl } = require('./services');
const { loadConfig } = require('../../core/config');

router.get('/code', async (req, res) => {
  const config = loadConfig();
  const result = await generateMobileQrDataUrl(config.port);
  res.json({ ok: true, ...result });
});

module.exports = router;
