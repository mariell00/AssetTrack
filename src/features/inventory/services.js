// features/inventory/services.js — compares scanned logs vs expected assets
// per room, and records new scan batches coming from the mobile app.
const { getDb } = require('../../core/database');

// Accepts a batch of scans from the mobile sync endpoint:
// [{ asset_tag | nfc_uid, room_id, scanned_by, status }]
function recordSyncBatch(scans, scannedBy) {
  const db = getDb();
  const findByTag = db.prepare('SELECT id FROM assets WHERE asset_tag = ?');
  const findByNfc = db.prepare('SELECT asset_id AS id FROM nfc_tags WHERE uid = ?');
  const insertLog = db.prepare(`
    INSERT INTO inventory_logs (asset_id, room_id, scanned_by, status)
    VALUES (@asset_id, @room_id, @scanned_by, @status)
  `);

  let recorded = 0;
  const skipped = [];
  const tx = db.transaction((records) => {
    for (const s of records) {
      let asset = null;
      if (s.asset_tag) asset = findByTag.get(s.asset_tag);
      if (!asset && s.nfc_uid) asset = findByNfc.get(s.nfc_uid);
      if (!asset) { skipped.push(s); continue; }

      insertLog.run({
        asset_id: asset.id,
        room_id: s.room_id || null,
        scanned_by: s.scanned_by || scannedBy || 'unknown',
        status: s.status || 'verified'
      });
      recorded++;
    }
  });
  tx(scans);

  return { ok: true, recorded, skipped_count: skipped.length, skipped };
}

// Live verification progress: for a given room, what fraction of assigned
// assets have been scanned as "verified" today.
function roomProgress(roomId) {
  const db = getDb();
  const expected = db.prepare('SELECT COUNT(*) AS c FROM assets WHERE room_id = ?').get(roomId).c;
  const verifiedToday = db.prepare(`
    SELECT COUNT(DISTINCT asset_id) AS c
    FROM inventory_logs
    WHERE room_id = ? AND status = 'verified' AND date(scanned_at) = date('now')
  `).get(roomId).c;

  return {
    room_id: Number(roomId),
    expected,
    verified: verifiedToday,
    pct: expected === 0 ? 0 : Math.round((verifiedToday / expected) * 100)
  };
}

function allRoomsProgress() {
  const db = getDb();
  const rooms = db.prepare('SELECT id, name FROM rooms ORDER BY name').all();
  return rooms.map((r) => ({ room_name: r.name, ...roomProgress(r.id) }));
}

function recentLogs(limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT l.*, a.name AS asset_name, a.asset_tag, r.name AS room_name
    FROM inventory_logs l
    LEFT JOIN assets a ON a.id = l.asset_id
    LEFT JOIN rooms r ON r.id = l.room_id
    ORDER BY l.scanned_at DESC
    LIMIT ?
  `).all(limit);
}

module.exports = { recordSyncBatch, roomProgress, allRoomsProgress, recentLogs };
