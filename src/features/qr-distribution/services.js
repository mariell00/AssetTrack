// features/qr-distribution/services.js — generates a QR code encoding the
// URL where the mobile PWA is served (http://[desktop-local-ip]:[port]/static/mobile/index.html).
const QRCode = require('qrcode');
const { discoverLocalIp } = require('../../core/config');

async function generateMobileQrDataUrl(port) {
  const ip = discoverLocalIp();
  const url = `http://${ip}:${port}/static/mobile/index.html`;
  const dataUrl = await QRCode.toDataURL(url, {
    color: { dark: '#111844', light: '#EAE0CF' },
    margin: 1,
    width: 320
  });
  return { url, dataUrl };
}

module.exports = { generateMobileQrDataUrl };
