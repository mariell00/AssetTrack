// features/qr-distribution/services.js — generates a QR code encoding the
// URL where the mobile PWA is served. Takes the full base URL to use
// (an "http://LAN-ip:port" address, or an "https://*.trycloudflare.com"
// tunnel URL when public access is enabled) — see main.js's
// setupMobileAccess(), which decides which one is current and hands it to
// this via app.locals.mobileBaseUrl / routes.js.
const QRCode = require('qrcode');

async function generateMobileQrDataUrl(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/static/mobile/index.html`;
  const dataUrl = await QRCode.toDataURL(url, {
    color: { dark: '#111844', light: '#EAE0CF' },
    margin: 1,
    width: 320
  });
  return { url, dataUrl };
}

module.exports = { generateMobileQrDataUrl };
