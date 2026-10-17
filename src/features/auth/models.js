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
  // Tracks which client last logged this user in — 'mobile' (the phone
  // scanner PWA) or 'desktop' (the Admin Hub) — plus the IP it came from,
  // so the Admin Hub's Manage Users screen can show staff logging in from
  // the field, not just a bare "last active" timestamp.
  if (!columnExists(db, 'users', 'last_login_source')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_source TEXT`);
  }
  if (!columnExists(db, 'users', 'last_login_ip')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_ip TEXT`);
  }
  if (!columnExists(db, 'users', 'last_login_device')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_device TEXT`);
  }

  // Set when the superadmin's credentials are reset through the emailed
  // one-time code (see recovery.js). requireAuth rejects any session token
  // issued before this moment, so a reset also signs out whoever was logged in.
  if (!columnExists(db, 'users', 'tokens_valid_after')) {
    db.exec(`ALTER TABLE users ADD COLUMN tokens_valid_after INTEGER`);
  }

  // One-time recovery codes for the superadmin. Only a bcrypt hash of the code
  // is stored — the code itself exists only in the email that was sent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used_at INTEGER,
      requested_ip TEXT
    );
  `);

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
