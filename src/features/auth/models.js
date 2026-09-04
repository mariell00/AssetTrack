// features/auth/models.js — User table schema.
function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Lightweight migrations — add columns introduced after the initial
  // release without wiping existing installs' data.
  if (!columnExists(db, 'users', 'status')) {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  if (!columnExists(db, 'users', 'assigned_area')) {
    db.exec(`ALTER TABLE users ADD COLUMN assigned_area TEXT`);
  }
  if (!columnExists(db, 'users', 'last_active')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_active TEXT`);
  }

  // Seed a default admin on first run so the app is usable out-of-the-box.
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c === 0) {
    const { hashPassword } = require('../../core/security');
    db.prepare(
      'INSERT INTO users (username, password_hash, role, status, assigned_area) VALUES (?, ?, ?, ?, ?)'
    ).run('admin', hashPassword('changeme'), 'admin', 'active', 'All Areas');
    console.log('[AssetTrack] Seeded default admin user (admin / changeme) — change this password.');
  }
}

module.exports = { init };
