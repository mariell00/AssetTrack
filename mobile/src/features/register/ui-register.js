// mobile/features/register/ui-register.js — "Register asset" form: a short
// form for a brand-new item that just arrived. It is saved on the phone and
// sent at the next SYNC; the asset only exists (and gets its Asset ID and QR
// label) once the super admin verifies the registration on the desktop.
// There is no Asset ID field: staff only enter the details. The desktop makes
// the Asset ID when it verifies, and the phone tags the registration with its
// own hidden id so a re-send can never create a second copy (register/services.js).
import { registerAsset, fetchRoomsList, fetchAssignees } from './services.js';
import { compressImageFile } from '../../core/photo.js';
import {
  roomOptionsHtml, categoryOptionsHtml, assigneeOptionsHtml, pairOptionsHtml, STATUS_OPTIONS, esc
} from '../../core/lookups.js';

function renderForm(el, { rooms, people, onBack }) {
  el.innerHTML = `
    <div class="m-panel">
      ${onBack ? '<button class="m-btn m-btn-secondary m-back" id="m-register-back" type="button">‹ BACK TO REGISTRY</button>' : ''}
      <div class="m-header">REGISTER ASSET</div>
      <form id="m-register-form">
        <p class="m-hint">The registration is saved on this phone and sent when you SYNC. The asset is added once the super admin verifies it.</p>
        <label>ASSET NAME</label>
        <input id="m-r-name" required />
        <label>CATEGORY</label>
        <select id="m-r-category">${categoryOptionsHtml('')}</select>
        <label>ROOM</label>
        <select id="m-r-room">${roomOptionsHtml(rooms, '')}</select>
        <label>ASSIGNED TO <span class="m-label-optional">(asset user, optional)</span></label>
        <select id="m-r-assigned">${assigneeOptionsHtml(people, '')}</select>
        <label>STATUS</label>
        <select id="m-r-status">${pairOptionsHtml(STATUS_OPTIONS, 'active')}</select>
        <label>PHOTO <span class="m-label-optional">(optional)</span></label>
        <div class="m-photo-row">
          <img id="m-r-photo-preview" class="m-photo-preview" style="display:none;" alt="" />
          <label class="m-btn m-btn-secondary m-photo-pick">
            <span id="m-r-photo-label">▶ TAKE / CHOOSE PHOTO</span>
            <input type="file" id="m-r-photo" accept="image/*" capture="environment" hidden />
          </label>
        </div>
        <button class="m-btn" type="submit">▶ SAVE REGISTRATION</button>
        <p id="m-register-error" class="m-error"></p>
      </form>
    </div>
  `;

  el.querySelector('#m-register-back')?.addEventListener('click', () => onBack());

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
    submitBtn.disabled = true;
    errorEl.textContent = '';

    const result = await registerAsset({
      name: el.querySelector('#m-r-name').value.trim(),
      category: el.querySelector('#m-r-category').value,
      roomId: el.querySelector('#m-r-room').value,
      assignedTo: el.querySelector('#m-r-assigned').value,
      status: el.querySelector('#m-r-status').value,
      photo: photoDataUrl
    });
    submitBtn.disabled = false;

    if (!result.ok) {
      errorEl.textContent = result.error || 'Could not save this registration on the phone. Try again.';
      return;
    }
    renderResult(el, result, { onBack });
  });
}

function renderResult(el, { name }, ctx) {
  el.innerHTML = `
    <div class="m-panel m-scanner-panel">
      <div class="m-header">REGISTRATION SAVED</div>
      <p class="m-status"><strong>${esc(name)}</strong> is saved on this phone.</p>
      <p class="m-hint">Go to SYNC to send it. The super admin then verifies it on the desktop. Only after that is the asset added and given its Asset ID. Print the QR label from the desktop's Asset Registry.</p>
      <button class="m-btn" id="m-register-another" type="button">▶ REGISTER ANOTHER</button>
      ${ctx.onBack ? '<button class="m-btn m-btn-secondary" id="m-register-done" type="button">BACK TO REGISTRY</button>' : ''}
    </div>
  `;
  el.querySelector('#m-register-another').addEventListener('click', () => load(el, ctx));
  el.querySelector('#m-register-done')?.addEventListener('click', () => ctx.onBack());
}

async function load(el, ctx) {
  el.innerHTML = `<div class="m-panel"><div class="m-header">REGISTER ASSET</div><p class="m-status">Loading…</p></div>`;
  const [roomsResult, peopleResult] = await Promise.all([fetchRoomsList(), fetchAssignees()]);
  // If the lists can't be fetched, the selects fall back to "— Unassigned —"
  // rather than blocking registration entirely.
  renderForm(el, {
    rooms: roomsResult.ok ? roomsResult.rooms : [],
    people: peopleResult.ok ? peopleResult.assignees : [],
    onBack: ctx.onBack
  });
}

export function renderRegister({ onBack = null } = {}) {
  const el = document.createElement('div');
  el.className = 'm-screen m-register';
  load(el, { onBack });
  return el;
}
