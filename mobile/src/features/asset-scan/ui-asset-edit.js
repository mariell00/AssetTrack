// mobile/features/asset-scan/ui-asset-edit.js — "Asset Info" panel. Shown right after a QR scan. A phone can change only what the person
// holding it can see for themselves:
//     Location · Condition · Status · Counted · Quantity · User
// Everything else about an asset (name, category, description, photo, value…) is the desktop's —
// it is shown here, read-only, so you know what you're looking at. The desktop enforces the same
// list, so it holds even for an older copy of this app.
//
//   Counted  — how many you actually counted just now (a physical count). Belongs to this SCAN,
//              so it only appears when the panel is opened from a scan.
//   Quantity — how many the asset record says there are. Correcting it is a change to the asset.
//
// Nothing is changed on the desktop from here: the count and edits are saved on the phone, go out
// with the next SYNC, and apply once the super admin verifies them on the Sync screen. A count
// that doesn't match the quantity is flagged for them.
import { queueAssetChanges } from './services.js';
import {
  fetchRoomsList, fetchAssignees, roomOptionsHtml, assigneeOptionsHtml,
  pairOptionsHtml, STATUS_OPTIONS, CONDITION_OPTIONS, esc
} from '../../core/lookups.js';

// "2 short", "1 over" — how far a count is from the quantity.
const gap = (counted, quantity) => (counted < quantity ? `${quantity - counted} short` : `${counted - quantity} over`);

// A whole number from `min` up, or null if the box is empty, or NaN if it isn't one.
function readWhole(input, min) {
  const raw = input.value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : NaN;
}

// asset === null means the scan didn't resolve to a known asset (either nothing is registered
// under that tag, or the phone has no connection right now to check) — reason distinguishes the
// two so the message makes sense.
//   onDone(saved, { counted })  — called when the panel is finished (saved or skipped)
//   skipLabel                   — label for the no-changes button
//   scanLocalId                 — the queued scan these edits belong to (so they sync together)
export async function renderAssetEditPanel(asset, code, reason, { onDone, scanLocalId = null, skipLabel = 'Skip — no changes' }) {
  const el = document.createElement('div');
  el.className = 'm-panel m-asset-edit';

  if (!asset) {
    const offline = reason === 'offline';
    const message = offline
      ? 'Scan saved locally. Editing details needs a connection to the desktop host — try again once you\'re back on Wi-Fi, or SYNC later.'
      : `No asset is registered under "${esc(code)}". New assets are registered on the desktop, so check this is an AssetTrack label — or ask the supply office to register it.`;
    el.innerHTML = `
      <div class="m-header">${esc(code)}</div>
      <p class="m-status">${message}</p>
      <button class="m-btn" id="m-edit-continue" type="button">Continue scanning</button>
    `;
    el.querySelector('#m-edit-continue').addEventListener('click', () => onDone());
    return el;
  }

  const [roomsResult, peopleResult] = await Promise.all([fetchRoomsList(), fetchAssignees()]);
  const rooms = roomsResult.ok ? roomsResult.rooms : [];
  const people = peopleResult.ok ? peopleResult.assignees : [];

  // What the record says now. Older assets have no stored condition/status/quantity, which means
  // good / active / 1 — comparing against THOSE (not null) stops an untouched asset from looking edited.
  const before = {
    room_id: asset.room_id ?? null,
    condition: asset.condition || 'good',
    status: asset.status || 'active',
    quantity: asset.quantity ?? 1,
    assigned_to: asset.assigned_to || null
  };
  const isScan = scanLocalId !== null && scanLocalId !== undefined;
  // A single-unit asset that has just been scanned is, by definition, counted as 1.
  const countedStart = isScan && Number(before.quantity) === 1 ? '1' : '';

  el.innerHTML = `
    <div class="m-header">✔ ${esc(asset.asset_tag)}</div>
    <form id="m-edit-form" novalidate>
      <div class="m-asset-id">
        <strong>${esc(asset.name)}</strong>
        <span class="m-hint">${esc([asset.category, asset.asset_tag].filter(Boolean).join(' · '))}</span>
      </div>
      <p class="m-hint">You can change location, condition, status, quantity and user${isScan ? ', and enter what you counted' : ''}. It's sent when you sync and applies once the super admin verifies it.</p>

      <label for="m-e-room">Location</label>
      <select id="m-e-room">${roomOptionsHtml(rooms, asset.room_id)}</select>

      <label for="m-e-condition">Condition</label>
      <select id="m-e-condition">${pairOptionsHtml(CONDITION_OPTIONS, before.condition)}</select>

      <label for="m-e-status">Status</label>
      <select id="m-e-status">${pairOptionsHtml(STATUS_OPTIONS, before.status)}</select>

      <div class="${isScan ? 'm-row2' : ''}">
        ${isScan ? `
        <div>
          <label for="m-e-counted">Counted</label>
          <input id="m-e-counted" type="number" inputmode="numeric" min="0" step="1" value="${countedStart}" placeholder="How many?" />
        </div>` : ''}
        <div>
          <label for="m-e-quantity">Quantity <span class="m-label-optional">on record</span></label>
          <input id="m-e-quantity" type="number" inputmode="numeric" min="1" step="1" value="${esc(before.quantity)}" />
        </div>
      </div>
      ${isScan ? '<p id="m-count-note" class="m-count-note" aria-live="polite"></p>' : ''}

      <label for="m-e-assigned">User</label>
      <select id="m-e-assigned">${assigneeOptionsHtml(people, before.assigned_to || '')}</select>

      <button class="m-btn" type="submit">Save for sync</button>
      <button class="m-btn m-btn-secondary" id="m-edit-skip" type="button">${esc(skipLabel)}</button>
      <p id="m-edit-error" class="m-error"></p>
    </form>
  `;

  const $ = (id) => el.querySelector(id);
  $('#m-edit-skip').addEventListener('click', () => onDone());

  // Live comparison of what you counted with the quantity the record will have.
  const noteEl = $('#m-count-note');
  function updateCountNote() {
    if (!noteEl) return;
    const counted = readWhole($('#m-e-counted'), 0);
    const quantity = readWhole($('#m-e-quantity'), 1);
    noteEl.className = 'm-count-note';
    if (counted === null || Number.isNaN(counted) || quantity === null || Number.isNaN(quantity)) { noteEl.textContent = ''; return; }
    if (counted === quantity) { noteEl.textContent = 'Matches the quantity on record.'; return; }
    noteEl.classList.add('is-warn');
    noteEl.textContent = `Counted ${counted} of ${quantity} on record — ${gap(counted, quantity)}. The super admin will be asked to check.`;
  }
  if (noteEl) { $('#m-e-counted').addEventListener('input', updateCountNote); $('#m-e-quantity').addEventListener('input', updateCountNote); updateCountNote(); }

  $('#m-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = $('button[type="submit"]');
    const errorEl = $('#m-edit-error');
    errorEl.textContent = '';

    const quantity = readWhole($('#m-e-quantity'), 1);
    const countedBox = $('#m-e-counted');
    const counted = countedBox ? readWhole(countedBox, 0) : null;
    if (quantity === null || Number.isNaN(quantity)) { errorEl.textContent = 'Quantity must be a whole number, 1 or more.'; return; }
    if (Number.isNaN(counted)) { errorEl.textContent = 'Counted must be a whole number, 0 or more.'; return; }

    const roomValue = $('#m-e-room').value;
    const payload = {
      // A room_id from the managed list, not a free-typed name; "" (Unassigned) becomes null.
      room_id: roomValue ? Number(roomValue) : null,
      condition: $('#m-e-condition').value,
      status: $('#m-e-status').value,
      quantity,
      assigned_to: $('#m-e-assigned').value || null
    };

    // Send only what actually differs from the record, so the desktop shows the super admin exactly
    // what would change.
    const changes = {};
    for (const [key, value] of Object.entries(payload)) {
      if ((before[key] ?? null) !== (value ?? null)) changes[key] = value;
    }
    const hasChanges = Object.keys(changes).length > 0;
    if (!hasChanges && counted === null) {
      onDone(false); // nothing was changed and nothing counted
      return;
    }

    submitBtn.disabled = true;
    try {
      await queueAssetChanges(asset.asset_tag, changes, { scanLocalId, counted });
    } catch {
      submitBtn.disabled = false;
      errorEl.textContent = 'Could not save on this phone. Try again.';
      return;
    }
    submitBtn.disabled = false;
    onDone(hasChanges, { counted });
  });

  return el;
}
