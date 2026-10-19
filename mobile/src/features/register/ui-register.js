// mobile/features/register/ui-register.js — "Register asset" form: a short
// form for a brand-new item that just arrived, submitted straight to the
// Desktop host. On success, shows the freshly generated QR code so it can be
// screenshotted or printed later from the desktop's Asset Registry.
// Opened from the Asset Registry screen (or straight from the Scanner when a
// scanned tag isn't registered yet — then `prefillTag` is that tag).
import { registerAsset, fetchRoomsList, fetchAssignees } from './services.js';
import { compressImageFile } from '../../core/photo.js';
import {
  roomOptionsHtml, categoryOptionsHtml, assigneeOptionsHtml, pairOptionsHtml, STATUS_OPTIONS, esc
} from '../../core/lookups.js';

function renderForm(el, { rooms, people, prefillTag, onBack }) {
  el.innerHTML = `
    <div class="m-panel">
      ${onBack ? '<button class="m-btn m-btn-secondary m-back" id="m-register-back" type="button">‹ BACK TO REGISTRY</button>' : ''}
      <div class="m-header">REGISTER ASSET</div>
      <form id="m-register-form">
        <label>ASSET ID / TAG <span class="m-label-optional">(optional — leave blank to generate one, e.g. AST-0001)</span></label>
        <input id="m-r-tag" placeholder="auto-generated" value="${esc(prefillTag)}" autocapitalize="characters" />
        <label>NAME</label>
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
        <button class="m-btn" type="submit">▶ REGISTER</button>
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
      assetTag: el.querySelector('#m-r-tag').value.trim(),
      name: el.querySelector('#m-r-name').value.trim(),
      category: el.querySelector('#m-r-category').value,
      roomId: el.querySelector('#m-r-room').value,
      assignedTo: el.querySelector('#m-r-assigned').value,
      status: el.querySelector('#m-r-status').value,
      photo: photoDataUrl
    });
    submitBtn.disabled = false;

    if (!result.ok) {
      errorEl.textContent = result.offline
        ? 'Registering needs a connection to the desktop host.'
        : (result.error || 'Could not register this asset.');
      return;
    }
    renderResult(el, result, { onBack, prefillTag });
  });
}

function renderResult(el, { asset, qr }, ctx) {
  el.innerHTML = `
    <div class="m-panel m-scanner-panel">
      <div class="m-header">ASSET REGISTERED</div>
      ${qr ? `<img src="${esc(qr.dataUrl)}" alt="QR code for ${esc(asset.asset_tag)}" class="m-qr-video" />` : ''}
      <p class="m-status">${esc(asset.asset_tag)} — ${esc(asset.name)}</p>
      ${qr ? '' : '<p class="m-error">Saved, but the QR label couldn\'t be generated — reprint it from the desktop Asset Registry.</p>'}
      <button class="m-btn" id="m-register-another" type="button">▶ REGISTER ANOTHER</button>
      ${ctx.onBack ? '<button class="m-btn m-btn-secondary" id="m-register-done" type="button">BACK TO REGISTRY</button>' : ''}
    </div>
  `;
  el.querySelector('#m-register-another').addEventListener('click', () => load(el, { ...ctx, prefillTag: '' }));
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
    prefillTag: ctx.prefillTag || '',
    onBack: ctx.onBack
  });
}

export function renderRegister({ prefillTag = '', onBack = null } = {}) {
  const el = document.createElement('div');
  el.className = 'm-screen m-register';
  load(el, { prefillTag, onBack });
  return el;
}
