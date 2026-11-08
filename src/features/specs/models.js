// features/specs/models.js — schema for category-driven spec fields.
//   SPEC_DEFINITION  which fields each category has (seeded from spec_seed.sql)
//   asset_spec       the value an asset has for one of those fields
const fs = require('fs');
const path = require('path');

const SEED_FILE = path.join(__dirname, 'spec_seed.sql');

// Same table as the first statement of spec_seed.sql — created here as well so the app
// still starts (just with no fields) if the seed file ever goes missing.
const SPEC_DEFINITION_DDL = `
  CREATE TABLE IF NOT EXISTS SPEC_DEFINITION (
    spec_def_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT NOT NULL,
    field_key     TEXT NOT NULL,
    label         TEXT NOT NULL,
    field_type    TEXT NOT NULL,
    options       TEXT,
    unit          TEXT,
    is_required   INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL,
    UNIQUE(category, field_key)
  )`;

// Re-running a seed must not fail on UNIQUE(category, field_key), and an edited seed
// (a renamed label, a new select option, a field marked required) should take effect on
// the next launch — so every INSERT becomes an upsert that keeps the row's spec_def_id
// (which asset_spec rows point at).
const UPSERT = ` ON CONFLICT(category, field_key) DO UPDATE SET
  label = excluded.label, field_type = excluded.field_type, options = excluded.options,
  unit = excluded.unit, is_required = excluded.is_required, display_order = excluded.display_order`;

function seedStatements(sqlText) {
  return sqlText
    .split(/\r?\n/).filter((line) => !/^\s*--/.test(line)).join('\n')   // whole-line comments
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !/^(BEGIN|COMMIT)\b/i.test(s))                         // we run our own transaction
    .map((s) => (/^INSERT\s+INTO\s+SPEC_DEFINITION/i.test(s) ? s + UPSERT : s));
}

function init(db) {
  db.exec(SPEC_DEFINITION_DDL);
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_spec (
      asset_id    INTEGER NOT NULL,
      spec_def_id INTEGER NOT NULL,
      value       TEXT,
      PRIMARY KEY (asset_id, spec_def_id),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_def_id) REFERENCES SPEC_DEFINITION(spec_def_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_asset_spec_def ON asset_spec(spec_def_id);
  `);

  try {
    const statements = seedStatements(fs.readFileSync(SEED_FILE, 'utf8'));
    db.transaction(() => { statements.forEach((s) => db.exec(s)); })();
  } catch (err) {
    // Never block the app from opening over a spec file problem.
    console.error('[AssetTrack] Could not load spec_seed.sql — spec fields unavailable:', err.message);
  }
}

module.exports = { init, seedStatements };
