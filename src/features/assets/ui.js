// features/assets/ui.js — "Asset Registry" screen: search, add/edit modal,
// CSV/XLSX bulk import, and a table with NFC UID + status badges.
import { apiGet, apiPost, apiPut, apiDelete } from '../../js/api-client.js';

const STATUS_LABELS = { active: 'ACTIVE', maintenance: 'MAINT.', pending: 'PENDING', offline: 'OFFLINE' };

function statusBadge(status) {
  const s = status || 'active';
  return `<span class="badge badge-asset-${s}">${STATUS_LABELS[s] || s.toUpperCase()}</span>`;
}

function openAssetModal(root, { asset } = {}) {
  const isEdit = !!asset;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box crt-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> ${isEdit ? 'EDIT ASSET' : 'ADD ASSET'}
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <form id="asset-form" class="retro-form modal-form">
        <label>ASSET ID / TAG
          <input type="text" id="f-asset-tag" class="retro-input" value="${asset ? asset.asset_tag : ''}" required />
        </label>
        <label>NAME
          <input type="text" id="f-name" class="retro-input" value="${asset ? asset.name : ''}" required />
        </label>
        <label>CATEGORY
          <input type="text" id="f-category" class="retro-input" value="${asset ? (asset.category || '') : ''}" />
        </label>
        <label>ROOM
          <input type="text" id="f-room" class="retro-input" value="${asset ? (asset.room_name || '') : ''}" placeholder="e.g. Lab 201" />
        </label>
        <label>NFC UID
          <input type="text" id="f-nfc" class="retro-input" value="${asset ? (asset.nfc_uid || '') : ''}" placeholder="optional" />
        </label>
        <label>STATUS
          <select id="f-status" class="retro-input">
            ${Object.entries(STATUS_LABELS).map(([val, label]) =>
              `<option value="${val}" ${asset && asset.status === val ? 'selected' : ''}>${label}</option>`
            ).join('')}
          </select>
        </label>
        <button type="submit" class="btn-retro">${isEdit ? '▶ SAVE CHANGES' : '▶ ADD ASSET'}</button>
        <p id="modal-error" class="form-error"></p>
      </form>
    </div>
  `;
  root.appendChild(overlay);

  overlay.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#asset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      asset_tag: overlay.querySelector('#f-asset-tag').value.trim(),
      name: overlay.querySelector('#f-name').value.trim(),
      category: overlay.querySelector('#f-category').value.trim() || null,
      nfc_uid: overlay.querySelector('#f-nfc').value.trim() || null,
      status: overlay.querySelector('#f-status').value
    };
    // Room is looked up/created by name via the room text field — the
    // backend accepts room_id, so we resolve or create it first.
    const roomName = overlay.querySelector('#f-room').value.trim();
    if (roomName) payload.room_name = roomName;

    const result = isEdit
      ? await apiPut(`/api/v1/assets/${asset.id}`, payload)
      : await apiPost('/api/v1/assets', payload);

    if (!result.ok) {
      overlay.querySelector('#modal-error').textContent = result.error || 'Save failed.';
      return;
    }
    overlay.remove();
    document.dispatchEvent(new CustomEvent('assettrack:assets-changed'));
  });
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-assets';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="registry-toolbar">
        <input type="text" id="asset-search" class="retro-input search-input" placeholder="› search assets..." />
        <div class="toolbar-actions">
          <button id="btn-add-asset" class="btn-retro">+ ADD ASSET</button>
          <label class="btn-retro outline file-btn">
            IMPORT CSV
            <input type="file" id="import-file" accept=".xlsx,.csv" hidden />
          </label>
        </div>
      </div>
      <table class="retro-table">
        <thead>
          <tr><th>ASSET ID</th><th>NAME</th><th>NFC UID</th><th>ROOM</th><th>STATUS</th><th>ACTIONS</th></tr>
        </thead>
        <tbody id="asset-rows"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
      <p id="asset-record-count" class="record-count"></p>
    </div>
  `;

  async function loadAssets(search = '') {
    const result = await apiGet(`/api/v1/assets?search=${encodeURIComponent(search)}`);
    const tbody = el.querySelector('#asset-rows');
    const countEl = el.querySelector('#asset-record-count');
    if (!result.ok || result.assets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">No assets found.</td></tr>`;
      countEl.textContent = '';
      return;
    }
    countEl.textContent = `RECORDS: ${result.assets.length}/${result.assets.length} // QUERY: ${search || 'NONE'}`;
    tbody.innerHTML = result.assets.map((a) => `
      <tr>
        <td class="mono-strong">${a.asset_tag}</td>
        <td>${a.name}</td>
        <td class="mono-dim">${a.nfc_uid || '—'}</td>
        <td>${a.room_name || '—'}</td>
        <td>${statusBadge(a.status)}</td>
        <td class="row-actions">
          <button class="btn-retro small outline btn-edit" data-id="${a.id}">EDIT</button>
          <button class="btn-retro small danger btn-del" data-id="${a.id}">DEL</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const asset = result.assets.find((a) => String(a.id) === btn.dataset.id);
        openAssetModal(el, { asset });
      });
    });
    tbody.querySelectorAll('.btn-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this asset? This cannot be undone.')) return;
        await apiDelete(`/api/v1/assets/${btn.dataset.id}`);
        loadAssets(el.querySelector('#asset-search').value);
      });
    });
  }

  el.querySelector('#asset-search').addEventListener('input', (e) => loadAssets(e.target.value));
  el.querySelector('#btn-add-asset').addEventListener('click', () => openAssetModal(el));

  el.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const res = await fetch('/api/v1/assets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer
    });
    const result = await res.json();
    alert(result.ok ? `Imported ${result.imported} of ${result.total_rows} rows.` : result.error);
    loadAssets();
  });

  document.addEventListener('assettrack:assets-changed', () => loadAssets(el.querySelector('#asset-search').value));

  loadAssets();
  return el;
}
