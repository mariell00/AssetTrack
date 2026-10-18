// core/tls.js — generates (and reuses) a self-signed TLS certificate so the
// mobile PWA can be served over https:// on the LAN with zero internet
// access. This matters because getUserMedia (camera access, used by the QR
// scanner) only works in a "secure context" — plain http://192.168.x.x is
// NOT one, no matter what permission the phone grants — and the public
// Cloudflare tunnel (see main.js) needs outbound internet a campus network
// may not reliably have. A self-signed LAN certificate needs neither:
// browsers show a one-time "connection is not private" warning the first
// time a phone visits, and once the user taps through it ("Advanced" →
// "Proceed"), the page is treated as a secure context and the camera works
// normally from then on — this is the same trust model any local HTTPS dev
// server (webpack-dev-server, mkcert, etc.) relies on.
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

function certPaths(userDataPath) {
  const dir = path.join(userDataPath, 'certs');
  return {
    dir,
    certFile: path.join(dir, 'cert.pem'),
    keyFile: path.join(dir, 'key.pem'),
    metaFile: path.join(dir, 'meta.json')
  };
}

// Reuses the existing certificate as long as it was issued for the LAN IP
// this machine currently has — regenerating only when there isn't one yet
// or the IP changed (new WiFi, DHCP lease renewal, etc.). This avoids
// making phones click through the browser's security warning again on
// every single app restart for no reason.
function getOrCreateCert(userDataPath, currentIp) {
  const { dir, certFile, keyFile, metaFile } = certPaths(userDataPath);
  fs.mkdirSync(dir, { recursive: true });

  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    if (meta.ip === currentIp && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
      return { cert: fs.readFileSync(certFile, 'utf-8'), key: fs.readFileSync(keyFile, 'utf-8') };
    }
  } catch {
    // No cert yet, or the meta file is missing/corrupt — fall through and
    // generate a fresh one below.
  }

  const attrs = [{ name: 'commonName', value: currentIp }];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 7, ip: currentIp },     // type 7 = iPAddress — required: modern
        { type: 7, ip: '127.0.0.1' },   // browsers ignore commonName-only certs
        { type: 2, value: 'localhost' } // type 2 = DNS
      ]
    }]
  });

  fs.writeFileSync(certFile, pems.cert, { mode: 0o600 });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(metaFile, JSON.stringify({ ip: currentIp, generatedAt: new Date().toISOString() }));

  return { cert: pems.cert, key: pems.private };
}

module.exports = { getOrCreateCert };
