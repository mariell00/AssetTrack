// core/config.js — reads settings.json and discovers the machine's local
// IPv4 address so the QR-distribution feature can point mobile devices at it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'settings.json');

function loadConfig() {
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
  const config = JSON.parse(raw);
  return config;
}

function saveConfig(config) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config, null, 2));
}

// Scans all network interfaces and returns the first non-internal IPv4
// address (e.g. 192.168.1.42). Falls back to 127.0.0.1 if offline/isolated.
function discoverLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

module.exports = { loadConfig, saveConfig, discoverLocalIp };
