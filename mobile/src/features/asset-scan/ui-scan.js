// mobile/features/asset-scan/ui-scan.js — list view showing verified/unverified
// assets for the room currently being inventoried. After each scan, the
// camera pauses and the Asset Info panel comes up so staff can correct
// details (condition, status, room, etc.) on the spot before scanning the
// next item — not just log a bare "verified" tick.
import { renderScanner } from '../qr-reader/ui-scanner.js';
import { recordScan, fetchAssetByTag, fetchRooms } from './services.js';
import { renderAssetEditPanel } from './ui-asset-edit.js';

const LAST_ROOM_KEY = 'assettrack_mobile_last_room';

export function renderAssetScan() {
  const el = document.createElement('div');
  el.className = 'm-screen m-asset-scan';
  el.innerHTML = `
    <div class="m-room-picker">
      <label for="m-room-select">ROOM BEING INVENTORIED</label>
      <select id="m-room-select"><option value="">Loading rooms…</option></select>
    </div>
    <div id="m-scanner-slot"></div>
    <div id="m-scanned-list" class="m-scanned-list"></div>
  `;

  const list = el.querySelector('#m-scanned-list');
  const slot = el.querySelector('#m-scanner-slot');
  const roomSelect = el.querySelector('#m-room-select');
  const scanned = []; // [{ code, name }]
  let scannerEl = null;
  let editEl = null;
  let busy = false; // true while an edit panel is showing / a lookup is in flight
  // Every scan gets tagged with whichever room is selected here — this is
  // what makes a scan actually count toward that room's progress card and
  // show up correctly (not lumped under "Unassigned") in the Admin Hub's
  // Inventory Sync screen and Mobile Check-in Log.
  let roomId = localStorage.getItem(LAST_ROOM_KEY) || '';

  async function loadRooms() {
    const result = await fetchRooms();
    if (!result.ok || result.rooms.length === 0) {
      roomSelect.innerHTML = '<option value="">Unassigned</option>';
      return;
    }
    roomSelect.innerHTML = result.rooms.map((r) =>
      `<option value="${r.room_id}" ${String(r.room_id) === roomId ? 'selected' : ''}>${r.room_name}</option>`
    ).join('');
    roomId = roomSelect.value;
  }

  roomSelect.addEventListener('change', () => {
    roomId = roomSelect.value;
    localStorage.setItem(LAST_ROOM_KEY, roomId);
  });

  function refreshList() {
    list.innerHTML = scanned
      .map(({ code, name }) => `<div class="m-row">✔ ${code}${name ? ` — ${name}` : ''}</div>`)
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
    if (scanned.some((s) => s.code === code)) return;
    busy = true;

    unmountScanner();
    await recordScan(code, roomId || null, 'verified');

    const result = await fetchAssetByTag(code);
    const asset = result.ok ? result.asset : null;
    scanned.push({ code, name: asset ? asset.name : null });
    refreshList();

    const reason = !result.ok && result.offline ? 'offline' : 'not_found';
    editEl = renderAssetEditPanel(asset, code, reason, {
      onDone: () => {
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
