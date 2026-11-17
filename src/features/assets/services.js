// features/assets/services.js — CRUD logic + Excel-to-JSON bulk importer.
const QRCode = require('qrcode');
const { getDb } = require('../../core/database');

function listAssets({ roomId, search } = {}) {
  const db = getDb();
  let sql = `
    SELECT a.*, r.name AS room_name, p.photo AS assigned_photo
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN people p ON p.name = a.assigned_to COLLATE NOCASE
    WHERE 1=1
  `;
  const params = [];
  if (roomId) { sql += ' AND a.room_id = ?'; params.push(roomId); }
  if (search) {
    // Also finds what is written on the custodian sheet: property no., ICS no., serial no., description.
    sql += ` AND (a.name LIKE ? OR a.asset_tag LIKE ? OR a.property_no LIKE ? OR a.ics_no LIKE ? OR a.serial_no LIKE ? OR a.description LIKE ? OR a.assigned_to LIKE ?)`;
    for (let i = 0; i < 7; i++) params.push(`%${search}%`);
  }
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
    SELECT a.*, r.name AS room_name, COALESCE(b.name, r.building) AS building_name, p.photo AS assigned_photo
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN buildings b ON b.id = r.building_id
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

  // Shown in the Asset Registry's detail pop-up (the mobile app ignores the extras).
  const recentScans = db.prepare(`
    SELECT l.scanned_at, l.status, l.scanned_by, l.counted, r.name AS room_name
    FROM inventory_logs l
    LEFT JOIN rooms r ON r.id = l.room_id
    WHERE l.asset_id = ?
    ORDER BY l.id DESC
    LIMIT 5
  `).all(id);

  const issues = db.prepare(`
    SELECT id, reported_by, note, resolved, created_at
    FROM asset_issues
    WHERE asset_id = ?
    ORDER BY resolved ASC, id DESC
    LIMIT 5
  `).all(id);

  // Specifications and attached equipment for the asset's category (empty for "Other" / older categories).
  const specsSvc = require('../specs/services');
  return {
    ...asset, room_name: asset.room_name, last_scanned: lastScanned, open_issues: openIssues,
    recent_scans: recentScans, issues,
    specs: specsSvc.describe(id, asset.category),
    spec_values: specsSvc.values(id, asset.category)
  };
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

// System-generated Asset ID: AST-0001, AST-0002, ... Numbered from the table's
// own auto-increment counter (sqlite_sequence), so a number is never handed out
// twice even after assets are deleted — an old QR label can't end up pointing
// at a different item. Skips ahead if a tag (e.g. from a CSV import) is taken.
function generateAssetTag(db) {
  const row = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'assets'`).get();
  const taken = db.prepare('SELECT 1 AS x FROM assets WHERE asset_tag = ?');
  let n = (row ? Number(row.seq) : 0) + 1;
  let tag;
  do { tag = `AST-${String(n).padStart(4, '0')}`; n += 1; } while (taken.get(tag));
  return tag;
}

// Throws a 400-style error the route turns into a readable message (nothing has been saved yet).
function rejectBadSpecs(check) {
  if (check.ok) return;
  const err = new Error(check.error);
  err.status = 400;
  throw err;
}

function textOrNull(v) { const s = v === undefined || v === null ? '' : String(v).trim(); return s || null; }
function intOrNull(v) { if (v === undefined || v === null || v === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) ? n : null; }

function createAsset(data) {
  const db = getDb();
  const specs = require('../specs/services');
  const category = require('../specs/categories').canonicalCategory(data.category);
  // Checked BEFORE anything is saved, so a bad spec never leaves a half-registered asset behind.
  const specCheck = specs.validate(category, data.specs);
  rejectBadSpecs(specCheck);
  // The Asset ID is generated here. Only an import (or an older client) supplies
  // one; a phone's registration never does (see inventory/services.js).
  const assetTag = (data.asset_tag && String(data.asset_tag).trim()) || generateAssetTag(db);
  const roomId = data.room_id || resolveRoomId(db, data.room_name);
  // Same person, different spelling -> the assignee already on the list (see assignees/names.js).
  const assignedTo = require('../assignees/services').ensurePerson(db, data.assigned_to);
  const info = db.prepare(`
    INSERT INTO assets (asset_tag, name, category, description, condition, status, acquired_date, value_php, room_id, assigned_to, photo, client_uuid,
                        property_no, ics_no, serial_no, useful_life, quantity, end_user_unit, remarks)
    VALUES (@asset_tag, @name, @category, @description, @condition, @status, @acquired_date, @value_php, @room_id, @assigned_to, @photo, @client_uuid,
            @property_no, @ics_no, @serial_no, @useful_life, @quantity, @end_user_unit, @remarks)
  `).run({
    asset_tag: assetTag,
    name: data.name,
    category,
    description: data.description || null,
    condition: data.condition || 'good',
    status: data.status || 'active',
    acquired_date: data.acquired_date || null,
    value_php: data.value_php === undefined || data.value_php === '' ? null : data.value_php, // 0 is a real amount
    room_id: roomId,
    assigned_to: assignedTo,
    photo: data.photo || null,
    client_uuid: data.client_uuid || null, // the phone's internal reference, when verified from a registration
    property_no: textOrNull(data.property_no),
    ics_no: textOrNull(data.ics_no),
    serial_no: textOrNull(data.serial_no),
    useful_life: intOrNull(data.useful_life),
    quantity: intOrNull(data.quantity) || 1,
    end_user_unit: textOrNull(data.end_user_unit),
    remarks: textOrNull(data.remarks)
  });

  if (!specCheck.skip) specs.write(info.lastInsertRowid, specCheck.rows);

  // `assigned_photo` here is whatever the Asset Registry modal's "ASSIGNED
  // USER PHOTO" field just picked — remembered against the person's name
  // (people table) rather than this asset row.
  if (data.assigned_photo) upsertPersonPhoto(db, assignedTo, data.assigned_photo);

  require('../system/services').logEvent('IMPORT', `Asset ${assetTag} registered: ${data.name}`, 'success');
  return getAsset(info.lastInsertRowid);
}

function updateAsset(id, data) {
  const db = getDb();
  const existing = getAsset(id);
  if (!existing) return null;
  const roomId = data.room_name !== undefined ? resolveRoomId(db, data.room_name) : (data.room_id !== undefined ? data.room_id : existing.room_id);
  const { specs: submittedSpecs, ...fields } = data;
  const category = data.category !== undefined ? require('../specs/categories').canonicalCategory(data.category) : existing.category;
  // Specs are checked against the category the asset will have AFTER this save, before anything changes.
  const specs = require('../specs/services');
  const specCheck = specs.validate(category, submittedSpecs);
  rejectBadSpecs(specCheck);
  const merged = { ...existing, ...fields, category, room_id: roomId, id };
  for (const k of ['property_no', 'ics_no', 'serial_no', 'end_user_unit', 'remarks']) merged[k] = textOrNull(merged[k]);
  if (fields.assigned_to !== undefined) merged.assigned_to = require('../assignees/services').ensurePerson(db, fields.assigned_to);
  merged.useful_life = intOrNull(merged.useful_life);
  merged.quantity = intOrNull(merged.quantity) || 1;
  db.prepare(`
    UPDATE assets SET asset_tag=@asset_tag, name=@name, category=@category,
      description=@description, condition=@condition, status=@status, acquired_date=@acquired_date,
      value_php=@value_php, room_id=@room_id, assigned_to=@assigned_to, photo=@photo,
      property_no=@property_no, ics_no=@ics_no, serial_no=@serial_no, useful_life=@useful_life,
      quantity=@quantity, end_user_unit=@end_user_unit, remarks=@remarks WHERE id=@id
  `).run(merged);

  if (!specCheck.skip) specs.write(id, specCheck.rows);
  // Specs belong to a category: moving the asset to another one without supplying new specs
  // (e.g. a phone's edit, approved later) must not leave the old category's values behind.
  else if (category !== existing.category) specs.remove(id);

  // Save against whichever name the asset ends up assigned to after this
  // update (merged.assigned_to), same as createAsset() above.
  if (data.assigned_photo) upsertPersonPhoto(db, merged.assigned_to, data.assigned_photo);

  const { logEvent } = require('../system/services');
  if (data.status && data.status !== existing.status) {
    logEvent('UPDATE', `${merged.asset_tag} status: ${data.status.toUpperCase()}`, data.status === 'active' ? 'success' : 'warn');
  }
  return getAsset(id);
}

function deleteAsset(id) {
  const db = getDb();
  const existing = getAsset(id);
  // Explicit, in case foreign-key cascades are off: nothing waiting for review may outlive its asset.
  db.prepare('DELETE FROM pending_scans WHERE asset_id = ?').run(id);
  require('../specs/services').remove(id);
  db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  if (existing) require('../system/services').logEvent('UPDATE', `Asset ${existing.asset_tag} deleted`, 'warn');
  return { ok: true };
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

// Bulk import: reads an uploaded .csv / .xlsx and hands every row to the Inventory Sync review
// queue (inventory/services.js -> queueImportBatch). Nothing becomes an asset, and no existing
// asset changes, until the super admin verifies it there. Reading, column matching and value
// cleaning live in importer.js (built around the property custodian sheet: Date Acquired,
// ICS No., Property No., Item Description, Eul, Qty., End-User, Amount).
function importFromExcelBuffer(buffer, meta = {}) {
  const parsed = require('./importer').parseUpload(buffer);
  if (parsed.error) throw new Error(parsed.error);
  const queued = require('../inventory/services').queueImportBatch(parsed.records, meta);
  return {
    ok: true,
    total_rows: parsed.totalRows,
    invalid: parsed.skipped.length,
    skipped_rows: parsed.skipped.slice(0, 20),
    columns_read: parsed.mappedColumns,
    columns_kept_in_remarks: parsed.unmappedColumns,
    ...queued,
    needs_review: queued.queued > 0
  };
}

// Dashboard headline numbers: Total Assets / Verified Today / Pending Sync / Maintenance Due
function dashboardStats() {
  const db = getDb();
  const totalAssets = db.prepare('SELECT COUNT(*) AS c FROM assets').get().c;
  const verifiedToday = db.prepare(`
    SELECT COUNT(DISTINCT asset_id) AS c FROM inventory_logs
    WHERE status = 'verified' AND date(scanned_at) = date('now')
  `).get().c;
  // Pending sync = everything a phone or an import sent that still waits for the super admin to
  // verify it: the same number as the badge on the Inventory Sync menu item.
  const pendingSync = require('../inventory/services').pendingCount().count;
  const maintenanceDue = db.prepare(`SELECT COUNT(*) AS c FROM assets WHERE status = 'maintenance'`).get().c;

  return { totalAssets, verifiedToday, pendingSync, maintenanceDue };
}

// Generates a printable QR code encoding just the asset's Asset Tag —
// the same value the mobile Scan screen sends back for matching (see
// features/inventory/services.js, which looks scans up by asset_tag), so a
// label printed with this code works with the mobile scanner as-is.
async function generateAssetQrDataUrl(assetTag) {
  return QRCode.toDataURL(assetTag, {
    color: { dark: '#0F172A', light: '#FFFFFF' },
    margin: 1,
    width: 320
  });
}

module.exports = {
  listAssets, getAsset, getAssetDetail, createAsset, updateAsset, deleteAsset,
  findAssetByTag, importFromExcelBuffer, reportIssue, dashboardStats,
  generateAssetQrDataUrl
};
