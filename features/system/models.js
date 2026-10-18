// features/system/models.js — activity_log schema. Every meaningful action
// (login, import, sync, export, alert) writes one row here so the
// Dashboard's "ACTIVITY LOG // TERMINAL" panel has something real to show.
function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
  `);
}

module.exports = { init };
