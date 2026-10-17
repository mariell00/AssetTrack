// features/assets/services.js — CRUD logic + Excel-to-JSON bulk importer.
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const { getDb } = require('../../core/database');

function listAssets({ roomId, search } = {}) {
  const db = getDb();
  let sql = `
    SELECT a.*, r.name AS room_name, p.photo AS assigned_photo,
      (SELECT t.uid FROM nfc_tags t WHERE t.asset_id = a.id ORDER BY t.id LIMIT 1) AS nfc_uid
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN people p ON p.name = a.assigned_to COLLATE NOCASE
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
  // Joins room_name for consistency with listAssets()/getAssetDetail() —
  // this is what createAsset()/updateAsset() return, and now that Rooms
  // are picked from a managed dropdown (mapping/ui-locations.js) rather
  // than free-typed, callers reasonably expect the resolved name back
  // alongside room_id. assigned_photo comes from the `people` table (see
  // models.js) keyed by the assigned_to name, not stored on the asset
  // itself — listed after a.* so it overrides that now-unused column.
  return db.prepare(`
    SELECT a.*, r.name AS room_name, p.photo AS assigned_photo
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN people p ON p.name = a.assigned_to COLLATE NOCASE
    WHERE a.id = ?
  `).get(id);
}

// Full detail view used by the mobile "Asset Info" screen: joins room name,
// last-scanned timestamp, and any open issue count.
function getAssetDetail(id) {
  const db = getDb();
  const asset = db.prepare(`
    SELECT a.*, r.name AS room_name, p.photo AS assigned_photo
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN people p ON p.name = a.assigned_to COLLATE NOCASE
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

// Saves a photo against the PERSON's name (people table), not the asset —
// so attaching it once from any asset they're assigned to makes it show up
// for every other asset assigned to that same name, on the Cluster Map and
// anywhere else assigned_photo is read. Case-insensitive dedupe comes from
// people.name's COLLATE NOCASE unique constraint (see models.js).
function upsertPersonPhoto(db, name, photo) {
  if (!name || !photo) return;
  db.prepare(`
    INSERT INTO people (name, photo, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET photo = excluded.photo, updated_at = excluded.updated_at
  `).run(name, photo);
}

function createAsset(data) {
  const db = getDb();
  const roomId = data.room_id || resolveRoomId(db, data.room_name);
  const info = db.prepare(`
    INSERT INTO assets (asset_tag, name, category, description, condition, status, acquired_date, value_php, room_id, assigned_to, photo)
    VALUES (@asset_tag, @name, @category, @description, @condition, @status, @acquired_date, @value_php, @room_id, @assigned_to, @photo)
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
    assigned_to: data.assigned_to || null,
    photo: data.photo || null
  });

  // `assigned_photo` here is whatever the Asset Registry modal's "ASSIGNED
  // USER PHOTO" field just picked — remembered against the person's name
  // (people table) rather than this asset row.
  if (data.assigned_photo) upsertPersonPhoto(db, data.assigned_to, data.assigned_photo);

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
      value_php=@value_php, room_id=@room_id, assigned_to=@assigned_to, photo=@photo WHERE id=@id
  `).run(merged);

  // Save against whichever name the asset ends up assigned to after this
  // update (merged.assigned_to), same as createAsset() above.
  if (data.assigned_photo) upsertPersonPhoto(db, merged.assigned_to, data.assigned_photo);

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

function findAssetByTag(tag) {
  const db = getDb();
  return db.prepare('SELECT * FROM assets WHERE asset_tag = ?').get(tag);
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

// Bulk import: reads an uploaded .xlsx/.csv buffer and inserts/updates rows.
// Column headers are matched flexibly (case/spacing/punctuation-insensitive)
// against several accepted names per field, so both a human-friendly export
// like "Asset ID / Name / Assigned To / Room / Status" and the original
// snake_case format ("asset_tag" / "room" / "condition") both work.
const IMPORT_FIELD_ALIASES = {
  asset_tag: ['asset_tag', 'asset id', 'assetid', 'asset tag', 'tag', 'id'],
  name: ['name', 'asset name'],
  category: ['category'],
  description: ['description', 'notes'],
  condition: ['condition'],
  room: ['room', 'location'],
  assigned_to: ['assigned_to', 'assigned to', 'assignee', 'assigned'],
  status: ['status']
};
const VALID_STATUSES = new Set(['active', 'pending', 'maintenance', 'offline']);

// Collapses a header like "Asset ID", "asset_tag" or "Asset-Id" down to
// "assetid" so all three match the same alias regardless of how the sheet
// author formatted it.
function normalizeHeader(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Builds a { assetTag, name, ... } object for one raw sheet row by matching
// its actual (arbitrarily-cased) column headers against IMPORT_FIELD_ALIASES.
function mapRow(row) {
  const normalized = {};
  for (const [rawKey, value] of Object.entries(row)) {
    normalized[normalizeHeader(rawKey)] = value;
  }
  const mapped = {};
  for (const [field, aliases] of Object.entries(IMPORT_FIELD_ALIASES)) {
    for (const alias of aliases) {
      const value = normalized[normalizeHeader(alias)];
      if (value !== undefined && String(value).trim() !== '') {
        mapped[field] = String(value).trim();
        break;
      }
    }
  }
  return mapped;
}

function importFromExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const db = getDb();
  const findRoom = db.prepare('SELECT id FROM rooms WHERE name = ? COLLATE NOCASE');
  const insertRoom = db.prepare('INSERT INTO rooms (name) VALUES (?)');
  const upsertAsset = db.prepare(`
    INSERT INTO assets (asset_tag, name, category, description, condition, room_id, assigned_to, status)
    VALUES (@asset_tag, @name, @category, @description, @condition, @room_id, @assigned_to, @status)
    ON CONFLICT(asset_tag) DO UPDATE SET
      name=excluded.name, category=excluded.category,
      description=excluded.description, condition=excluded.condition,
      room_id=excluded.room_id, assigned_to=excluded.assigned_to, status=excluded.status
  `);

  let imported = 0;
  const tx = db.transaction((records) => {
    for (const raw of records) {
      const row = mapRow(raw);
      if (!row.asset_tag || !row.name) continue;

      let roomId = null;
      if (row.room) {
        let r = findRoom.get(row.room);
        if (!r) { const info = insertRoom.run(row.room); roomId = info.lastInsertRowid; }
        else roomId = r.id;
      }

      const assignedTo = (row.assigned_to && row.assigned_to.toLowerCase() !== 'unassigned')
        ? row.assigned_to : null;

      const statusLower = row.status ? row.status.toLowerCase() : '';
      const status = VALID_STATUSES.has(statusLower) ? statusLower : 'active';

      upsertAsset.run({
        asset_tag: row.asset_tag,
        name: row.name,
        category: row.category || null,
        description: row.description || null,
        condition: row.condition || 'good',
        room_id: roomId,
        assigned_to: assignedTo,
        status
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

// Generates a printable QR code encoding just the asset's Asset Tag —
// the same value the mobile Scan screen sends back for matching (see
// features/inventory/services.js: it looks up asset_tag before nfc_uid),
// so a label printed with this code Just Works with the mobile scanner,
// no separate NFC tag registration required.
async function generateAssetQrDataUrl(assetTag) {
  return QRCode.toDataURL(assetTag, {
    color: { dark: '#111844', light: '#EAE0CF' },
    margin: 1,
    width: 320
  });
}

module.exports = {
  listAssets, getAsset, getAssetDetail, createAsset, updateAsset, deleteAsset,
  registerNfcTag, findAssetByNfcUid, findAssetByTag, importFromExcelBuffer, reportIssue, dashboardStats,
  generateAssetQrDataUrl
};
