// features/inventory/models.js — InventoryLog schema (scanned_by, room, timestamp).
function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

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

  // Which client the scan/sync actually came from ('mobile' or 'desktop',
  // read from the requester's verified JWT — see core/security.js), its IP,
  // and a short device name parsed from its User-Agent (see core/device.js)
  // — not just the self-reported "scanned_by" username — so the Inventory
  // Sync screen's Mobile Check-in Log can show who AND what phone, not
  // just a name someone could have typed into any client.
  for (const table of ['inventory_logs', 'sync_sessions']) {
    if (!columnExists(db, table, 'device_source')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN device_source TEXT`);
    }
    if (!columnExists(db, table, 'device_ip')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN device_ip TEXT`);
    }
    if (!columnExists(db, table, 'device_name')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN device_name TEXT`);
    }
  }
}

module.exports = { init };
