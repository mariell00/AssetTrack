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
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin', 'admin')),
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
  // so the Manage Admins screen can show admins logging in from
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

  migrateLegacyRoles(db);

  // There is exactly one superadmin. The database enforces it, so no code
  // path (or hand-edited request) can ever create a second one.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_superadmin ON users(role) WHERE role = 'superadmin'`);

  // Seed the superadmin on first run so the app is usable out-of-the-box.
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c === 0) {
    const { hashPassword } = require('../../core/security');
    db.prepare(
      'INSERT INTO users (username, password_hash, role, status, assigned_area) VALUES (?, ?, ?, ?, ?)'
    ).run('admin', hashPassword('changeme'), 'superadmin', 'active', 'All Areas');
    console.log('[AssetTrack] Seeded default superadmin user (admin / changeme) — change this password.');
  }
}

// Older installs had two roles: 'admin' (desktop Admin Hub; the lowest-id one
// was the "superadmin") and 'staff' (mobile scanner). There are now two
// different roles with a hard split by app:
//   superadmin → desktop app only   (the old primary admin)
//   admin      → mobile app only    (every other old admin, and all old staff)
// SQLite can't change a CHECK constraint in place, so the table is rebuilt
// once; the 'staff' check in the stored schema tells us whether that's needed.
function migrateLegacyRoles(db) {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!info || !/'staff'/.test(info.sql)) return; // already on the new schema

  const primary = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  const primaryId = primary ? Number(primary.id) : -1;

  db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin', 'admin')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'active',
        assigned_area TEXT,
        last_active TEXT,
        last_login_source TEXT,
        last_login_ip TEXT,
        last_login_device TEXT,
        tokens_valid_after INTEGER
      );
    `);
    db.prepare(`
      INSERT INTO users_new (id, username, password_hash, role, created_at, status, assigned_area,
                             last_active, last_login_source, last_login_ip, last_login_device, tokens_valid_after)
      SELECT id, username, password_hash,
             CASE WHEN id = ? THEN 'superadmin' ELSE 'admin' END,
             created_at, status, assigned_area, last_active, last_login_source, last_login_ip,
             last_login_device, tokens_valid_after
      FROM users
    `).run(primaryId);
    db.exec('DROP TABLE users; ALTER TABLE users_new RENAME TO users;');
  })();
  console.log('[AssetTrack] Migrated user roles: primary admin → superadmin (desktop), all others → admin (mobile).');
}

module.exports = { init };
