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
      <div class="m-header">Wi-Fi sync</div>
      <p id="m-sync-pending" class="m-sync-pending">Checking…</p>
      <label>Desktop host</label>
      <input id="m-sync-url" value="${esc(getBaseUrl())}" placeholder="http://192.168.1.42:3000" />
      <button id="m-sync-btn" class="m-btn m-btn-big" type="button">⇅ Sync now</button>
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
      : `<strong>${n}</strong> item${n === 1 ? '' : 's'} waiting to sync.`;
    return n;
  }

  el.querySelector('#m-sync-url').addEventListener('change', (e) => setBaseUrl(e.target.value.trim()));

  btn.addEventListener('click', async () => {
    status.className = 'm-status';
    status.textContent = 'Syncing…';
    btn.disabled = true;
    const result = await syncNow();
    btn.disabled = false;

    // Registrations saved by an older version of the app are cleared, not sent (see services.js).
    const dropped = result.discarded_registrations || 0;
    const droppedText = dropped
      ? ` ${dropped} saved registration${dropped === 1 ? ' was' : 's were'} cleared — new assets are registered on the desktop now.`
      : '';

    if (!result.ok) {
      status.className = 'm-error';
      status.textContent = (result.offline ? 'No connection — your scans are safe on this phone. Try again on Wi-Fi.' : (result.error || 'Sync failed.')) + droppedText;
    } else if (result.message) {
      status.textContent = result.message + droppedText;
    } else {
      const skipped = result.skipped_count || 0;
      // Nothing from a sync takes effect yet: the desktop's super admin verifies it
      // on the Sync screen first. Say what was sent, so staff aren't left wondering.
      const parts = [];
      if (result.scans) parts.push(`${result.scans} scan${result.scans === 1 ? '' : 's'}`);
      if (result.edits) parts.push(`${result.edits} edit${result.edits === 1 ? '' : 's'}`);
      const sentText = parts.length ? parts.join(', ') : `${result.recorded || 0} item(s)`;
      let text = result.needs_review === false
        ? `Synced. ${sentText} recorded.`
        : `Sent ${sentText} to the desktop. They take effect once the super admin verifies them on the Sync screen.`;
      if (skipped) {
        const tags = [...new Set((result.skipped || []).map((s) => s.asset_tag).filter(Boolean))].slice(0, 5).join(', ');
        text += ` ${skipped} skipped — ${tags ? `not registered on the desktop yet (${tags}). Ask the supply office to register ${skipped === 1 ? 'it' : 'them'} on the desktop, then scan again.` : 'missing details.'}`;
        status.className = 'm-error';
      }
      status.textContent = text + droppedText;
    }
    refreshPending();
  });

  refreshPending();
  return el;
}
