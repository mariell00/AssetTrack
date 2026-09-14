// features/mapping/services.js — room + per-asset data for the Cluster
// Map screen. Clustering itself now happens client-side via the real
// Leaflet.markercluster plugin, so this just hands back every room's
// coordinates plus its assets (including who each one's assigned to, for
// the marker hover tooltip) — no server-side grid clustering needed
// anymore.
const { getDb } = require('../../core/database');

function roomsWithAssets() {
  const db = getDb();
  const rooms = db.prepare(`
    SELECT id, name, building, floor, latitude, longitude
    FROM rooms
    ORDER BY name
  `).all();

  const assetsForRoom = db.prepare(`
    SELECT asset_tag, name, status, assigned_to
    FROM assets
    WHERE room_id = ?
    ORDER BY name
  `);

  return rooms.map((r) => {
    const assets = assetsForRoom.all(r.id);
    return {
      id: r.id,
      name: r.name,
      building: r.building,
      floor: r.floor,
      latitude: r.latitude,
      longitude: r.longitude,
      asset_count: assets.length,
      assets
    };
  });
}

function setRoomLocation(id, latitude, longitude) {
  const db = getDb();
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(id);
  if (!room) return { ok: false, error: 'Room not found.' };
  db.prepare('UPDATE rooms SET latitude = ?, longitude = ? WHERE id = ?').run(latitude, longitude, id);
  return { ok: true };
}

module.exports = { roomsWithAssets, setRoomLocation };
