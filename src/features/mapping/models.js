// features/mapping/models.js — Building schema, plus the migration that
// links each Room to a Building (rooms.building_id) instead of every room
// needing its own free-text `building` string and its own map pin.
//
// Model: one locator (lat/long) per Building, placed once on the Cluster
// Map. Rooms are just named entries that belong to a building — added
// from the Locations screen — so the mobile app can offer a "pick from
// the list" ROOM dropdown instead of a free-text field admins have to
// type consistently every time.
function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      latitude REAL,
      longitude REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Adds the new normalized link alongside the legacy rooms.building /
  // rooms.latitude / rooms.longitude columns (assets/models.js) — those
  // stay in place untouched so nothing already stored is lost.
  if (!columnExists(db, 'rooms', 'building_id')) {
    db.exec(`ALTER TABLE rooms ADD COLUMN building_id INTEGER REFERENCES buildings(id)`);
  }

  // One-time backfill: any room that already has a free-text `building`
  // name but no building_id yet gets matched to (or gets a new) Building
  // row, so existing installs keep working under the new model without
  // an admin having to re-enter everything by hand.
  const legacyRooms = db.prepare(`
    SELECT id, building FROM rooms
    WHERE building_id IS NULL AND building IS NOT NULL AND trim(building) <> ''
  `).all();

  if (legacyRooms.length > 0) {
    const findBuilding = db.prepare('SELECT id FROM buildings WHERE name = ?');
    const insertBuilding = db.prepare('INSERT INTO buildings (name) VALUES (?)');
    const setBuildingId = db.prepare('UPDATE rooms SET building_id = ? WHERE id = ?');

    for (const room of legacyRooms) {
      const name = room.building.trim();
      const existing = findBuilding.get(name);
      const buildingId = existing ? existing.id : insertBuilding.run(name).lastInsertRowid;
      setBuildingId.run(buildingId, room.id);
    }
  }
}

module.exports = { init };
