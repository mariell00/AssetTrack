// mobile/features/register/ui-register.js — "Register Asset" screen: a
// short form for a brand-new item that just arrived, submitted straight
// to the Desktop host. On success, shows the freshly generated QR code so
// staff can screenshot it or print it later from the Admin Hub.
import { registerAsset } from './services.js';

const STATUS_OPTIONS = [
  ['active', 'ACTIVE'],
  ['pending', 'PENDING'],
  ['maintenance', 'MAINT.'],
  ['offline', 'OFFLINE']
];

function renderForm(el) {
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
        <input id="m-r-room" placeholder="e.g. Lab 201" />
        <label>STATUS</label>
        <select id="m-r-status">
          ${STATUS_OPTIONS.map(([val, label]) => `<option value="${val}">${label}</option>`).join('')}
        </select>
        <button class="m-btn" type="submit">▶ REGISTER</button>
        <p id="m-register-error" class="m-error"></p>
      </form>
    </div>
  `;

  el.querySelector('#m-register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = el.querySelector('button[type="submit"]');
    const errorEl = el.querySelector('#m-register-error');
    const assetTag = el.querySelector('#m-r-tag').value.trim();
    const name = el.querySelector('#m-r-name').value.trim();
    const category = el.querySelector('#m-r-category').value.trim();
    const room = el.querySelector('#m-r-room').value.trim();
    const status = el.querySelector('#m-r-status').value;

    submitBtn.disabled = true;
    errorEl.textContent = '';

    const result = await registerAsset({ assetTag, name, category, room, status });
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
  el.querySelector('#m-register-another').addEventListener('click', () => renderForm(el));
}

export function renderRegister() {
  const el = document.createElement('div');
  el.className = 'm-screen m-register';
  renderForm(el);
  return el;
}
