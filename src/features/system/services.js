// features/system/services.js — write/read the activity log, plus a small
// in-memory runtime counter for the QR Distribution "Network Status" panel
// (requests/min, distinct clients) — this is process-local and resets on
// restart, which is fine for a LAN status readout.
const { getDb } = require('../../core/database');
const { discoverLocalIp } = require('../../core/config');

let requestTimestamps = [];
const recentClientIps = new Map(); // ip -> last-seen epoch ms

function trackRequest(ip) {
  const now = Date.now();
  requestTimestamps.push(now);
  requestTimestamps = requestTimestamps.filter((t) => now - t < 60_000);
  if (ip) recentClientIps.set(ip, now);
  for (const [key, seen] of recentClientIps) {
    if (now - seen > 5 * 60_000) recentClientIps.delete(key);
  }
}

function logEvent(category, message, level = 'info') {
  const db = getDb();
  db.prepare('INSERT INTO activity_log (category, message, level) VALUES (?, ?, ?)').run(category, message, level);
}

function recentActivity(limit = 30) {
  const db = getDb();
  return db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(limit);
}

function systemStatus(port) {
  const ip = discoverLocalIp();
  return {
    localIp: ip,
    port,
    protocol: 'HTTP/1.1',
    subnet: ip.split('.').slice(0, 3).join('.') + '.0/24',
    clientsConnected: recentClientIps.size,
    requestsPerMin: requestTimestamps.length,
    databaseOnline: true
  };
}

module.exports = { logEvent, recentActivity, systemStatus, trackRequest };
