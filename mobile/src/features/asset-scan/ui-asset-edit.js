// mobile/features/asset-scan/ui-asset-edit.js — "Asset Info" panel shown
// right after a QR scan, letting staff correct/update the asset's details
// on the spot (condition, status, category, room, etc.) instead of only
// marking it verified. Mirrors the field set of the Admin Hub's Asset
// Registry edit modal (src/features/assets/ui.js) so nothing typed here
// looks out of place when viewed later on the desktop.
import { updateAssetDetail, fetchRoomsList } from './services.js';
import { compressImageFile } from '../../core/photo.js';

const STATUS_OPTIONS = [
  ['active', 'ACTIVE'],
  ['pending', 'PENDING'],
  ['maintenance', 'MAINT.'],
  ['offline', 'OFFLINE']
];

// Rooms are a managed list now (mapping/ui-locations.js on the desktop),
// grouped by building — this is what the ROOM <select> below is built
// from instead of a free-typed name, so a scan-time correction can't
// accidentally create "Lab 201" as a second room next to "Room 201".
function roomOptionsHtml(rooms, selectedRoomId) {
  const grouped = new Map();
  for (const r of rooms) {
    const key = r.building_name || null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }
  const optionHtml = (r) => `<option value="${r.id}" ${Number(selectedRoomId) === r.id ? 'selected' : ''}>${r.name}</option>`;

  let html = `<option value="">— Unassigned —</option>`;
  for (const [buildingName, roomsInBuilding] of grouped) {
    html += buildingName
      ? `<optgroup label="${buildingName}">${roomsInBuilding.map(optionHtml).join('')}</optgroup>`
      : roomsInBuilding.map(optionHtml).join('');
  }
  return html;
}

// asset === null means the scan didn't resolve to a known asset (either
// nothing registered under that tag, or the phone has no connection right
// now to check) — reason distinguishes the two so the message makes sense.
export async function renderAssetEditPanel(asset, code, reason, { onDone }) {
  const el = document.createElement('div');
  el.className = 'm-panel m-asset-edit';

  if (!asset) {
    const message = reason === 'offline'
      ? 'Scan saved locally. Editing details needs a connection to the desktop host — try again once you\'re back on Wi-Fi, or SYNC later.'
      : `No asset is registered under "${code}" yet. Register it from the REGISTER tab, or check the label.`;
    el.innerHTML = `
      <div class="m-header">${code}</div>
      <p class="m-status">${message}</p>
      <button class="m-btn" id="m-edit-continue" type="button">▶ CONTINUE SCANNING</button>
    `;
    el.querySelector('#m-edit-continue').addEventListener('click', () => onDone());
    return el;
  }

  const roomsResult = await fetchRoomsList();
  const rooms = roomsResult.ok ? roomsResult.rooms : [];

  el.innerHTML = `
    <div class="m-header">✔ ${asset.asset_tag}</div>
    <form id="m-edit-form">
      <label>NAME</label>
      <input id="m-e-name" required value="${escapeAttr(asset.name || '')}" />
      <label>CATEGORY</label>
      <input id="m-e-category" placeholder="optional" value="${escapeAttr(asset.category || '')}" />
      <label>ROOM</label>
      <select id="m-e-room">${roomOptionsHtml(rooms, asset.room_id)}</select>
      <label>ASSIGN TO <span class="m-label-optional">(person or name, optional)</span></label>
      <input id="m-e-assigned" placeholder="e.g. Juan Dela Cruz" value="${escapeAttr(asset.assigned_to || '')}" />
      <label>CONDITION</label>
      <input id="m-e-condition" placeholder="e.g. good, fair, poor" value="${escapeAttr(asset.condition || '')}" />
      <label>STATUS</label>
      <select id="m-e-status">
        ${STATUS_OPTIONS.map(([val, label]) =>
          `<option value="${val}" ${asset.status === val ? 'selected' : ''}>${label}</option>`
        ).join('')}
      </select>
      <label>DESCRIPTION</label>
      <textarea id="m-e-description" rows="2" placeholder="optional">${escapeText(asset.description || '')}</textarea>
      <label>PHOTO <span class="m-label-optional">(optional — leave as-is to keep the current one)</span></label>
      <div class="m-photo-row">
        <img id="m-e-photo-preview" class="m-photo-preview" src="${asset.photo || ''}" style="${asset.photo ? '' : 'display:none;'}" alt="" />
        <label class="m-btn m-btn-secondary m-photo-pick">
          <span id="m-e-photo-label">▶ ${asset.photo ? 'RETAKE / CHANGE PHOTO' : 'TAKE / CHOOSE PHOTO'}</span>
          <input type="file" id="m-e-photo" accept="image/*" capture="environment" hidden />
        </label>
      </div>
      <button class="m-btn" type="submit">▶ SAVE CHANGES</button>
      <button class="m-btn m-btn-secondary" id="m-edit-skip" type="button">SKIP — NO CHANGES</button>
      <p id="m-edit-error" class="m-error"></p>
    </form>
  `;

  el.querySelector('#m-edit-skip').addEventListener('click', () => onDone());

  let newPhotoDataUrl = null; // stays null unless a new photo is picked, so saving without touching PHOTO keeps the existing one
  const photoInput = el.querySelector('#m-e-photo');
  const photoPreview = el.querySelector('#m-e-photo-preview');
  const photoLabel = el.querySelector('#m-e-photo-label');
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    photoLabel.textContent = 'COMPRESSING…';
    try {
      newPhotoDataUrl = await compressImageFile(file);
      photoPreview.src = newPhotoDataUrl;
      photoPreview.style.display = 'block';
      photoLabel.textContent = '▶ RETAKE / CHANGE PHOTO';
    } catch {
      newPhotoDataUrl = null;
      photoLabel.textContent = '▶ TAKE / CHOOSE PHOTO — failed, try again';
    }
  });

  el.querySelector('#m-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = el.querySelector('button[type="submit"]');
    const errorEl = el.querySelector('#m-edit-error');
    submitBtn.disabled = true;
    errorEl.textContent = '';

    const payload = {
      name: el.querySelector('#m-e-name').value.trim(),
      category: el.querySelector('#m-e-category').value.trim() || null,
      assigned_to: el.querySelector('#m-e-assigned').value.trim() || null,
      condition: el.querySelector('#m-e-condition').value.trim() || null,
      status: el.querySelector('#m-e-status').value,
      description: el.querySelector('#m-e-description').value.trim() || null
    };
    // Room comes from the managed list now (see roomOptionsHtml above) —
    // a room_id, not a free-typed name; "" (Unassigned) becomes null.
    const roomValue = el.querySelector('#m-e-room').value;
    payload.room_id = roomValue ? Number(roomValue) : null;
    // Only send `photo` if a new one was actually picked — omitting the
    // key (rather than sending null) is what keeps updateAsset() from
    // wiping out an existing photo on an edit that didn't touch it.
    if (newPhotoDataUrl) payload.photo = newPhotoDataUrl;

    const result = await updateAssetDetail(asset.id, payload);
    submitBtn.disabled = false;

    if (!result.ok) {
      errorEl.textContent = result.error || 'Could not save — check your connection and try again.';
      return;
    }
    onDone(true);
  });

  return el;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeText(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
