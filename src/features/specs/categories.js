// features/specs/categories.js — the asset categories, in the order they appear in the
// Category dropdown. `key` matches SPEC_DEFINITION.category (see spec_seed.sql); `label`
// is what's shown to people AND what is stored in assets.category, so every screen that
// already prints an asset's category (detail pop-up, reports, CSV export, the phone app)
// keeps working unchanged.
//
// To add a category: add its fields to spec_seed.sql, then add a line here.
const CATEGORIES = [
  { key: 'laptop',           label: 'Laptop' },
  { key: 'tablet',           label: 'Tablet' },
  { key: 'desktop_aio',      label: 'Desktop (All-in-One)' },
  { key: 'printer',          label: 'Printer' },
  { key: 'projector',        label: 'Projector' },
  { key: 'scanner',          label: 'Scanner' },
  { key: 'camera_drone',     label: 'Camera / Drone' },
  { key: 'audio_visual',     label: 'Audio / Visual' },
  { key: 'network_security', label: 'Network / Security' },
  { key: 'external_storage', label: 'External Storage' },
  { key: 'furniture',        label: 'Furniture' },
  { key: 'office_equipment', label: 'Office Equipment' },
  { key: 'appliance',        label: 'Appliance' },
  { key: 'display_tv',       label: 'Display / TV' },
  { key: 'recorder',         label: 'Recorder' }
];

// A catch-all with no spec fields, for assets that fit none of the above.
const OTHER = { key: 'other', label: 'Other' };

const normalize = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// 'Laptop', 'laptop', 'Camera/Drone', 'camera_drone', 'CAMERA DRONE' all find the
// same category — so values from a CSV import or the phone resolve to the right one.
function categoryKey(text) {
  const n = normalize(text);
  if (!n) return null;
  const hit = [...CATEGORIES, OTHER].find((c) => normalize(c.key) === n || normalize(c.label) === n);
  return hit ? hit.key : null;
}

// The stored label for anything we recognise; anything else (an old category such as
// "Monitor", or a custom one from an import) is kept exactly as written.
function canonicalCategory(text) {
  const raw = text === undefined || text === null ? '' : String(text).trim();
  if (!raw) return null;
  const key = categoryKey(raw);
  const hit = key && [...CATEGORIES, OTHER].find((c) => c.key === key);
  return hit ? hit.label : raw;
}

const titleCase = (key) => String(key).split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

module.exports = { CATEGORIES, OTHER, categoryKey, canonicalCategory, titleCase };
