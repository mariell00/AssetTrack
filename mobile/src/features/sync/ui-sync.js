// mobile/features/sync/ui-sync.js — big "SYNC" button + IP address config field.
import { syncNow } from './services.js';
import { getBaseUrl, setBaseUrl } from '../../core/api-client.js';

export function renderSync() {
  const el = document.createElement('div');
  el.className = 'm-screen m-sync';
  el.innerHTML = `
    <div class="m-panel">
      <div class="m-header">WI-FI SYNC</div>
      <label>DESKTOP HOST</label>
      <input id="m-sync-url" value="${getBaseUrl()}" placeholder="http://192.168.1.42:3000" />
      <button id="m-sync-btn" class="m-btn m-btn-big">⇅ SYNC NOW</button>
      <p id="m-sync-status" class="m-status"></p>
    </div>
  `;

  el.querySelector('#m-sync-url').addEventListener('change', (e) => setBaseUrl(e.target.value));

  el.querySelector('#m-sync-btn').addEventListener('click', async () => {
    const status = el.querySelector('#m-sync-status');
    status.textContent = 'Syncing…';
    const result = await syncNow();
    status.textContent = result.ok
      ? `Synced. ${result.recorded || 0} scan(s) recorded.`
      : (result.offline ? 'No connection — will retry later.' : result.error);
  });

  return el;
}
