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

    -- Everything a phone sends at SYNC waits here until the super admin verifies
    -- it in the Inventory Sync screen. Nothing in these two tables counts as
    -- verified or changes an asset until it is approved.
    --
    --   pending_scans          a SCAN = an existing asset was scanned. May carry
    --                          proposed edits to its details (changes_json).
    --                          kind 'edit' = edits made without scanning (from the
    --                          registry list): no verified scan is logged on approval.
    --   pending_registrations  a REGISTRATION = a brand-new asset. The Asset ID is
    --                          only generated when it is approved. client_uuid is
    --                          the id the PHONE made for it: it lets the desktop
    --                          tell "this one again" from "a new one".
    CREATE TABLE IF NOT EXISTS pending_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      room_id INTEGER,
      scanned_by TEXT NOT NULL,
      claimed_status TEXT NOT NULL DEFAULT 'verified' CHECK (claimed_status IN ('verified','missing','misplaced')),
      kind TEXT NOT NULL DEFAULT 'scan',
      changes_json TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      device_source TEXT,
      device_ip TEXT,
      device_name TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_scans(review_status);

    CREATE TABLE IF NOT EXISTS pending_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      device_source TEXT,
      device_ip TEXT,
      device_name TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_asset_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pendreg_status ON pending_registrations(review_status);

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
  // pending_scans came first as a plain scan queue; scans can now also carry proposed edits.
  if (!columnExists(db, 'pending_scans', 'kind')) {
    db.exec(`ALTER TABLE pending_scans ADD COLUMN kind TEXT NOT NULL DEFAULT 'scan'`);
  }
  if (!columnExists(db, 'pending_scans', 'changes_json')) {
    db.exec(`ALTER TABLE pending_scans ADD COLUMN changes_json TEXT`);
  }

  // The phone's own id for a registration (see assets.client_uuid). Unique, and kept
  // for approved and rejected rows too — so a registration the phone sends again
  // after the reply was lost is recognised even once it has been reviewed.
  if (!columnExists(db, 'pending_registrations', 'client_uuid')) {
    db.exec(`ALTER TABLE pending_registrations ADD COLUMN client_uuid TEXT`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pendreg_client_uuid ON pending_registrations(client_uuid) WHERE client_uuid IS NOT NULL`);

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
