// mobile/features/asset-scan/ui-asset-edit.js — "Asset Info" panel. Shown
// right after a QR scan, and when you open an asset from the Asset Registry
// list. Lets an admin correct/update the asset's details on the spot
// (condition, status, category, room, etc.). Nothing is changed on the desktop
// from here: edits are saved on the phone, go out with the next SYNC, and are
// applied once the super admin verifies them in Inventory sync.
// Uses the same pick-lists as the
// desktop Asset Registry form (core/lookups.js) so nothing typed here looks
// out of place when viewed later on the desktop.
import { queueAssetChanges } from './services.js';
import { compressImageFile } from '../../core/photo.js';
import {
  fetchRoomsList, fetchAssignees, roomOptionsHtml, categoryOptionsHtml, assigneeOptionsHtml,
  pairOptionsHtml, STATUS_OPTIONS, CONDITION_OPTIONS, esc
} from '../../core/lookups.js';

// asset === null means the scan didn't resolve to a known asset (either
// nothing registered under that tag, or the phone has no connection right
// now to check) — reason distinguishes the two so the message makes sense.
//   onDone(saved)  — called when the panel is finished (saved or skipped)
//   skipLabel      — label for the no-changes button
//   scanLocalId    — the queued scan these edits belong to (so they sync together)
export async function renderAssetEditPanel(asset, code, reason, { onDone, scanLocalId = null, skipLabel = 'Skip — no changes' }) {
  const el = document.createElement('div');
  el.className = 'm-panel m-asset-edit';

  if (!asset) {
    const offline = reason === 'offline';
    const message = offline
      ? 'Scan saved locally. Editing details needs a connection to the desktop host — try again once you\'re back on Wi-Fi, or SYNC later.'
      : `No asset is registered under "${esc(code)}". AssetTrack makes each Asset ID (and its QR label) when a registration is verified on the desktop, so check this is an AssetTrack label — or register the item from ASSET REGISTRY.`;
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

  el.innerHTML = `
    <div class="m-header">✔ ${esc(asset.asset_tag)}</div>
    <form id="m-edit-form">
      <p class="m-hint">Changes are saved on this phone and sent when you sync. They apply once the super admin verifies them.</p>
      <label>Asset name</label>
      <input id="m-e-name" required value="${esc(asset.name)}" />
      <label>Category</label>
      <select id="m-e-category">${categoryOptionsHtml(asset.category || '')}</select>
      <label>Room</label>
      <select id="m-e-room">${roomOptionsHtml(rooms, asset.room_id)}</select>
      <label>Assigned to <span class="m-label-optional">(asset user)</span></label>
      <select id="m-e-assigned">${assigneeOptionsHtml(people, asset.assigned_to || '')}</select>
      <label>Condition</label>
      <select id="m-e-condition">${pairOptionsHtml(CONDITION_OPTIONS, asset.condition || 'good')}</select>
      <label>Status</label>
      <select id="m-e-status">${pairOptionsHtml(STATUS_OPTIONS, asset.status || 'active')}</select>
      <label>Description</label>
      <textarea id="m-e-description" rows="2" placeholder="optional">${esc(asset.description)}</textarea>
      <label>Photo <span class="m-label-optional">(optional — leave as-is to keep the current one)</span></label>
      <div class="m-photo-row">
        <img id="m-e-photo-preview" class="m-photo-preview" src="${esc(asset.photo)}" style="${asset.photo ? '' : 'display:none;'}" alt="" />
        <label class="m-btn m-btn-secondary m-photo-pick">
          <span id="m-e-photo-label">▶ ${asset.photo ? 'Retake / change photo' : 'Take / choose photo'}</span>
          <input type="file" id="m-e-photo" accept="image/*" capture="environment" hidden />
        </label>
      </div>
      <button class="m-btn" type="submit">Save for sync</button>
      <button class="m-btn m-btn-secondary" id="m-edit-skip" type="button">${esc(skipLabel)}</button>
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
    photoLabel.textContent = 'Compressing…';
    try {
      newPhotoDataUrl = await compressImageFile(file);
      photoPreview.src = newPhotoDataUrl;
      photoPreview.style.display = 'block';
      photoLabel.textContent = 'Retake / change photo';
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

    const roomValue = el.querySelector('#m-e-room').value;
    const payload = {
      name: el.querySelector('#m-e-name').value.trim(),
      category: el.querySelector('#m-e-category').value || null,
      assigned_to: el.querySelector('#m-e-assigned').value || null,
      condition: el.querySelector('#m-e-condition').value || null,
      status: el.querySelector('#m-e-status').value,
      description: el.querySelector('#m-e-description').value.trim() || null,
      // A room_id from the managed list, not a free-typed name; "" (Unassigned) becomes null.
      room_id: roomValue ? Number(roomValue) : null
    };
    // Only send `photo` if a new one was actually picked — omitting the
    // key (rather than sending null) is what keeps updateAsset() from
    // wiping out an existing photo on an edit that didn't touch it.
    if (newPhotoDataUrl) payload.photo = newPhotoDataUrl;

    if (!payload.name) {
      errorEl.textContent = 'The asset needs a name.';
      submitBtn.disabled = false;
      return;
    }

    // Send only what actually differs from what's registered, so the desktop
    // shows the super admin exactly what would change.
    const changes = {};
    for (const [key, value] of Object.entries(payload)) {
      const before = asset[key] === undefined ? null : asset[key];
      if ((before ?? null) !== (value ?? null)) changes[key] = value;
    }
    if (Object.keys(changes).length === 0) {
      submitBtn.disabled = false;
      onDone(false); // nothing was changed
      return;
    }

    try {
      await queueAssetChanges(asset.asset_tag, changes, { scanLocalId });
    } catch {
      submitBtn.disabled = false;
      errorEl.textContent = 'Could not save on this phone. Try again.';
      return;
    }
    submitBtn.disabled = false;
    onDone(true);
  });

  return el;
}
