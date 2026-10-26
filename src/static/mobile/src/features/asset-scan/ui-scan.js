// mobile/features/asset-scan/ui-scan.js — the Scanner: the first screen after
// login. Shows the camera, and a list of what's been scanned this session.
// After each scan the camera pauses and the Asset Info panel comes up so the
// admin can correct details (condition, status, room, etc.) on the spot
// before scanning the next item — not just log a bare "verified" tick.
import { renderScanner } from '../qr-reader/ui-scanner.js';
import { recordScan, fetchAssetByTag, fetchRoomsList } from './services.js';
import { renderAssetEditPanel } from './ui-asset-edit.js';
import { roomOptionsHtml, esc } from '../../core/lookups.js';

const LAST_ROOM_KEY = 'assettrack_mobile_last_room';

// Lives at module level (not inside renderAssetScan) because the Scanner
// screen is rebuilt every time you come back to it from the menu — the
// session list shouldn't vanish just because you looked at the Registry.
const session = { scanned: [] }; // [{ code, name, changed }]

export function resetScanSession() { session.scanned = []; }

export function renderAssetScan() {
  const el = document.createElement('div');
  el.className = 'm-screen m-asset-scan';
  el.innerHTML = `
    <div class="m-room-picker">
      <label for="m-room-select">Room being inventoried</label>
      <select id="m-room-select"><option value="">Loading rooms…</option></select>
      <p id="m-room-hint" class="m-hint" hidden>No room selected — scans will be filed as Unassigned.</p>
    </div>
    <div id="m-scanner-slot"></div>
    <div id="m-scanned-list" class="m-scanned-list"></div>
  `;

  const list = el.querySelector('#m-scanned-list');
  const slot = el.querySelector('#m-scanner-slot');
  const roomSelect = el.querySelector('#m-room-select');
  const roomHint = el.querySelector('#m-room-hint');
  let scannerEl = null;
  let editEl = null;
  let busy = false; // true while an edit panel is showing / a lookup is in flight
  // Every scan gets tagged with whichever room is selected here — this is
  // what makes a scan count toward that room's progress card (and not get
  // lumped under "Unassigned") in the desktop's Inventory Sync screen.
  let roomId = '';

  async function loadRooms() {
    const result = await fetchRoomsList(); // falls back to the phone's cached list when offline
    const rooms = result.ok ? result.rooms : [];
    const saved = localStorage.getItem(LAST_ROOM_KEY) || '';
    // No silent default: if the saved room is gone (or none was ever picked)
    // the picker says so, instead of quietly filing scans under the first room.
    roomSelect.innerHTML = roomOptionsHtml(rooms, saved, rooms.length ? '— Select room —' : 'No rooms available');
    roomId = roomSelect.value;
    roomHint.hidden = !!roomId;
  }

  roomSelect.addEventListener('change', () => {
    roomId = roomSelect.value;
    localStorage.setItem(LAST_ROOM_KEY, roomId);
    roomHint.hidden = !!roomId;
  });

  function refreshList() {
    list.innerHTML = session.scanned
      .map(({ code, name, changed }) => `<div class="m-row">✔ ${esc(code)}${name ? ` — ${esc(name)}` : ''}${changed ? ' · edits saved' : ''}</div>`)
      .join('') || '<p class="m-status">No assets scanned yet in this session.</p>';
  }

  function mountScanner() {
    scannerEl = renderScanner(handleCode);
    slot.appendChild(scannerEl);
  }

  function unmountScanner() {
    scannerEl?.remove();
    scannerEl = null;
  }

  async function handleCode(code) {
    if (busy) return;
    if (session.scanned.some((s) => s.code === code)) return;
    busy = true;

    unmountScanner();
    const scanLocalId = await recordScan(code, roomId || null, 'verified');

    const result = await fetchAssetByTag(code);
    const asset = result.ok ? result.asset : null;
    const entry = { code, name: asset ? asset.name : null, changed: false };
    session.scanned.push(entry);
    refreshList();

    const reason = !result.ok && result.offline ? 'offline' : 'not_found';
    editEl = await renderAssetEditPanel(asset, code, reason, {
      scanLocalId,
      onDone: (saved) => {
        if (saved === true) { entry.changed = true; refreshList(); }
        editEl?.remove();
        editEl = null;
        busy = false;
        mountScanner();
      }
    });
    slot.appendChild(editEl);
  }

  loadRooms();
  mountScanner();
  refreshList();
  return el;
}
