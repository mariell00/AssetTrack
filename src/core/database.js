// core/database.js — single SQLite connection (singleton), shared by every
// feature's models.js/services.js. No feature should ever open its own
// connection — that's the whole point of dependency injection here.
//
// Backed by sql.js (SQLite-as-WebAssembly) via the compatibility wrapper in
// sqlite-engine.js, instead of the native better-sqlite3 module. This means
// zero native compilation on install — no Visual Studio / node-gyp / Python
// required on any platform, which is what made the old setup fragile on
// fresh Windows machines.
const path = require('path');
const fs = require('fs');
const { openDatabase } = require('./sqlite-engine');

let db = null;

async function initDatabase(userDataPath) {
  const dbPath = path.join(userDataPath, 'inventory.db');
  db = await openDatabase(dbPath);
  db.pragma('foreign_keys = ON');

  // Each feature owns its own schema; models.js files call this to register
  // their CREATE TABLE IF NOT EXISTS statements against the shared db.
  require('../features/auth/models').init(db);
  require('../features/assets/models').init(db);
  require('../features/inventory/models').init(db);
  require('../features/system/models').init(db);

  console.log(`[AssetTrack] SQLite (sql.js) ready at ${dbPath}`);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized — call initDatabase() first.');
  return db;
}

// Auto-Backup: every N hours, copy the live db file to /data/backups with
// a timestamped filename. Cheap, file-level backup — good enough for a
// single-writer LAN app and trivially restorable (just copy the file back).
function startAutoBackup(userDataPath, intervalHours = 24) {
  const backupDir = path.join(userDataPath, '..', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const runBackup = () => {
    try {
      const dbPath = path.join(userDataPath, 'inventory.db');
      if (db) db.persist(); // flush any pending in-memory changes first
      if (!fs.existsSync(dbPath)) return;
      const stamp = new Date().toISOString().slice(0, 10);
      const dest = path.join(backupDir, `inventory-backup-${stamp}.db`);
      fs.copyFileSync(dbPath, dest);
      console.log(`[AssetTrack] Backup written: ${dest}`);
    } catch (err) {
      console.error('[AssetTrack] Backup failed:', err);
    }
  };

  runBackup(); // one immediately on boot
  const ms = Math.max(1, intervalHours) * 60 * 60 * 1000;
  setInterval(runBackup, ms);
}

module.exports = { initDatabase, getDb, startAutoBackup };
