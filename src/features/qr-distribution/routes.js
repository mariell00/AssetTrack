// features/qr-distribution/routes.js — serves the QR code + the PWA static files.
// (Static file serving for /static/mobile itself is wired up in main.js so it
// sits at a stable /static/mobile path regardless of feature routing.)
const express = require('express');
const router = express.Router();
const { generateMobileQrDataUrl } = require('./services');

router.get('/code', async (req, res) => {
  const baseUrl = req.app.locals.mobileBaseUrl;
  if (!baseUrl) {
    return res.status(503).json({ ok: false, error: 'Mobile access URL not ready yet — try again in a few seconds.' });
  }
  const result = await generateMobileQrDataUrl(baseUrl);
  res.json({ ok: true, mode: req.app.locals.mobileAccessMode || 'lan', ...result });
});

// Lets the QR screen show "setting up public tunnel..." instead of a dead
// LAN-only code while the tunnel is still connecting.
router.get('/access-mode', (req, res) => {
  res.json({
    ok: true,
    mode: req.app.locals.mobileAccessMode || 'lan',
    starting: !!req.app.locals.tunnelStarting
  });
});

module.exports = router;
