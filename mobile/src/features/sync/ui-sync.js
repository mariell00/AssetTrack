// mobile/features/sync/ui-sync.js — Sync screen: pending count, the big
// SYNC button, and the desktop host address.
import { syncNow, pendingCount } from './services.js';
import { getBaseUrl, setBaseUrl } from '../../core/api-client.js';
import { esc } from '../../core/lookups.js';

export function renderSync() {
  const el = document.createElement('div');
  el.className = 'm-screen m-sync';
  el.innerHTML = `
    <div class="m-panel">
      <div class="m-header">WI-FI SYNC</div>
      <p id="m-sync-pending" class="m-sync-pending">Checking…</p>
      <label>DESKTOP HOST</label>
      <input id="m-sync-url" value="${esc(getBaseUrl())}" placeholder="http://192.168.1.42:3000" />
      <button id="m-sync-btn" class="m-btn m-btn-big" type="button">⇅ SYNC NOW</button>
      <p id="m-sync-status" class="m-status" aria-live="polite"></p>
    </div>
  `;

  const pendingEl = el.querySelector('#m-sync-pending');
  const btn = el.querySelector('#m-sync-btn');
  const status = el.querySelector('#m-sync-status');

  async function refreshPending() {
    const n = await pendingCount();
    pendingEl.innerHTML = n === 0
      ? 'Nothing waiting — all scans are synced.'
      : `<strong>${n}</strong> scan${n === 1 ? '' : 's'} waiting to sync.`;
    return n;
  }

  el.querySelector('#m-sync-url').addEventListener('change', (e) => setBaseUrl(e.target.value.trim()));

  btn.addEventListener('click', async () => {
    status.className = 'm-status';
    status.textContent = 'Syncing…';
    btn.disabled = true;
    const result = await syncNow();
    btn.disabled = false;

    if (!result.ok) {
      status.className = 'm-error';
      status.textContent = result.offline ? 'No connection — your scans are safe on this phone. Try again on Wi-Fi.' : (result.error || 'Sync failed.');
    } else if (result.message) {
      status.textContent = result.message;
    } else {
      const skipped = result.skipped_count || 0;
      let text = `Synced. ${result.recorded || 0} scan(s) recorded.`;
      if (skipped) {
        const tags = [...new Set((result.skipped || []).map((s) => s.asset_tag))].slice(0, 5).join(', ');
        text += ` ${skipped} skipped — not registered on the desktop yet${tags ? ` (${tags})` : ''}. Register them from ASSET REGISTRY, then scan again.`;
        status.className = 'm-error';
      }
      status.textContent = text;
    }
    refreshPending();
  });

  refreshPending();
  return el;
}
