// features/auth/models.js — User table schema.
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

  // Seed a default admin on first run so the app is usable out-of-the-box.
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c === 0) {
    const { hashPassword } = require('../../core/security');
    db.prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run('admin', hashPassword('changeme'), 'admin');
    console.log('[AssetTrack] Seeded default admin user (admin / changeme) — change this password.');
  }
}

module.exports = { init };
