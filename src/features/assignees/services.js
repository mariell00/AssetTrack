// features/assignees/services.js — CRUD for the people assets are assigned to.
const { getDb } = require('../../core/database');

const clean = (v) => (v === undefined || v === null ? null : (String(v).trim() || null));

// Assignee rows + how many assets each currently holds. `assets` is matched
// by name, case-insensitively, the same way the asset queries join `people`.
function listAssignees({ search, status } = {}) {
  const db = getDb();
  let sql = `
    SELECT p.id, p.name, p.position, p.department, p.contact, p.photo, p.status, p.created_at,
           (SELECT COUNT(*) FROM assets a WHERE a.assigned_to = p.name COLLATE NOCASE) AS asset_count
    FROM people p
    WHERE 1=1
  `;
  const params = [];
  if (status === 'active' || status === 'inactive') { sql += ' AND p.status = ?'; params.push(status); }
  if (search) {
    sql += ' AND (p.name LIKE ? OR p.position LIKE ? OR p.department LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY p.name COLLATE NOCASE';
  return db.prepare(sql).all(...params);
}

function getAssignee(id) {
  const db = getDb();
  return db.prepare(`
    SELECT p.id, p.name, p.position, p.department, p.contact, p.photo, p.status, p.created_at,
           (SELECT COUNT(*) FROM assets a WHERE a.assigned_to = p.name COLLATE NOCASE) AS asset_count
    FROM people p WHERE p.id = ?
  `).get(id);
}

function nameTaken(db, name, exceptId = null) {
  const row = db.prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE').get(name);
  return !!row && Number(row.id) !== Number(exceptId);
}

function createAssignee(data) {
  const db = getDb();
  const name = clean(data.name);
  if (!name) return { ok: false, status: 400, error: 'Name is required.' };
  if (nameTaken(db, name)) return { ok: false, status: 409, error: `“${name}” is already on the assignee list.` };

  const info = db.prepare(`
    INSERT INTO people (name, position, department, contact, photo, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
  `).run(name, clean(data.position), clean(data.department), clean(data.contact), data.photo || null);

  require('../system/services').logEvent('UPDATE', `Assignee added: ${name}`, 'success');
  return { ok: true, assignee: getAssignee(info.lastInsertRowid) };
}

function updateAssignee(id, data) {
  const db = getDb();
  const existing = getAssignee(id);
  if (!existing) return { ok: false, status: 404, error: 'Assignee not found.' };

  const name = data.name !== undefined ? clean(data.name) : existing.name;
  if (!name) return { ok: false, status: 400, error: 'Name is required.' };
  if (nameTaken(db, name, id)) return { ok: false, status: 409, error: `“${name}” is already on the assignee list.` };

  const status = data.status === undefined ? existing.status : data.status;
  if (!['active', 'inactive'].includes(status)) return { ok: false, status: 400, error: "status must be 'active' or 'inactive'." };

  const pick = (key) => (data[key] !== undefined ? clean(data[key]) : existing[key]);
  // `photo` omitted keeps the current one; an explicit null clears it.
  const photo = data.photo !== undefined ? (data.photo || null) : existing.photo;

  // Assets point at a person by name, so a rename has to carry over to them
  // in the same step or they'd silently become "unlinked" strings.
  db.transaction(() => {
    db.prepare(`
      UPDATE people SET name=?, position=?, department=?, contact=?, photo=?, status=?, updated_at=datetime('now')
      WHERE id=?
    `).run(name, pick('position'), pick('department'), pick('contact'), photo, status, id);
    if (name !== existing.name) {
      db.prepare('UPDATE assets SET assigned_to = ? WHERE assigned_to = ? COLLATE NOCASE').run(name, existing.name);
    }
  })();

  require('../system/services').logEvent(
    'UPDATE',
    name !== existing.name ? `Assignee renamed: ${existing.name} → ${name}` : `Assignee updated: ${name}`,
    'info'
  );
  return { ok: true, assignee: getAssignee(id) };
}

// An assignee who still holds assets can't be deleted — that would leave
// those assets pointing at a name nobody manages. Deactivate instead (hides
// them from the dropdown, keeps their assets and photo intact).
function deleteAssignee(id) {
  const db = getDb();
  const existing = getAssignee(id);
  if (!existing) return { ok: false, status: 404, error: 'Assignee not found.' };
  if (existing.asset_count > 0) {
    return {
      ok: false, status: 409,
      error: `${existing.name} still has ${existing.asset_count} asset${existing.asset_count === 1 ? '' : 's'} assigned. Reassign them first, or deactivate this assignee instead.`
    };
  }
  db.prepare('DELETE FROM people WHERE id = ?').run(id);
  require('../system/services').logEvent('UPDATE', `Assignee removed: ${existing.name}`, 'warn');
  return { ok: true };
}

// Called whenever an asset is saved with an assigned_to name (desktop form,
// mobile free-text field, spreadsheet import) so that name always exists in
// the list — keeps mobile-typed names from becoming invisible to the panel.
function ensurePerson(db, name) {
  const n = clean(name);
  if (!n) return;
  db.prepare(`INSERT OR IGNORE INTO people (name, created_at) VALUES (?, datetime('now'))`).run(n);
}

module.exports = { listAssignees, getAssignee, createAssignee, updateAssignee, deleteAssignee, ensurePerson };
