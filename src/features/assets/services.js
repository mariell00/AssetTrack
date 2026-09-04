// features/assets/services.js — CRUD logic + Excel-to-JSON bulk importer.
const XLSX = require('xlsx');
const { getDb } = require('../../core/database');

function listAssets({ roomId, search } = {}) {
  const db = getDb();
  let sql = `
    SELECT a.*, r.name AS room_name,
      (SELECT t.uid FROM nfc_tags t WHERE t.asset_id = a.id ORDER BY t.id LIMIT 1) AS nfc_uid
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    WHERE 1=1
  `;
  const params = [];
  if (roomId) { sql += ' AND a.room_id = ?'; params.push(roomId); }
  if (search) { sql += ' AND (a.name LIKE ? OR a.asset_tag LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY a.asset_tag';
  return db.prepare(sql).all(...params);
}

function getAsset(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
}

// Full detail view used by the mobile "Asset Info" screen: joins room name,
// last-scanned timestamp, and any open issue count.
function getAssetDetail(id) {
  const db = getDb();
  const asset = db.prepare(`
    SELECT a.*, r.name AS room_name
    FROM assets a LEFT JOIN rooms r ON r.id = a.room_id
    WHERE a.id = ?
  `).get(id);
  if (!asset) return null;

  const lastScanned = db.prepare(`
    SELECT MAX(scanned_at) AS last_scanned FROM inventory_logs WHERE asset_id = ?
  `).get(id).last_scanned;

  const openIssues = db.prepare(`
    SELECT COUNT(*) AS c FROM asset_issues WHERE asset_id = ? AND resolved = 0
  `).get(id).c;

  return { ...asset, room_name: asset.room_name, last_scanned: lastScanned, open_issues: openIssues };
}

// Resolves a free-typed room name to a room_id, creating the room row if
// it doesn't exist yet — lets the Asset Registry modal accept a plain text
// room field instead of forcing a room picker.
function resolveRoomId(db, roomName) {
  if (!roomName) return null;
  const existing = db.prepare('SELECT id FROM rooms WHERE name = ?').get(roomName);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO rooms (name) VALUES (?)').run(roomName);
  return info.lastInsertRowid;
}

function createAsset(data) {
  const db = getDb();
  const roomId = data.room_id || resolveRoomId(db, data.room_name);
  const info = db.prepare(`
    INSERT INTO assets (asset_tag, name, category, description, condition, status, acquired_date, value_php, room_id, assigned_to)
    VALUES (@asset_tag, @name, @category, @description, @condition, @status, @acquired_date, @value_php, @room_id, @assigned_to)
  `).run({
    asset_tag: data.asset_tag,
    name: data.name,
    category: data.category || null,
    description: data.description || null,
    condition: data.condition || 'good',
    status: data.status || 'active',
    acquired_date: data.acquired_date || null,
    value_php: data.value_php || null,
    room_id: roomId,
    assigned_to: data.assigned_to || null
  });

  if (data.nfc_uid) {
    db.prepare('INSERT OR IGNORE INTO nfc_tags (uid, asset_id) VALUES (?, ?)').run(data.nfc_uid, info.lastInsertRowid);
  }

  require('../system/services').logEvent('IMPORT', `Asset ${data.asset_tag} registered: ${data.name}`, 'success');
  return getAsset(info.lastInsertRowid);
}

function updateAsset(id, data) {
  const db = getDb();
  const existing = getAsset(id);
  if (!existing) return null;
  const roomId = data.room_name !== undefined ? resolveRoomId(db, data.room_name) : (data.room_id !== undefined ? data.room_id : existing.room_id);
  const merged = { ...existing, ...data, room_id: roomId, id };
  db.prepare(`
    UPDATE assets SET asset_tag=@asset_tag, name=@name, category=@category,
      description=@description, condition=@condition, status=@status, acquired_date=@acquired_date,
      value_php=@value_php, room_id=@room_id, assigned_to=@assigned_to WHERE id=@id
  `).run(merged);

  if (data.nfc_uid) {
    db.prepare('INSERT OR IGNORE INTO nfc_tags (uid, asset_id) VALUES (?, ?)').run(data.nfc_uid, id);
  }

  const { logEvent } = require('../system/services');
  if (data.status && data.status !== existing.status) {
    logEvent('UPDATE', `${merged.asset_tag} status: ${data.status.toUpperCase()}`, data.status === 'active' ? 'success' : 'warn');
  }
  return getAsset(id);
}

function deleteAsset(id) {
  const db = getDb();
  const existing = getAsset(id);
  db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  if (existing) require('../system/services').logEvent('UPDATE', `Asset ${existing.asset_tag} deleted`, 'warn');
  return { ok: true };
}

function registerNfcTag(uid, assetId) {
  const db = getDb();
  const info = db.prepare('INSERT INTO nfc_tags (uid, asset_id) VALUES (?, ?)').run(uid, assetId);
  return { id: info.lastInsertRowid, uid, asset_id: assetId };
}

function findAssetByNfcUid(uid) {
  const db = getDb();
  return db.prepare(`
    SELECT a.* FROM assets a
    JOIN nfc_tags t ON t.asset_id = a.id
    WHERE t.uid = ?
  `).get(uid);
}

function reportIssue(assetId, note, reportedBy) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO asset_issues (asset_id, reported_by, note) VALUES (?, ?, ?)
  `).run(assetId, reportedBy || 'unknown', note);
  db.prepare(`UPDATE assets SET status = 'maintenance' WHERE id = ?`).run(assetId);

  const asset = getAsset(assetId);
  require('../system/services').logEvent('ALERT', `Asset ${asset ? asset.asset_tag : assetId} reported: ${note}`, 'alert');
  return { id: info.lastInsertRowid, asset_id: Number(assetId), note, reported_by: reportedBy };
}

// Bulk import: reads an uploaded .xlsx buffer (columns: asset_tag, name,
// category, description, condition, room) and inserts/updates rows.
function importFromExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const db = getDb();
  const findRoom = db.prepare('SELECT id FROM rooms WHERE name = ?');
  const insertRoom = db.prepare('INSERT INTO rooms (name) VALUES (?)');
  const upsertAsset = db.prepare(`
    INSERT INTO assets (asset_tag, name, category, description, condition, room_id)
    VALUES (@asset_tag, @name, @category, @description, @condition, @room_id)
    ON CONFLICT(asset_tag) DO UPDATE SET
      name=excluded.name, category=excluded.category,
      description=excluded.description, condition=excluded.condition,
      room_id=excluded.room_id
  `);

  let imported = 0;
  const tx = db.transaction((records) => {
    for (const row of records) {
      if (!row.asset_tag || !row.name) continue;
      let roomId = null;
      if (row.room) {
        let r = findRoom.get(row.room);
        if (!r) { const info = insertRoom.run(row.room); roomId = info.lastInsertRowid; }
        else roomId = r.id;
      }
      upsertAsset.run({
        asset_tag: String(row.asset_tag),
        name: String(row.name),
        category: row.category ? String(row.category) : null,
        description: row.description ? String(row.description) : null,
        condition: row.condition ? String(row.condition) : 'good',
        room_id: roomId
      });
      imported++;
    }
  });
  tx(rows);

  require('../system/services').logEvent('IMPORT', `CSV batch imported: ${imported} records staged`, 'success');
  return { ok: true, imported, total_rows: rows.length };
}

// Dashboard headline numbers: Total Assets / Verified Today / Pending Sync / Maintenance Due
function dashboardStats() {
  const db = getDb();
  const totalAssets = db.prepare('SELECT COUNT(*) AS c FROM assets').get().c;
  const verifiedToday = db.prepare(`
    SELECT COUNT(DISTINCT asset_id) AS c FROM inventory_logs
    WHERE status = 'verified' AND date(scanned_at) = date('now')
  `).get().c;
  const pendingSync = Math.max(0, totalAssets - verifiedToday);
  const maintenanceDue = db.prepare(`SELECT COUNT(*) AS c FROM assets WHERE status = 'maintenance'`).get().c;

  return { totalAssets, verifiedToday, pendingSync, maintenanceDue };
}

module.exports = {
  listAssets, getAsset, getAssetDetail, createAsset, updateAsset, deleteAsset,
  registerNfcTag, findAssetByNfcUid, importFromExcelBuffer, reportIssue, dashboardStats
};
