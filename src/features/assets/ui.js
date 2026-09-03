// features/assets/ui.js — asset grid, "Add Asset" modal, import button.
import { apiGet, apiPost } from '../../js/api-client.js';

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-assets scanline';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> ASSET REGISTRY
        <div class="header-actions">
          <button id="btn-add-asset" class="btn-retro small">+ ADD ASSET</button>
          <label class="btn-retro small file-btn">
            IMPORT XLSX
            <input type="file" id="import-file" accept=".xlsx" hidden />
          </label>
        </div>
      </div>
      <input type="text" id="asset-search" class="retro-input" placeholder="SEARCH ASSET TAG OR NAME..." />
      <table class="retro-table">
        <thead>
          <tr><th>TAG</th><th>NAME</th><th>CATEGORY</th><th>ROOM</th><th>CONDITION</th></tr>
        </thead>
        <tbody id="asset-rows"><tr><td colspan="5">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  async function loadAssets(search = '') {
    const result = await apiGet(`/api/v1/assets?search=${encodeURIComponent(search)}`);
    const tbody = el.querySelector('#asset-rows');
    if (!result.ok || result.assets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">No assets found.</td></tr>`;
      return;
    }
    tbody.innerHTML = result.assets.map((a) => `
      <tr>
        <td>${a.asset_tag}</td>
        <td>${a.name}</td>
        <td>${a.category || '—'}</td>
        <td>${a.room_name || '—'}</td>
        <td class="condition-${a.condition}">${a.condition}</td>
      </tr>
    `).join('');
  }

  el.querySelector('#asset-search').addEventListener('input', (e) => loadAssets(e.target.value));

  el.querySelector('#btn-add-asset').addEventListener('click', async () => {
    const asset_tag = prompt('Asset tag (unique):');
    if (!asset_tag) return;
    const name = prompt('Asset name:');
    if (!name) return;
    await apiPost('/api/v1/assets', { asset_tag, name });
    loadAssets();
  });

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

  loadAssets();
  return el;
}
