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

    -- One row per assigned PERSON (keyed by name, case-insensitively —
    -- COLLATE NOCASE on the UNIQUE constraint means "John Doe" and
    -- "john doe" are the same row) rather than per asset, so uploading
    -- someone's photo once from any asset they're assigned to makes it
    -- show up for every other asset assigned to that same name too. See
    -- services.js's upsertPersonPhoto() and the assigned_to/people JOIN
    -- used by listAssets()/getAsset()/getAssetDetail().
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      photo TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  if (!columnExists(db, 'assets', 'assigned_to')) {
    db.exec(`ALTER TABLE assets ADD COLUMN assigned_to TEXT`);
  }
  // Operational status shown as a badge in the Asset Registry table —
  // distinct from `condition` (physical condition of the item itself).
  if (!columnExists(db, 'assets', 'status')) {
    db.exec(`ALTER TABLE assets ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  // A snapshot photo of the physical item — captured on the mobile Register/
  // Asset Info screens (camera or gallery), or attached from the desktop
  // Asset Registry modal. Stored as a compressed base64 JPEG data URL
  // (resized client-side before it's ever sent) so it fits comfortably
  // inside a single TEXT column and the existing 10mb JSON body limit,
  // no separate file storage/table needed.
  if (!columnExists(db, 'assets', 'photo')) {
    db.exec(`ALTER TABLE assets ADD COLUMN photo TEXT`);
  }
  // Older builds stored the assigned user's photo directly on the asset
  // row (assets.assigned_photo) — one photo per asset, so the same person
  // assigned to five assets needed re-uploading five times. That's now
  // replaced by the `people` table above (one photo per name, reused
  // everywhere that name is assigned). The column itself is left in place
  // (harmless, unused) rather than dropped, so any data in it can still be
  // backfilled below; nothing reads it anymore.
  if (!columnExists(db, 'assets', 'assigned_photo')) {
    db.exec(`ALTER TABLE assets ADD COLUMN assigned_photo TEXT`);
  }

  // One-time-per-startup backfill: carry forward any photo that was
  // already attached the old, per-asset way into the new per-person
  // `people` table, so upgrading doesn't make existing photos disappear.
  // Only fills in people who don't already have a photo (WHERE
  // people.photo IS NULL), so it never overwrites a photo someone has
  // since updated via the new shared flow. Cheap to re-run every startup.
  db.exec(`
    INSERT INTO people (name, photo)
    SELECT DISTINCT assigned_to, assigned_photo FROM assets
    WHERE assigned_to IS NOT NULL AND assigned_photo IS NOT NULL
    ON CONFLICT(name) DO UPDATE SET photo = excluded.photo WHERE people.photo IS NULL
  `);
}

module.exports = { init };
