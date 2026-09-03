// features/assets/services.js — CRUD logic + Excel-to-JSON bulk importer.
const XLSX = require('xlsx');
const { getDb } = require('../../core/database');

function listAssets({ roomId, search } = {}) {
  const db = getDb();
  let sql = `
    SELECT a.*, r.name AS room_name
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    WHERE 1=1
  `;
  const params = [];
  if (roomId) { sql += ' AND a.room_id = ?'; params.push(roomId); }
  if (search) { sql += ' AND (a.name LIKE ? OR a.asset_tag LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY a.name';
  return db.prepare(sql).all(...params);
}

function getAsset(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
}

function createAsset(data) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO assets (asset_tag, name, category, description, condition, acquired_date, value_php, room_id)
    VALUES (@asset_tag, @name, @category, @description, @condition, @acquired_date, @value_php, @room_id)
  `).run({
    asset_tag: data.asset_tag,
    name: data.name,
    category: data.category || null,
    description: data.description || null,
    condition: data.condition || 'good',
    acquired_date: data.acquired_date || null,
    value_php: data.value_php || null,
    room_id: data.room_id || null
  });
  return getAsset(info.lastInsertRowid);
}

function updateAsset(id, data) {
  const db = getDb();
  const existing = getAsset(id);
  if (!existing) return null;
  const merged = { ...existing, ...data, id };
  db.prepare(`
    UPDATE assets SET asset_tag=@asset_tag, name=@name, category=@category,
      description=@description, condition=@condition, acquired_date=@acquired_date,
      value_php=@value_php, room_id=@room_id WHERE id=@id
  `).run(merged);
  return getAsset(id);
}

function deleteAsset(id) {
  const db = getDb();
  db.prepare('DELETE FROM assets WHERE id = ?').run(id);
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

  return { ok: true, imported, total_rows: rows.length };
}

module.exports = {
  listAssets, getAsset, createAsset, updateAsset, deleteAsset,
  registerNfcTag, findAssetByNfcUid, importFromExcelBuffer
};
