// mobile/features/registry/ui-registry.js — "Asset registry": the phone's
// counterpart of the desktop Asset Registry screen. Search the assets, tap
// one to view/edit its details (the same Asset Info panel the Scanner uses),
// or register a new one. Everything here needs a live connection to the
// desktop host (unlike scanning, there's no offline queue for edits).
import { apiGet } from '../../core/api-client.js';
import { fetchAssetDetail } from '../asset-scan/services.js';
import { renderAssetEditPanel } from '../asset-scan/ui-asset-edit.js';
import { renderRegister } from '../register/ui-register.js';
import { esc } from '../../core/lookups.js';

const PAGE_SIZE = 50;
const STATUS_LABELS = { active: 'ACTIVE', maintenance: 'MAINT.', pending: 'PENDING', offline: 'OFFLINE' };

// `registerTag` — open straight on the register form with this tag filled in
// (used by the Scanner's "REGISTER THIS TAG" button).
export function renderRegistry({ registerTag = null } = {}) {
  const el = document.createElement('div');
  el.className = 'm-screen m-registry';

  function show(node) { el.innerHTML = ''; el.appendChild(node); }

  function showRegister(prefillTag = '') {
    show(renderRegister({ prefillTag, onBack: showList }));
  }

  async function showEdit(id) {
    const loading = document.createElement('div');
    loading.className = 'm-panel';
    loading.innerHTML = '<div class="m-header">ASSET INFO</div><p class="m-status">Loading…</p>';
    show(loading);

    const result = await fetchAssetDetail(id);
    if (!result.ok) {
      loading.innerHTML = `
        <div class="m-header">ASSET INFO</div>
        <p class="m-error">${esc(result.offline ? 'Opening an asset needs a connection to the desktop host.' : (result.error || 'Could not load this asset.'))}</p>
        <button class="m-btn m-btn-secondary" type="button" id="m-back-list">‹ BACK TO REGISTRY</button>`;
      loading.querySelector('#m-back-list').addEventListener('click', showList);
      return;
    }
    const panel = await renderAssetEditPanel(result.asset, result.asset.asset_tag, null, {
      onDone: showList,
      skipLabel: 'CANCEL'
    });
    show(panel);
  }

  function showList(initialSearch = '') {
    const panel = document.createElement('div');
    panel.innerHTML = `
      <div class="m-panel">
        <div class="m-header">ASSET REGISTRY</div>
        <button class="m-btn" id="m-reg-new" type="button">＋ REGISTER NEW ASSET</button>
        <label for="m-reg-search" class="m-reg-search-label">SEARCH</label>
        <input id="m-reg-search" type="search" placeholder="Name or asset tag…" autocomplete="off" value="${esc(typeof initialSearch === 'string' ? initialSearch : '')}" />
        <p id="m-reg-count" class="m-status"></p>
        <div id="m-reg-list" class="m-asset-list"></div>
      </div>
    `;
    show(panel);

    const searchEl = panel.querySelector('#m-reg-search');
    const listEl = panel.querySelector('#m-reg-list');
    const countEl = panel.querySelector('#m-reg-count');
    let timer = null;
    let seq = 0; // ignore a slow response that arrives after a newer search

    panel.querySelector('#m-reg-new').addEventListener('click', () => showRegister());

    async function load() {
      const mine = ++seq;
      countEl.textContent = 'Loading…';
      const search = searchEl.value.trim();
      // lite=1 leaves the (large) photos out of the list — they're only needed on the detail panel.
      const result = await apiGet(`/api/v1/assets?lite=1${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      if (mine !== seq) return;

      if (!result.ok) {
        listEl.innerHTML = '';
        countEl.className = 'm-error';
        countEl.textContent = result.offline
          ? 'The Asset Registry needs a connection to the desktop host. Scanning still works offline.'
          : (result.error || 'Could not load assets.');
        return;
      }
      countEl.className = 'm-status';
      const assets = result.assets;
      if (assets.length === 0) {
        listEl.innerHTML = '';
        countEl.textContent = search ? 'No assets match that search.' : 'No assets registered yet.';
        return;
      }
      const shown = assets.slice(0, PAGE_SIZE);
      countEl.textContent = assets.length > shown.length
        ? `Showing ${shown.length} of ${assets.length} — search to narrow it down.`
        : `${assets.length} asset${assets.length === 1 ? '' : 's'}`;
      listEl.innerHTML = shown.map((a) => `
        <button class="m-asset-row" type="button" data-id="${esc(a.id)}">
          <span class="m-asset-row-main"><strong>${esc(a.asset_tag)}</strong> — ${esc(a.name)}</span>
          <span class="m-asset-row-sub">${esc(a.room_name || 'Unassigned')} · <span class="m-pill m-pill-${esc(a.status || 'active')}">${esc(STATUS_LABELS[a.status] || String(a.status || 'active').toUpperCase())}</span></span>
        </button>`).join('');
    }

    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('.m-asset-row');
      if (row) showEdit(row.dataset.id);
    });
    searchEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    load();
  }

  if (registerTag) showRegister(registerTag);
  else showList();
  return el;
}
