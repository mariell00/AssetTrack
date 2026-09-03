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
  `);
}

module.exports = { init };
