// features/assets/models.js — Asset, NFC_Tag, Room schemas.
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
  `);
}

module.exports = { init };
