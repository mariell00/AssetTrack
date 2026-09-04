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

  require('../system/services').logEvent(
    'SYNC', `${scannedBy || 'Mobile client'} synced ${recorded} scan(s)`, recorded > 0 ? 'success' : 'warn'
  );
  if (skipped.length > 0) {
    require('../system/services').logEvent('ALERT', `${skipped.length} scan(s) skipped — tag not registered`, 'alert');
  }

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
  const lastSync = db.prepare(`
    SELECT MAX(scanned_at) AS last_sync FROM inventory_logs WHERE room_id = ?
  `).get(roomId).last_sync;

  return {
    room_id: Number(roomId),
    expected,
    verified: verifiedToday,
    pct: expected === 0 ? 0 : Math.round((verifiedToday / expected) * 100),
    last_sync: lastSync
  };
}

function allRoomsProgress() {
  const db = getDb();
  const rooms = db.prepare('SELECT id, name FROM rooms ORDER BY name').all();
  return rooms.map((r) => ({ room_name: r.name, ...roomProgress(r.id) }));
}

// "Mobile Check-in Log" — recent sync sessions with a rough device label
// (scanned_by) and a COMPLETE/PARTIAL verdict against the room's expected count.
function syncLog(limit = 20) {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT s.*, r.name AS room_name,
      (SELECT COUNT(*) FROM assets WHERE room_id = s.room_id) AS expected
    FROM sync_sessions s
    LEFT JOIN rooms r ON r.id = s.room_id
    ORDER BY s.id DESC
    LIMIT ?
  `).all(limit);

  if (sessions.length > 0) {
    return sessions.map((s) => ({
      time: s.created_at,
      device: s.scanned_by,
      room: s.room_name || 'Unassigned',
      count: s.total_scanned,
      status: s.expected > 0 && s.total_scanned >= s.expected ? 'complete' : 'partial'
    }));
  }

  // Fall back to raw scan batches grouped by minute if no formal sync
  // sessions have been submitted yet (e.g. only ad-hoc /sync calls so far).
  return db.prepare(`
    SELECT
      substr(l.scanned_at, 1, 16) AS time,
      l.scanned_by AS device,
      COALESCE(r.name, 'Unassigned') AS room,
      COUNT(*) AS count
    FROM inventory_logs l
    LEFT JOIN rooms r ON r.id = l.room_id
    GROUP BY time, device, room
    ORDER BY time DESC
    LIMIT ?
  `).all(limit).map((row) => ({ ...row, status: 'complete' }));
}

// A single, immediate "Mark Scanned" action from the mobile Asset Info
// screen — same underlying log table as a batch sync, just one row.
function markScanned(assetId, scannedBy) {
  const db = getDb();
  const asset = db.prepare('SELECT room_id FROM assets WHERE id = ?').get(assetId);
  db.prepare(`
    INSERT INTO inventory_logs (asset_id, room_id, scanned_by, status)
    VALUES (?, ?, ?, 'verified')
  `).run(assetId, asset ? asset.room_id : null, scannedBy || 'unknown');
  return { ok: true };
}

// Records the end-of-session summary shown on the mobile "Background Sync
// Summary" screen — separate from the raw per-asset scan log, this is the
// human-facing session record (counts, notes, supervisor flags, signature).
function recordSyncSession(data) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO sync_sessions
      (room_id, scanned_by, total_scanned, missing_count, notify_supervisor, auto_sync, save_offline, notes, signature_data)
    VALUES (@room_id, @scanned_by, @total_scanned, @missing_count, @notify_supervisor, @auto_sync, @save_offline, @notes, @signature_data)
  `).run({
    room_id: data.room_id || null,
    scanned_by: data.scanned_by || 'unknown',
    total_scanned: data.total_scanned || 0,
    missing_count: data.missing_count || 0,
    notify_supervisor: data.notify_supervisor ? 1 : 0,
    auto_sync: data.auto_sync ? 1 : 0,
    save_offline: data.save_offline ? 1 : 0,
    notes: data.notes || null,
    signature_data: data.signature_data || null
  });
  return { ok: true, id: info.lastInsertRowid };
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

module.exports = {
  recordSyncBatch, roomProgress, allRoomsProgress, recentLogs,
  markScanned, recordSyncSession, syncLog
};
