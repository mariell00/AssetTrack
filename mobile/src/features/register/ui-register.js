// mobile/features/register/ui-register.js — "Register Asset" screen: a
// short form for a brand-new item that just arrived, submitted straight
// to the Desktop host. On success, shows the freshly generated QR code so
// staff can screenshot it or print it later from the Admin Hub.
import { registerAsset, fetchRoomsList } from './services.js';
import { compressImageFile } from '../../core/photo.js';

const STATUS_OPTIONS = [
  ['active', 'ACTIVE'],
  ['pending', 'PENDING'],
  ['maintenance', 'MAINT.'],
  ['offline', 'OFFLINE']
];

// Grouped by building, same as the desktop Asset Registry modal and the
// mobile Asset Info edit panel — picking a room from this list (rather
// than typing one) is what links the asset to a building the Cluster Map
// already knows about, so it shows up there right away.
function roomOptionsHtml(rooms) {
  const grouped = new Map();
  for (const r of rooms) {
    const key = r.building_name || null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }
  const optionHtml = (r) => `<option value="${r.id}">${r.name}</option>`;

  let html = `<option value="">— Unassigned —</option>`;
  for (const [buildingName, roomsInBuilding] of grouped) {
    html += buildingName
      ? `<optgroup label="${buildingName}">${roomsInBuilding.map(optionHtml).join('')}</optgroup>`
      : roomsInBuilding.map(optionHtml).join('');
  }
  return html;
}

function renderForm(el, rooms) {
  el.innerHTML = `
    <div class="m-panel">
      <div class="m-header">REGISTER ASSET</div>
      <form id="m-register-form">
        <label>ASSET ID / TAG</label>
        <input id="m-r-tag" required />
        <label>NAME</label>
        <input id="m-r-name" required />
        <label>CATEGORY</label>
        <input id="m-r-category" placeholder="optional" />
        <label>ROOM</label>
        <select id="m-r-room">${roomOptionsHtml(rooms)}</select>
        <label>ASSIGN TO <span class="m-label-optional">(person or name, optional)</span></label>
        <input id="m-r-assigned" placeholder="e.g. Juan Dela Cruz" />
        <label>STATUS</label>
        <select id="m-r-status">
          ${STATUS_OPTIONS.map(([val, label]) => `<option value="${val}" ${val === 'active' ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <label>PHOTO <span class="m-label-optional">(optional)</span></label>
        <div class="m-photo-row">
          <img id="m-r-photo-preview" class="m-photo-preview" style="display:none;" alt="" />
          <label class="m-btn m-btn-secondary m-photo-pick">
            <span id="m-r-photo-label">▶ TAKE / CHOOSE PHOTO</span>
            <input type="file" id="m-r-photo" accept="image/*" capture="environment" hidden />
          </label>
        </div>
        <button class="m-btn" type="submit">▶ REGISTER</button>
        <p id="m-register-error" class="m-error"></p>
      </form>
    </div>
  `;

  let photoDataUrl = null;
  const photoInput = el.querySelector('#m-r-photo');
  const photoPreview = el.querySelector('#m-r-photo-preview');
  const photoLabel = el.querySelector('#m-r-photo-label');

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    photoLabel.textContent = 'COMPRESSING…';
    try {
      photoDataUrl = await compressImageFile(file);
      photoPreview.src = photoDataUrl;
      photoPreview.style.display = 'block';
      photoLabel.textContent = '▶ RETAKE / CHANGE PHOTO';
    } catch {
      photoDataUrl = null;
      photoLabel.textContent = '▶ TAKE / CHOOSE PHOTO — failed, try again';
    }
  });

  el.querySelector('#m-register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = el.querySelector('button[type="submit"]');
    const errorEl = el.querySelector('#m-register-error');
    const assetTag = el.querySelector('#m-r-tag').value.trim();
    const name = el.querySelector('#m-r-name').value.trim();
    const category = el.querySelector('#m-r-category').value.trim();
    const roomId = el.querySelector('#m-r-room').value;
    const assignedTo = el.querySelector('#m-r-assigned').value.trim();
    const status = el.querySelector('#m-r-status').value;

    submitBtn.disabled = true;
    errorEl.textContent = '';

    const result = await registerAsset({ assetTag, name, category, roomId, assignedTo, status, photo: photoDataUrl });
    submitBtn.disabled = false;

    if (!result.ok) {
      errorEl.textContent = result.error || 'Registration requires a connection to the desktop host.';
      return;
    }
    renderResult(el, result);
  });
}

function renderResult(el, { asset, qr }) {
  el.innerHTML = `
    <div class="m-panel m-scanner-panel">
      <div class="m-header">ASSET REGISTERED</div>
      ${qr ? `<img src="${qr.dataUrl}" alt="QR code for ${asset.asset_tag}" class="m-qr-video" />` : ''}
      <p class="m-status">${asset.asset_tag} — ${asset.name}</p>
      ${qr ? '' : '<p class="m-error">Saved, but the QR label couldn\'t be generated — reprint it from the Admin Hub\'s Asset Registry.</p>'}
      <button class="m-btn" id="m-register-another">▶ REGISTER ANOTHER</button>
    </div>
  `;
  el.querySelector('#m-register-another').addEventListener('click', () => renderAndLoad(el));
}

async function renderAndLoad(el) {
  el.innerHTML = `<div class="m-panel"><div class="m-header">REGISTER ASSET</div><p class="m-status">Loading rooms…</p></div>`;
  const roomsResult = await fetchRoomsList();
  // If the desktop host isn't reachable, fall back to just "— Unassigned —"
  // rather than blocking registration entirely — the ROOM select still
  // works, it just won't have a building-grouped list to offer.
  const rooms = roomsResult.ok ? roomsResult.rooms : [];
  renderForm(el, rooms);
}

export function renderRegister() {
  const el = document.createElement('div');
  el.className = 'm-screen m-register';
  renderAndLoad(el);
  return el;
}
