// features/specs/services.js — reading spec definitions, and validating/saving/describing
// the values an asset has for them.
const { getDb } = require('../../core/database');
const { CATEGORIES, OTHER, categoryKey, titleCase } = require('./categories');

const ATTACHED = /\s*\(attached\)\s*$/i;

function parseOptions(text) {
  try { const a = JSON.parse(text); return Array.isArray(a) ? a : null; } catch { return null; }
}

// "Mouse (attached)" is equipment that goes with the asset rather than a spec of it, so the
// form lists it in its own group; the "(attached)" tag is dropped from the label there.
function toField(r) {
  return {
    id: r.spec_def_id, key: r.field_key,
    label: String(r.label).replace(ATTACHED, ''),
    type: r.field_type, options: parseOptions(r.options), unit: r.unit || null,
    required: !!r.is_required, attached: ATTACHED.test(r.label), order: r.display_order
  };
}

function fieldsFor(db, key) {
  if (!key) return [];
  return db.prepare('SELECT * FROM SPEC_DEFINITION WHERE category = ? ORDER BY display_order, spec_def_id').all(key).map(toField);
}

// Everything the Category dropdown and the spec window need, in one small payload.
function catalog() {
  const db = getDb();
  const byKey = new Map();
  for (const row of db.prepare('SELECT * FROM SPEC_DEFINITION ORDER BY display_order, spec_def_id').all()) {
    if (!byKey.has(row.category)) byKey.set(row.category, []);
    byKey.get(row.category).push(toField(row));
  }
  const known = new Set(CATEGORIES.map((c) => c.key));
  const extra = [...byKey.keys()].filter((k) => !known.has(k)).map((k) => ({ key: k, label: titleCase(k) })); // seeded but not listed in categories.js
  return [...CATEGORIES, ...extra, OTHER].map((c) => ({ key: c.key, label: c.label, fields: byKey.get(c.key) || [] }));
}

const YES = new Set(['1', 'true', 'yes', 'y']);
const NO = new Set(['0', 'false', 'no', 'n']);

// Checks submitted values against the category's fields. Returns { ok, rows } — rows ready for
// write() — or { ok: false, error }. `specs` undefined means "leave the saved specs alone".
function validate(categoryText, specs) {
  if (specs === undefined) return { ok: true, skip: true, rows: [] };
  if (specs === null || typeof specs !== 'object' || Array.isArray(specs)) return { ok: false, error: 'specs must be an object.' };

  const fields = fieldsFor(getDb(), categoryKey(categoryText));
  const rows = [];
  for (const f of fields) {
    let v = specs[f.key];
    v = v === undefined || v === null ? '' : String(v).trim();
    if (!v) {
      if (f.required) return { ok: false, error: `${f.label} is required.` };
      continue;
    }
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) return { ok: false, error: `${f.label} must be a number.` };
      v = String(n);
    } else if (f.type === 'boolean') {
      const b = v.toLowerCase();
      if (YES.has(b)) v = '1'; else if (NO.has(b)) v = '0';
      else return { ok: false, error: `${f.label} must be Yes or No.` };
    } else if (f.type === 'select') {
      if (f.options && !f.options.includes(v)) return { ok: false, error: `${f.label} must be one of: ${f.options.join(', ')}.` };
    } else if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: `${f.label} must be a date (YYYY-MM-DD).` };
    } else {
      v = v.slice(0, 200);
    }
    rows.push([f.id, v]);
  }
  return { ok: true, rows };
}

// Replaces ALL of an asset's saved specs with `rows` (what the form submitted is the full
// picture, so a field the person cleared is removed rather than left behind).
function write(assetId, rows) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM asset_spec WHERE asset_id = ?').run(assetId);
    const ins = db.prepare('INSERT INTO asset_spec (asset_id, spec_def_id, value) VALUES (?, ?, ?)');
    rows.forEach(([defId, value]) => ins.run(assetId, defId, value));
  })();
}

// Only specs that belong to the asset's CURRENT category are returned. (Moving an asset to another
// category clears its old specs — see updateAsset — so this filter is just a safety net.)
function savedRows(assetId, categoryText) {
  const key = categoryKey(categoryText);
  if (!key) return [];
  return getDb().prepare(`
    SELECT d.*, s.value FROM asset_spec s
    JOIN SPEC_DEFINITION d ON d.spec_def_id = s.spec_def_id
    WHERE s.asset_id = ? AND d.category = ?
    ORDER BY d.display_order, d.spec_def_id
  `).all(assetId, key);
}

// { field_key: value } — what the edit form pre-fills.
function values(assetId, categoryText) {
  return Object.fromEntries(savedRows(assetId, categoryText).map((r) => [r.field_key, r.value]));
}

// A readable list for the detail pop-up: only fields that have a value, with units and Yes/No applied.
function describe(assetId, categoryText) {
  return savedRows(assetId, categoryText).map((r) => {
    const f = toField(r);
    let display = r.value;
    if (f.type === 'boolean') display = r.value === '1' ? 'Yes' : 'No';
    else if (f.unit) display = `${r.value} ${f.unit}`;
    return { key: f.key, label: f.label, type: f.type, unit: f.unit, attached: f.attached, value: r.value, display };
  });
}

function remove(assetId) {
  getDb().prepare('DELETE FROM asset_spec WHERE asset_id = ?').run(assetId);
}

module.exports = { catalog, validate, write, values, describe, remove };
