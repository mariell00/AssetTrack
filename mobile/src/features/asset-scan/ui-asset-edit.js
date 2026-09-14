// mobile/features/asset-scan/ui-asset-edit.js — "Asset Info" panel shown
// right after a QR scan, letting staff correct/update the asset's details
// on the spot (condition, status, category, room, etc.) instead of only
// marking it verified. Mirrors the field set of the Admin Hub's Asset
// Registry edit modal (src/features/assets/ui.js) so nothing typed here
// looks out of place when viewed later on the desktop.
import { updateAssetDetail } from './services.js';

const STATUS_OPTIONS = [
  ['active', 'ACTIVE'],
  ['pending', 'PENDING'],
  ['maintenance', 'MAINT.'],
  ['offline', 'OFFLINE']
];

// asset === null means the scan didn't resolve to a known asset (either
// nothing registered under that tag, or the phone has no connection right
// now to check) — reason distinguishes the two so the message makes sense.
export function renderAssetEditPanel(asset, code, reason, { onDone }) {
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

  el.innerHTML = `
    <div class="m-header">✔ ${asset.asset_tag}</div>
    <form id="m-edit-form">
      <label>NAME</label>
      <input id="m-e-name" required value="${escapeAttr(asset.name || '')}" />
      <label>CATEGORY</label>
      <input id="m-e-category" placeholder="optional" value="${escapeAttr(asset.category || '')}" />
      <label>ROOM</label>
      <input id="m-e-room" placeholder="e.g. Lab 201" value="${escapeAttr(asset.room_name || '')}" />
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
      <button class="m-btn" type="submit">▶ SAVE CHANGES</button>
      <button class="m-btn m-btn-secondary" id="m-edit-skip" type="button">SKIP — NO CHANGES</button>
      <p id="m-edit-error" class="m-error"></p>
    </form>
  `;

  el.querySelector('#m-edit-skip').addEventListener('click', () => onDone());

  el.querySelector('#m-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = el.querySelector('button[type="submit"]');
    const errorEl = el.querySelector('#m-edit-error');
    submitBtn.disabled = true;
    errorEl.textContent = '';

    const payload = {
      name: el.querySelector('#m-e-name').value.trim(),
      category: el.querySelector('#m-e-category').value.trim() || null,
      condition: el.querySelector('#m-e-condition').value.trim() || null,
      status: el.querySelector('#m-e-status').value,
      description: el.querySelector('#m-e-description').value.trim() || null
    };
    const roomName = el.querySelector('#m-e-room').value.trim();
    if (roomName) payload.room_name = roomName;

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
