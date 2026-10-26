// features/inventory/ui.js — two things:
//  1) renderPanel() — a compact "room verification progress" widget, used
//     as a small tile embedded in other screens if needed.
//  2) render() — the full "Inventory Sync" screen:
//       - AWAITING VERIFICATION: what phones sent at sync, in two lists —
//         PENDING REGISTRATIONS (a new asset) and PENDING SCANS (an existing
//         asset scanned / edited). Each list shows the sync requests, the assets
//         in each request, and a pop-out to confirm one asset at a time.
//       - a grid of per-room sync cards and the Mobile Check-in Log.
import { apiGet, apiPost } from '../../js/api-client.js';

const SCAN_LABELS = { verified: 'Verified', missing: 'Missing', misplaced: 'Misplaced' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function localTime(sqlDate) {
  if (!sqlDate) return '—';
  const d = new Date(String(sqlDate).replace(' ', 'T') + 'Z'); // SQLite stores UTC
  return Number.isNaN(d.getTime()) ? esc(sqlDate)
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function tierClass(pct) {
  if (pct >= 100) return 'full';
  if (pct >= 75) return 'partial';
  return 'low';
}

function formatTime(ts) {
  if (!ts) return 'never';
  return ts.replace('T', ' ').slice(0, 19);
}

const STATUS_LABELS = { active: 'Active', maintenance: 'Maintenance', pending: 'Pending', offline: 'Offline' };
const statusBadge = (s) => `<span class="badge badge-asset-${esc(s || 'active')}">${STATUS_LABELS[s || 'active'] || esc(s).toUpperCase()}</span>`;
const scanBadge = (s) => `<span class="badge badge-scan-${esc(s)}">${SCAN_LABELS[s] || esc(s).toUpperCase()}</span>`;

function peso(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isNaN(n) ? esc(v) : `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// The confirmation pop-out for ONE item from a sync request. `onDone` runs after it
// has been verified or rejected so the lists can refresh.
async function openReviewModal(root, { type, id }, onDone) {
  const isReg = type === 'registration';
  const result = await apiGet(`/api/v1/inventory/pending/${isReg ? 'registrations' : 'scans'}/${id}`);
  if (!result.ok) { alert(result.error || 'Could not open this item.'); onDone(); return; }
  const d = isReg ? result.registration : result.scan;

  const field = (label, value) => `<div class="ad-field"><span class="ad-label">${label}</span><span class="ad-value">${value}</span></div>`;
  let heading; let top; let body; let verifyLabel;

  if (isReg) {
    const a = d.asset;
    heading = 'Verify registration';
    verifyLabel = 'Verify & add asset';
    top = `
      ${a.photo ? `<img class="ad-photo" src="${a.photo}" alt="Photo of ${esc(a.name)}" />` : '<div class="ad-photo ad-photo-empty">No photo</div>'}
      <div class="ad-id">
        <div class="ad-tag">${esc(a.name)}</div>
        <div><span class="badge badge-asset-active">New asset</span> ${statusBadge(a.status)}</div>
        <div class="ad-name">The Asset ID is generated when you verify this.</div>
      </div>`;
    body = `
      <div class="ad-grid">
        ${field('Category', esc(a.category) || '—')}
        ${field('Condition', esc(a.condition) || 'good')}
        ${field('Room', esc(a.room_name))}
        ${field('Assigned to', esc(a.assigned_to) || '—')}
        ${field('Value', peso(a.value_php))}
        ${field('Acquired', esc(a.acquired_date) || '—')}
      </div>
      ${a.description ? `<div class="ad-section"><h3>Description</h3><p class="ad-text">${esc(a.description)}</p></div>` : ''}
      <div class="ad-section"><h3>Sent from</h3><p class="ad-text">${esc(d.device)} · ${localTime(d.received_at)}</p></div>`;
  } else {
    const a = d.asset;
    heading = d.kind === 'edit' ? 'Verify edit' : 'Verify scan';
    verifyLabel = d.kind === 'edit' ? 'Apply changes' : 'Verify scan';
    top = `
      ${a.photo ? `<img class="ad-photo" src="${a.photo}" alt="Photo of ${esc(a.name)}" />` : '<div class="ad-photo ad-photo-empty">No photo</div>'}
      <div class="ad-id">
        <div class="ad-tag">${esc(a.asset_tag)}</div>
        <div class="ad-name">${esc(a.name)}</div>
        <div>${d.kind === 'edit' ? '<span class="badge badge-asset-pending">Edit only</span>' : `${scanBadge(d.scanned_as)}`}</div>
      </div>`;
    const diffRows = d.diff.map((c) => `
      <tr>
        <td class="mono-strong">${esc(c.label)}</td>
        <td>${c.is_photo ? (c.from ? `<img class="q-thumb" src="${c.from}" alt="" />` : '—') : (esc(c.from) || '—')}</td>
        <td class="q-new">${c.is_photo ? (c.to ? `<img class="q-thumb" src="${c.to}" alt="" />` : '—') : (esc(c.to) || '—')}</td>
      </tr>`).join('');
    body = `
      <div class="ad-grid">
        ${d.kind === 'scan' ? field('Scanned in', esc(d.scanned_room)) : field('Type', 'Edited from the registry list')}
        ${field('Registered in', esc(d.registered_room))}
        ${field('Sent by', esc(d.scanned_by))}
        ${field('Sent', localTime(d.received_at))}
      </div>
      ${d.room_mismatch ? `<p class="q-callout">This asset was scanned in <strong>${esc(d.scanned_room)}</strong> but is registered in <strong>${esc(d.registered_room)}</strong>. Check before verifying.</p>` : ''}
      <div class="ad-section">
        <h3>Proposed changes</h3>
        ${d.diff.length
          ? `<table class="retro-table q-diff"><thead><tr><th>Field</th><th>Current</th><th>Proposed</th></tr></thead><tbody>${diffRows}</tbody></table>`
          : `<p class="ad-empty">${d.kind === 'edit' ? 'These edits match what is already saved.' : 'No changes. This scan only confirms the asset was found.'}</p>`}
      </div>
      <div class="ad-section"><h3>Sent from</h3><p class="ad-text">${esc(d.device)}</p></div>`;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box crt-panel asset-detail-box" role="dialog" aria-modal="true" aria-label="${heading}">
      <div class="crt-header"><span class="crt-dot"></span> ${heading}<button type="button" class="modal-close" id="rv-close" aria-label="Close">✕</button></div>
      <div class="ad-scroll">
        <div class="ad-top">${top}</div>
        ${body}
      </div>
      <div class="ad-actions">
        <button type="button" class="btn-retro small danger" id="rv-reject">Reject</button>
        <button type="button" class="btn-retro small" id="rv-verify">${verifyLabel}</button>
      </div>
    </div>`;
  root.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('#rv-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#rv-verify').focus();

  async function act(action) {
    if (action === 'reject' && !confirm(isReg ? 'Reject this registration? The asset will not be added.' : 'Reject this? It will not be counted and no changes will be applied.')) return;
    overlay.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const res = await apiPost('/api/v1/inventory/pending/review', { type, action, ids: [id] });
    if (!res.ok) alert(res.error || 'Could not save that. Try again.');
    else if (res.failed && res.failed.length) alert(res.failed[0].error);
    close();
    onDone();
  }
  overlay.querySelector('#rv-verify').addEventListener('click', () => act('approve'));
  overlay.querySelector('#rv-reject').addEventListener('click', () => act('reject'));
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-inventory';
  el.innerHTML = `
    <div class="crt-panel queue-panel">
      <div class="crt-header"><span class="crt-dot"></span> Awaiting verification</div>
      <div class="queue-tabs" role="tablist">
        <button type="button" role="tab" class="queue-tab is-active" data-tab="registrations" aria-selected="true">Pending registrations <span class="queue-n" id="n-registrations"></span></button>
        <button type="button" role="tab" class="queue-tab" data-tab="scans" aria-selected="false">Pending scans <span class="queue-n" id="n-scans"></span></button>
      </div>
      <p class="queue-lede" id="queue-lede"></p>
      <div id="queue-body" class="queue-body">Loading…</div>
    </div>
    <div class="crt-panel">
      <div class="crt-header"><span class="crt-dot"></span> Inventory sync</div>
      <div id="sync-grid" class="sync-grid">Loading…</div>
    </div>
    <div class="crt-panel checkin-panel">
      <div class="panel-title">Mobile check-in log</div>
      <table class="retro-table">
        <thead><tr><th>Time</th><th>Device</th><th>Room</th><th>Count</th><th>Status</th></tr></thead>
        <tbody id="checkin-rows"><tr><td colspan="5">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  async function loadRooms() {
    const result = await apiGet('/api/v1/inventory/progress');
    const grid = el.querySelector('#sync-grid');
    if (!result.ok || result.rooms.length === 0) {
      grid.innerHTML = '<p class="empty-hint">No rooms configured yet.</p>';
      return;
    }

    grid.innerHTML = result.rooms.map((r) => {
      const tier = tierClass(r.pct);
      const segments = Array.from({ length: 10 }, (_, i) =>
        `<span class="segment ${i < Math.round((r.pct / 100) * 10) ? `filled tier-${tier}` : ''}"></span>`
      ).join('');

      return `
        <div class="sync-card">
          <div class="sync-card-title">${r.room_name}</div>
          <div class="sync-card-last">Last: ${formatTime(r.last_sync)}</div>
          <div class="segmented-bar">${segments}</div>
          <div class="sync-card-footer">
            <span class="sync-card-count tier-text-${tier}">${r.verified}/${r.expected}${r.awaiting ? ` <span class="awaiting-tag">+${r.awaiting} awaiting</span>` : ''}</span>
            <button class="btn-retro small btn-sync-room" data-room="${r.room_id}">Sync</button>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.btn-sync-room').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.textContent = '…';
        await loadRooms();
      });
    });
  }

  async function loadCheckinLog() {
    const result = await apiGet('/api/v1/inventory/sync-log?limit=20');
    const tbody = el.querySelector('#checkin-rows');
    if (!result.ok || result.log.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No sync activity yet.</td></tr>';
      return;
    }
    tbody.innerHTML = result.log.map((row) => `
      <tr>
        <td>${formatTime(row.time)}</td>
        <td>${row.device}</td>
        <td>${row.room}</td>
        <td>${row.count}</td>
        <td><span class="status-dot status-${row.status}"></span> ${row.status === 'complete' ? 'Complete' : 'Partial'}</td>
      </tr>
    `).join('');
  }

  // ---- verification queue ----
  const queueBody = el.querySelector('#queue-body');
  const lede = el.querySelector('#queue-lede');
  const LEDE = {
    registrations: 'A registration adds a new asset. Nothing is added until you verify it, and the Asset ID is generated then. Click an asset to review it, or verify a whole sync request at once.',
    scans: 'A scan updates an asset that already exists. Its proposed changes are only applied, and the scan only counts as verified, once you verify it. Click an asset to see what would change.'
  };
  let queue = null;
  let activeTab = null;
  let shownCount = null;

  function setTab(tab) {
    activeTab = tab;
    el.querySelectorAll('.queue-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    lede.textContent = LEDE[tab];
    drawQueue();
  }

  function drawQueue() {
    if (!queue) return;
    const list = queue[activeTab];
    el.querySelector('#n-registrations').textContent = queue.registrations.count ? `(${queue.registrations.count})` : '';
    el.querySelector('#n-scans').textContent = queue.scans.count ? `(${queue.scans.count})` : '';
    if (list.batches.length === 0) {
      queueBody.innerHTML = `<p class="empty-hint">${activeTab === 'registrations'
        ? 'No registrations waiting. New assets registered on a phone appear here after the next sync.'
        : 'No scans waiting. Scans and edits from a phone appear here after the next sync.'}</p>`;
      return;
    }
    const isReg = activeTab === 'registrations';
    queueBody.innerHTML = list.batches.map((b) => `
      <section class="queue-batch" data-batch="${esc(b.batch_id)}">
        <header class="queue-batch-head">
          <span class="queue-device">${esc(b.device)}</span>
          <span class="queue-time">Sync request · ${localTime(b.received_at)} · ${b.items.length} ${isReg ? (b.items.length === 1 ? 'asset' : 'assets') : (b.items.length === 1 ? 'item' : 'items')}</span>
        </header>
        <div class="queue-scroll">
          <table class="retro-table queue-table">
            <thead><tr>${isReg
              ? '<th>Asset name</th><th>Category</th><th>Room</th><th>Assigned to</th><th>Status</th>'
              : '<th>Asset ID</th><th>Asset</th><th>Type</th><th>Scanned as</th><th>Scanned in</th><th>Changes</th>'}</tr></thead>
            <tbody>
              ${b.items.map((i) => isReg ? `
                <tr class="q-item" data-id="${i.id}" tabindex="0" role="button" aria-label="Review ${esc(i.name)}">
                  <td class="mono-strong">${esc(i.name)}</td><td>${esc(i.category) || '—'}</td><td>${esc(i.room)}</td>
                  <td>${esc(i.assigned_to) || '—'}</td><td>${statusBadge(i.status)}</td>
                </tr>` : `
                <tr class="q-item ${i.room_mismatch ? 'q-flag' : ''}" data-id="${i.id}" tabindex="0" role="button" aria-label="Review ${esc(i.asset_tag)}">
                  <td class="mono-strong">${esc(i.asset_tag)}</td><td>${esc(i.asset_name)}</td>
                  <td>${i.kind === 'edit' ? '<span class="badge badge-asset-pending">Edit</span>' : '<span class="badge badge-asset-active">Scan</span>'}</td>
                  <td>${i.kind === 'edit' ? '—' : scanBadge(i.scanned_as)}</td>
                  <td>${i.kind === 'edit' ? '—' : esc(i.scanned_room)}${i.room_mismatch ? `<span class="q-warn">registered in ${esc(i.registered_room)}</span>` : ''}</td>
                  <td>${i.change_fields.length ? esc(i.change_fields.join(', ')) : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <footer class="queue-batch-actions">
          <span class="q-sel">Click an asset to review it</span>
          <button type="button" class="btn-retro small danger q-reject-all">Reject all</button>
          <button type="button" class="btn-retro small q-verify-all">Verify all</button>
        </footer>
      </section>
    `).join('');

    queueBody.querySelectorAll('.queue-batch').forEach((batchEl) => {
      const batch = list.batches.find((x) => x.batch_id === batchEl.dataset.batch);
      const type = isReg ? 'registration' : 'scan';
      const open = (row) => row && openReviewModal(el, { type, id: Number(row.dataset.id) }, refreshAll);
      batchEl.addEventListener('click', (e) => open(e.target.closest('.q-item')));
      batchEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.q-item');
        if (!row) return;
        e.preventDefault();
        open(row);
      });
      batchEl.querySelector('.q-verify-all').addEventListener('click', () => reviewAll(type, 'approve', batch));
      batchEl.querySelector('.q-reject-all').addEventListener('click', () => reviewAll(type, 'reject', batch));
    });
  }

  async function reviewAll(type, action, batch) {
    const n = batch.items.length;
    const what = type === 'registration' ? `registration${n === 1 ? '' : 's'}` : `scan${n === 1 ? '' : 's'}`;
    const flagged = batch.items.filter((i) => i.room_mismatch).length;
    const msg = action === 'approve'
      ? `Verify all ${n} ${what} from ${batch.user}?${type === 'registration' ? ' This adds them to the registry.' : ''}${flagged ? `\n\n${flagged} of them were scanned in a different room than registered.` : ''}`
      : `Reject all ${n} ${what} from ${batch.user}? ${type === 'registration' ? 'No assets will be added.' : 'Nothing will be counted or changed.'}`;
    if (!confirm(msg)) return;
    queueBody.querySelectorAll(`[data-batch="${batch.batch_id}"] button`).forEach((b) => { b.disabled = true; });
    const res = await apiPost('/api/v1/inventory/pending/review', { type, action, ids: batch.items.map((i) => i.id) });
    if (!res.ok) alert(res.error || 'Could not save that. Try again.');
    else if (res.failed && res.failed.length) alert(`${res.failed.length} could not be verified:\n${res.failed.map((f) => f.error).join('\n')}`);
    refreshAll();
  }

  async function loadQueue() {
    const result = await apiGet('/api/v1/inventory/pending');
    if (!result.ok) {
      queueBody.innerHTML = `<p class="empty-hint">${esc(result.error || 'Could not load the queue.')}</p>`;
      return;
    }
    queue = result;
    shownCount = result.count;
    // First load: open on whichever list has something waiting.
    if (!activeTab) activeTab = result.registrations.count || !result.scans.count ? 'registrations' : 'scans';
    setTab(activeTab);
  }

  async function refreshAll() {
    await Promise.all([loadQueue(), loadRooms(), loadCheckinLog()]);
    document.dispatchEvent(new CustomEvent('assettrack:queue-changed'));
  }

  el.querySelectorAll('.queue-tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // New sync requests show up on their own.
  async function pollQueue() {
    const result = await apiGet('/api/v1/inventory/pending/count');
    if (result.ok && result.count !== shownCount) loadQueue();
  }
  const queuePoll = setInterval(pollQueue, 10000);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) { clearInterval(queuePoll); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  loadQueue();
  loadRooms();
  loadCheckinLog();
  return el;
}

// Compact widget kept for reuse elsewhere (e.g. an embedded dashboard tile).
export function renderPanel() {
  const el = document.createElement('div');
  el.className = 'panel inventory-panel';
  el.innerHTML = `<h3>Room verification progress</h3><div id="progress-bars" class="mono-list">Loading…</div>`;

  apiGet('/api/v1/inventory/progress').then((result) => {
    const container = el.querySelector('#progress-bars');
    if (!result.ok || result.rooms.length === 0) {
      container.textContent = 'No rooms configured yet.';
      return;
    }
    container.innerHTML = result.rooms.map((r) => `
      <div class="progress-row">
        <span class="progress-label">${r.room_name}</span>
        <div class="progress-track"><div class="progress-fill" style="width:${r.pct}%"></div></div>
        <span class="progress-pct">${r.verified}/${r.expected} (${r.pct}%)</span>
      </div>
    `).join('');
  });

  return el;
}
