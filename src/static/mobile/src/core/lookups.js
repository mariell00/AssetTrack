// mobile/src/core/lookups.js — the pick-lists the desktop Asset Registry form
// uses (rooms by building, categories, assignees, status, condition), shared
// by the Register form and the Asset Info panel so both match the desktop.
//
// Rooms and assignees are cached on the phone after every successful fetch,
// so the Scanner's room picker still works with no Wi-Fi (it is an
// offline-first screen — the room has to be tagged on each scan).
import { apiGet } from './api-client.js';

const ROOMS_KEY = 'assettrack_mobile_rooms_cache';
const ASSIGNEES_KEY = 'assettrack_mobile_assignees_cache';

// Same list as the desktop Asset Registry (src/features/assets/ui.js).
export const CATEGORY_OPTIONS = [
  'Personal Computer', 'Laptop', 'Monitor', 'Printer', 'Projector',
  'Network Equipment', 'Air Conditioner', 'Furniture', 'Laboratory Equipment', 'Other'
];
export const STATUS_OPTIONS = [['active', 'ACTIVE'], ['pending', 'PENDING'], ['maintenance', 'MAINT.'], ['offline', 'OFFLINE']];
export const CONDITION_OPTIONS = [['good', 'GOOD'], ['fair', 'FAIR'], ['poor', 'POOR']];

export function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function cachedList(path, key, field) {
  const result = await apiGet(path);
  if (result.ok && Array.isArray(result[field])) {
    try { localStorage.setItem(key, JSON.stringify(result[field])); } catch { /* storage full: just skip caching */ }
    return { ok: true, [field]: result[field] };
  }
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (Array.isArray(cached)) return { ok: true, cached: true, [field]: cached };
  } catch { /* unreadable cache: fall through */ }
  return result;
}

// The managed room list (Locations screen on the desktop), grouped by building.
export const fetchRoomsList = () => cachedList('/api/v1/map/rooms/list', ROOMS_KEY, 'rooms');
// Active assignees (Manage Assignees on the desktop) — what ASSIGNED TO offers there.
export const fetchAssignees = () => cachedList('/api/v1/assignees?status=active', ASSIGNEES_KEY, 'assignees');

export function clearLookupCache() {
  localStorage.removeItem(ROOMS_KEY);
  localStorage.removeItem(ASSIGNEES_KEY);
}

export function roomOptionsHtml(rooms, selectedId, placeholder = '— Unassigned —') {
  const grouped = new Map();
  for (const r of rooms) {
    const key = r.building_name || null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }
  const optionHtml = (r) => `<option value="${esc(r.id)}" ${String(selectedId ?? '') === String(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`;
  let html = `<option value="">${esc(placeholder)}</option>`;
  for (const [buildingName, inBuilding] of grouped) {
    html += buildingName
      ? `<optgroup label="${esc(buildingName)}">${inBuilding.map(optionHtml).join('')}</optgroup>`
      : inBuilding.map(optionHtml).join('');
  }
  return html;
}

// Keeps whatever value the asset already has even if it's not in the list
// (e.g. an imported category), so editing never silently wipes it.
export function categoryOptionsHtml(selected) {
  const extra = selected && !CATEGORY_OPTIONS.includes(selected) ? [selected] : [];
  return `<option value="">— Select category —</option>`
    + [...CATEGORY_OPTIONS, ...extra].map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

export function assigneeOptionsHtml(assignees, current) {
  const names = assignees.map((p) => p.name);
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  if (current && !names.some((n) => same(n, current))) names.unshift(current);
  return `<option value="">— Unassigned —</option>`
    + names.map((n) => `<option value="${esc(n)}" ${current && same(n, current) ? 'selected' : ''}>${esc(n)}</option>`).join('');
}

export function pairOptionsHtml(pairs, selected) {
  const known = pairs.some(([v]) => v === selected);
  const extra = selected && !known ? [[selected, String(selected).toUpperCase()]] : [];
  return [...pairs, ...extra].map(([v, label]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
}
