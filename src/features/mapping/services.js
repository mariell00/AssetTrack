// features/mapping/services.js — Buildings (one map pin each) and the
// Rooms that belong to them, plus the building-grouped data the Cluster
// Map screen renders. Previously every Room needed its own pin clicked
// onto the map one at a time; now a Building gets placed once and every
// Room under it inherits that location — Rooms themselves are just a
// managed list (see ui-locations.js), which is also what lets the mobile
// app offer a ROOM dropdown instead of a free-text field.
const { getDb } = require('../../core/database');

// ---- Buildings --------------------------------------------------------

function listBuildings() {
  const db = getDb();
  return db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM rooms WHERE building_id = b.id) AS room_count
    FROM buildings b
    ORDER BY b.name
  `).all();
}

function createBuilding({ name, latitude, longitude } = {}) {
  const db = getDb();
  const trimmed = (name || '').trim();
  if (!trimmed) return { ok: false, error: 'Building name is required.' };
  const existing = db.prepare('SELECT id FROM buildings WHERE name = ?').get(trimmed);
  if (existing) return { ok: false, error: 'A building with that name already exists.' };

  const info = db.prepare('INSERT INTO buildings (name, latitude, longitude) VALUES (?, ?, ?)')
    .run(trimmed, latitude ?? null, longitude ?? null);
  return { ok: true, id: info.lastInsertRowid };
}

function updateBuilding(id, { name, latitude, longitude } = {}) {
  const db = getDb();
  const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(id);
  if (!building) return { ok: false, error: 'Building not found.' };
  const trimmed = (name || '').trim();
  if (!trimmed) return { ok: false, error: 'Building name is required.' };
  const dupe = db.prepare('SELECT id FROM buildings WHERE name = ? AND id <> ?').get(trimmed, id);
  if (dupe) return { ok: false, error: 'A building with that name already exists.' };

  db.prepare('UPDATE buildings SET name = ? WHERE id = ?').run(trimmed, id);

  // Lets an admin type/paste exact coordinates (e.g. copied from Google
  // Maps) straight into the Locations screen's Add/Edit Building form,
  // instead of that being the ONLY way in via clicking the Cluster Map.
  // Sent as numbers when provided; omitted (undefined) leaves the pin
  // wherever it already was.
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    db.prepare('UPDATE buildings SET latitude = ?, longitude = ? WHERE id = ?').run(latitude, longitude, id);
  }
  return { ok: true };
}

function setBuildingLocation(id, latitude, longitude) {
  const db = getDb();
  const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(id);
  if (!building) return { ok: false, error: 'Building not found.' };
  db.prepare('UPDATE buildings SET latitude = ?, longitude = ? WHERE id = ?').run(latitude, longitude, id);
  return { ok: true };
}

function deleteBuilding(id) {
  const db = getDb();
  const roomCount = db.prepare('SELECT COUNT(*) AS c FROM rooms WHERE building_id = ?').get(id).c;
  if (roomCount > 0) {
    return { ok: false, error: `Cannot delete — ${roomCount} room(s) still belong to this building. Move or delete them first.` };
  }
  const info = db.prepare('DELETE FROM buildings WHERE id = ?').run(id);
  if (info.changes === 0) return { ok: false, error: 'Building not found.' };
  return { ok: true };
}

// ---- Rooms --------------------------------------------------------
// (rooms.building/latitude/longitude are legacy columns — see
// assets/models.js / mapping/models.js — left untouched but unused here)

function listRooms() {
  const db = getDb();
  return db.prepare(`
    SELECT r.id, r.name, r.floor, r.building_id, b.name AS building_name,
      (SELECT COUNT(*) FROM assets WHERE room_id = r.id) AS asset_count
    FROM rooms r
    LEFT JOIN buildings b ON b.id = r.building_id
    ORDER BY b.name IS NULL, b.name, r.name
  `).all();
}

function createRoom({ name, building_id, floor } = {}) {
  const db = getDb();
  const trimmed = (name || '').trim();
  if (!trimmed) return { ok: false, error: 'Room name is required.' };
  if (!building_id) return { ok: false, error: 'A building must be selected.' };
  const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(building_id);
  if (!building) return { ok: false, error: 'Building not found.' };
  const dupe = db.prepare('SELECT id FROM rooms WHERE name = ?').get(trimmed);
  if (dupe) return { ok: false, error: 'A room with that name already exists.' };

  const info = db.prepare('INSERT INTO rooms (name, building_id, floor) VALUES (?, ?, ?)')
    .run(trimmed, building_id, floor || null);
  return { ok: true, id: info.lastInsertRowid };
}

function updateRoom(id, { name, building_id, floor } = {}) {
  const db = getDb();
  const current = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!current) return { ok: false, error: 'Room not found.' };

  const nextName = name !== undefined ? name.trim() : current.name;
  if (!nextName) return { ok: false, error: 'Room name is required.' };
  const dupe = db.prepare('SELECT id FROM rooms WHERE name = ? AND id <> ?').get(nextName, id);
  if (dupe) return { ok: false, error: 'A room with that name already exists.' };

  let nextBuildingId = building_id !== undefined ? building_id : current.building_id;
  if (nextBuildingId) {
    const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(nextBuildingId);
    if (!building) return { ok: false, error: 'Building not found.' };
  }

  db.prepare('UPDATE rooms SET name = ?, building_id = ?, floor = ? WHERE id = ?').run(
    nextName, nextBuildingId || null, floor !== undefined ? (floor || null) : current.floor, id
  );
  return { ok: true };
}

// Deleting a room is safe for what references it: assets.room_id and
// inventory_logs.room_id both declare ON DELETE SET NULL (see
// assets/models.js, inventory/models.js) — so affected assets just fall
// back to "Unassigned" rather than being blocked or orphaned.
function deleteRoom(id) {
  const db = getDb();
  const info = db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  if (info.changes === 0) return { ok: false, error: 'Room not found.' };
  return { ok: true };
}

// ---- Cluster Map data --------------------------------------------------
// One pin per Building; each pin's tooltip/detail breaks assets down by
// the rooms inside that building (rather than one pin per room).

function buildingsForMap() {
  const db = getDb();
  const buildings = db.prepare('SELECT id, name, latitude, longitude FROM buildings ORDER BY name').all();
  const roomsForBuilding = db.prepare('SELECT id, name, floor FROM rooms WHERE building_id = ? ORDER BY name');
  const assetsForRoom = db.prepare(`
    SELECT asset_tag, name, status, assigned_to, photo FROM assets WHERE room_id = ? ORDER BY name
  `);

  return buildings.map((b) => {
    const rooms = roomsForBuilding.all(b.id).map((r) => {
      const assets = assetsForRoom.all(r.id);
      return { id: r.id, name: r.name, floor: r.floor, asset_count: assets.length, assets };
    });
    const asset_count = rooms.reduce((sum, r) => sum + r.asset_count, 0);
    return {
      id: b.id,
      name: b.name,
      latitude: b.latitude,
      longitude: b.longitude,
      room_count: rooms.length,
      asset_count,
      rooms
    };
  });
}

// One row per ASSET rather than grouped by building/room — this is what
// lets the Cluster Map give every asset its own marker/pin (see
// ui-map.js's popupHtml/markers) instead of folding a building's assets
// into one shared popup list. An asset only appears here once its room's
// building has a pin placed (latitude/longitude set) — same "click PLACE ON
// MAP first" requirement the old building-level pins already had. Ordered
// newest-first so it doubles as the source for the "Recently Added" panel.
function assetsForMap() {
  const db = getDb();
  return db.prepare(`
    SELECT a.id, a.asset_tag, a.name, a.status, a.assigned_to, p.photo AS assigned_photo, a.photo, a.created_at,
      r.id AS room_id, r.name AS room_name, r.floor,
      b.id AS building_id, b.name AS building_name, b.latitude, b.longitude
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN buildings b ON b.id = r.building_id
    LEFT JOIN people p ON p.name = a.assigned_to COLLATE NOCASE
    WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL
    ORDER BY a.created_at DESC
  `).all();
}

module.exports = {
  listBuildings, createBuilding, updateBuilding, setBuildingLocation, deleteBuilding,
  listRooms, createRoom, updateRoom, deleteRoom,
  buildingsForMap, assetsForMap
};
