// core/config.js — reads settings.json and discovers the machine's local
// IPv4 address so the QR-distribution feature can point mobile devices at it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const { settingsPath, localSettingsPath } = require('./paths');

function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}

function loadConfig() {
  const raw = fs.readFileSync(settingsPath(), 'utf-8');
  const config = JSON.parse(raw);
  // Secrets (map API key, SMTP password) belong in settings.local.json, which is git-ignored.
  try { deepMerge(config, JSON.parse(fs.readFileSync(localSettingsPath(), 'utf-8'))); } catch { /* no local overrides */ }
  // Older settings.json files (from before self-signed HTTPS support) won't
  // have this key — default it here so an in-place upgrade doesn't need a
  // manual settings.json edit before the mobile HTTPS listener can start.
  if (!config.httpsPort) config.httpsPort = 8443;
  return config;
}

function saveConfig(config) {
  fs.writeFileSync(settingsPath(), JSON.stringify(config, null, 2));
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
