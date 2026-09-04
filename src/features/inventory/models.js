// features/inventory/models.js — InventoryLog schema (scanned_by, room, timestamp).
function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      room_id INTEGER,
      scanned_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','missing','misplaced')),
      scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_logs_room ON inventory_logs(room_id);
    CREATE INDEX IF NOT EXISTS idx_logs_scanned_at ON inventory_logs(scanned_at);

    CREATE TABLE IF NOT EXISTS sync_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER,
      scanned_by TEXT NOT NULL,
      total_scanned INTEGER NOT NULL DEFAULT 0,
      missing_count INTEGER NOT NULL DEFAULT 0,
      notify_supervisor INTEGER NOT NULL DEFAULT 0,
      auto_sync INTEGER NOT NULL DEFAULT 0,
      save_offline INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      signature_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { init };
