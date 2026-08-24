// scripts/build-mobile.js — copies the /mobile source folder into the
// Desktop's /src/static/mobile directory so the QR-distribution server
// can host the PWA. Run automatically before electron-builder packaging
// (see package.json "build:desktop" script), or manually any time the
// mobile source changes.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'mobile');
const DEST = path.join(__dirname, '..', 'src', 'static', 'mobile');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true });
copyRecursive(SRC, DEST);

console.log(`[build-mobile] Copied /mobile -> ${DEST}`);
