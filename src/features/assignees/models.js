// features/assignees/models.js — extends the `people` table (created in
// assets/models.js) so it can back the "Manage Assignees" panel.
//
// An assignee is someone an asset is handed to (the ASSIGNED TO dropdown in
// the Asset Registry). They are NOT login accounts — the super admin and admins
// live in `users`. Assets still link to a person by NAME (assets.assigned_to
// matches people.name, case-insensitively), so renaming a person also
// renames them on their assets — see services.js.
function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function init(db) {
  const addColumn = (name, ddl) => {
    if (!columnExists(db, 'people', name)) db.exec(`ALTER TABLE people ADD COLUMN ${name} ${ddl}`);
  };
  addColumn('position', 'TEXT');
  addColumn('department', 'TEXT');
  addColumn('contact', 'TEXT');
  addColumn('status', `TEXT NOT NULL DEFAULT 'active'`);
  addColumn('created_at', 'TEXT');

  // Everyone already named on an asset (typed on mobile, imported from a
  // spreadsheet, or picked in an older build) becomes a listed assignee, so
  // upgrading doesn't leave the new panel empty or the dropdown missing
  // people. Never overwrites a row that already exists.
  db.exec(`
    INSERT OR IGNORE INTO people (name)
    SELECT DISTINCT TRIM(assigned_to) FROM assets
    WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
  `);
  db.exec(`UPDATE people SET created_at = COALESCE(updated_at, datetime('now')) WHERE created_at IS NULL`);
}

module.exports = { init };
