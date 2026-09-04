// features/assets/models.js — Asset, NFC_Tag, Room schemas.
function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      building TEXT,
      floor TEXT,
      latitude REAL,
      longitude REAL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_tag TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      condition TEXT DEFAULT 'good',
      acquired_date TEXT,
      value_php REAL,
      room_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS nfc_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      asset_id INTEGER NOT NULL,
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_assets_room ON assets(room_id);
    CREATE INDEX IF NOT EXISTS idx_nfc_asset ON nfc_tags(asset_id);

    CREATE TABLE IF NOT EXISTS asset_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      reported_by TEXT NOT NULL,
      note TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_issues_asset ON asset_issues(asset_id);
  `);

  if (!columnExists(db, 'assets', 'assigned_to')) {
    db.exec(`ALTER TABLE assets ADD COLUMN assigned_to TEXT`);
  }
  // Operational status shown as a badge in the Asset Registry table —
  // distinct from `condition` (physical condition of the item itself).
  if (!columnExists(db, 'assets', 'status')) {
    db.exec(`ALTER TABLE assets ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
}

module.exports = { init };
