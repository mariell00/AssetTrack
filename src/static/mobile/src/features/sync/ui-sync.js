// mobile/features/sync/ui-sync.js — Sync screen: pending count, the big
// SYNC button, and the desktop host address.
import { syncNow, pendingCount, getRegistrations, refreshRegistrations } from './services.js';
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
    <div class="m-panel" id="m-myreg" hidden>
      <div class="m-header">MY REGISTRATIONS</div>
      <p class="m-hint">New assets you registered on this phone. The Asset ID is made by the desktop when the super admin verifies it.</p>
      <div id="m-myreg-list"></div>
    </div>
  `;

  const pendingEl = el.querySelector('#m-sync-pending');
  const btn = el.querySelector('#m-sync-btn');
  const status = el.querySelector('#m-sync-status');
  const regPanel = el.querySelector('#m-myreg');
  const regList = el.querySelector('#m-myreg-list');

  const REG_STATES = {
    queued:   { pill: 'QUEUED',   cls: 'm-pill-pending', note: 'Saved on this phone — not sent yet.' },
    pending:  { pill: 'SENT',     cls: 'm-pill-pending', note: 'Waiting for the super admin to verify it.' },
    approved: { pill: 'VERIFIED', cls: 'm-pill-active',  note: '' },
    rejected: { pill: 'REJECTED', cls: 'm-pill-offline', note: 'The super admin did not add this asset.' },
    failed:   { pill: 'NOT USED', cls: 'm-pill-offline', note: 'The desktop could not use this registration.' }
  };

  async function drawRegistrations() {
    const records = await getRegistrations();
    regPanel.hidden = records.length === 0;
    regList.innerHTML = records.map((r) => {
      const st = REG_STATES[r.state] || REG_STATES.pending;
      const detail = r.state === 'approved' && r.asset_tag ? `Asset ID <strong>${esc(r.asset_tag)}</strong>` : esc(st.note);
      return `<div class="m-myreg-row">
        <span class="m-myreg-main">${esc(r.name)}</span>
        <span class="m-pill ${st.cls}">${st.pill}</span>
        <span class="m-myreg-sub">${detail}</span>
      </div>`;
    }).join('');
  }

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

    if (!result.ok) {
      status.className = 'm-error';
      status.textContent = result.offline ? 'No connection — your scans are safe on this phone. Try again on Wi-Fi.' : (result.error || 'Sync failed.');
    } else if (result.message) {
      status.textContent = result.message;
    } else {
      const skipped = result.skipped_count || 0;
      // Nothing from a sync takes effect yet: the desktop's super admin verifies it
      // in Inventory sync first. Say what was sent, so staff aren't left wondering.
      const parts = [];
      if (result.registrations) parts.push(`${result.registrations} new asset registration${result.registrations === 1 ? '' : 's'}`);
      if (result.scans) parts.push(`${result.scans} scan${result.scans === 1 ? '' : 's'}`);
      if (result.edits) parts.push(`${result.edits} edit${result.edits === 1 ? '' : 's'}`);
      const sentText = parts.length ? parts.join(', ') : `${result.recorded || 0} item(s)`;
      // A registration that had already reached the desktop (an earlier reply was lost) is
      // recognised by its hidden id and is NOT added a second time.
      const again = result.already_received || 0;
      const againText = `${again} registration${again === 1 ? '' : 's'} had already reached the desktop and ${again === 1 ? 'was' : 'were'} not added twice.`;
      let text;
      if (!parts.length && again) {
        text = `Nothing new to send. ${againText[0].toUpperCase()}${againText.slice(1)}`;
      } else {
        text = result.needs_review === false
          ? `Synced. ${sentText} recorded.`
          : `Sent ${sentText} to the desktop. They take effect once the super admin verifies them in Inventory sync.`;
        if (again) text += ` ${againText[0].toUpperCase()}${againText.slice(1)}`;
      }
      if (skipped) {
        const tags = [...new Set((result.skipped || []).map((s) => s.asset_tag).filter(Boolean))].slice(0, 5).join(', ');
        text += ` ${skipped} skipped — ${tags ? `not registered on the desktop yet (${tags}). Register them from ASSET REGISTRY, then scan again.` : 'missing details.'}`;
        status.className = 'm-error';
      }
      status.textContent = text;
    }
    refreshPending();
    drawRegistrations();
  });

  refreshPending();
  drawRegistrations();
  // Best-effort: ask the desktop what became of anything already sent, then redraw.
  refreshRegistrations().then((r) => { if (r.changed) drawRegistrations(); });
  return el;
}
