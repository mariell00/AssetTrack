// features/inventory/ui.js — two things:
//  1) renderPanel() — a compact "room verification progress" widget, used
//     as a small tile embedded in other screens if needed.
//  2) render() — the "Sync" screen:
//       - PENDING APPROVAL: ONE list of everything phones sent at sync, whatever
//         it is — a REGISTRATION (a new asset) or an UPDATE (a scan or edit of an
//         existing asset). Rows are grouped by sync request (so a whole request can
//         be verified/rejected at once). Click a row for a pop-out: a registration
//         shows the new asset; an update shows ORIGINAL next to UPDATED.
//       - CHECK-IN LOG: past phone check-ins; click a row to see what it covered.
//     The "waiting for verification" notice that follows you around the app lives
//     in router.js and links here.
import { apiGet, apiPost } from '../../js/api-client.js';
import { confirmDialog } from '../assets/ui.js';

const SCAN_LABELS = { verified: 'Verified', missing: 'Missing', misplaced: 'Misplaced' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function localTime(sqlDate) {
  if (!sqlDate) return '—';
  const d = new Date(String(sqlDate).replace(' ', 'T') + (String(sqlDate).length <= 16 ? ':00Z' : 'Z')); // SQLite stores UTC
  return Number.isNaN(d.getTime()) ? esc(sqlDate)
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const STATUS_LABELS = { active: 'Active', maintenance: 'Maintenance', pending: 'Pending', offline: 'Offline' };
const statusBadge = (s) => `<span class="badge badge-asset-${esc(s || 'active')}">${STATUS_LABELS[s || 'active'] || esc(s)}</span>`;
const scanBadge = (s) => `<span class="badge badge-scan-${esc(s)}">${SCAN_LABELS[s] || esc(s)}</span>`;
const typeBadge = (type) => (type === 'registration'
  ? '<span class="badge badge-type-registration">Registration</span>'
  : '<span class="badge badge-type-update">Update</span>');

function peso(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isNaN(n) ? esc(v) : `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Opens a pop-out on `root`; returns { overlay, close }. Esc, ✕ and a click outside all close it.
function openPopout(root, { heading, bodyHtml, actionsHtml = '' }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box crt-panel asset-detail-box" role="dialog" aria-modal="true" aria-label="${esc(heading)}">
      <div class="crt-header"><span class="crt-dot"></span> ${esc(heading)}<button type="button" class="modal-close" data-close aria-label="Close">✕</button></div>
      <div class="ad-scroll">${bodyHtml}</div>
      ${actionsHtml ? `<div class="ad-actions">${actionsHtml}</div>` : ''}
    </div>`;
  root.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  return { overlay, close };
}

const field = (label, value) => `<div class="ad-field"><span class="ad-label">${label}</span><span class="ad-value">${value}</span></div>`;

// One column of the Original / Updated comparison.
function compareColumn(title, rows, side) {
  const cell = (c) => {
    const v = side === 'from' ? c.from : c.to;
    if (c.is_photo) return v ? `<img class="q-thumb" src="${v}" alt="" />` : '<span class="bd-dim">No photo</span>';
    if (c.field === 'status') return v ? statusBadge(v) : '—';
    if (c.field === 'value_php') return peso(v);
    return esc(v) || '—';
  };
  return `
    <div class="cmp-col">
      <h3>${title}</h3>
      ${rows.map((c) => `
        <div class="cmp-row${c.changed ? ` is-changed-${side}` : ''}">
          <span class="ad-label">${esc(c.label)}</span>
          <span class="ad-value">${cell(c)}</span>
        </div>`).join('')}
    </div>`;
}

// The review pop-out for ONE item. Resolves via `onDone` after it was verified/rejected.
async function openReviewModal(root, { type, id }, onDone) {
  const isReg = type === 'registration';
  const result = await apiGet(`/api/v1/inventory/pending/${isReg ? 'registrations' : 'scans'}/${id}`);
  if (!result.ok) { alert(result.error || 'Could not open this item.'); onDone(); return; }
  const d = isReg ? result.registration : result.scan;

  let heading; let body; let verifyLabel;

  if (isReg) {
    const a = d.asset;
    heading = 'Review registration';
    verifyLabel = 'Verify & add asset';
    body = `
      <div class="ad-top">
        ${a.photo ? `<img class="ad-photo" src="${a.photo}" alt="Photo of ${esc(a.name)}" />` : '<div class="ad-photo ad-photo-empty">No photo</div>'}
        <div class="ad-id">
          <div>${typeBadge('registration')}</div>
          <div class="ad-tag">${esc(a.name)}</div>
          <div>${statusBadge(a.status)}</div>
          <div class="ad-name">The Asset ID is generated when you verify this.</div>
        </div>
      </div>
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
    const changed = d.compare.filter((c) => c.changed);
    heading = 'Review update';
    verifyLabel = d.kind === 'edit' ? 'Apply changes' : 'Verify update';
    body = `
      <div class="ad-head">
        <div>${typeBadge('update')} ${d.kind === 'edit' ? '<span class="badge">Edit</span>' : `<span class="badge">Mobile scan</span> ${scanBadge(d.scanned_as)}`}</div>
        <div class="ad-tag">${esc(a.asset_tag)}</div>
        <div class="ad-name">${esc(a.name)}</div>
      </div>
      <div class="ad-grid">
        ${d.kind === 'scan' ? field('Scanned in', esc(d.scanned_room)) : field('Type', 'Edited from the registry list')}
        ${field('Registered in', esc(d.registered_room))}
        ${field('Sent by', esc(d.scanned_by))}
        ${field('Sent', localTime(d.received_at))}
      </div>
      ${d.room_mismatch ? `<p class="q-callout">This asset was scanned in <strong>${esc(d.scanned_room)}</strong> but is registered in <strong>${esc(d.registered_room)}</strong>. Check before verifying.</p>` : ''}
      ${changed.length
        ? `<p class="cmp-summary">${plural(changed.length, 'field')} will change. Changes are highlighted.</p>
           <div class="cmp">${compareColumn('Original', d.compare, 'from')}${compareColumn('Updated', d.compare, 'to')}</div>`
        : `<p class="q-callout">${d.kind === 'edit' ? 'These edits match what is already saved.' : 'No field changes. This scan only confirms the asset was found.'}</p>
           <div class="cmp cmp-single">${compareColumn('Current details', d.compare, 'from')}</div>`}
      <div class="ad-section"><h3>Sent from</h3><p class="ad-text">${esc(d.device)}</p></div>`;
  }

  const { overlay, close } = openPopout(root, {
    heading, bodyHtml: body,
    actionsHtml: `
      <button type="button" class="btn-retro small danger" id="rv-reject">Reject</button>
      <button type="button" class="btn-retro small" id="rv-verify">${verifyLabel}</button>`
  });
  overlay.querySelector('#rv-verify').focus();

  async function act(action) {
    if (action === 'reject') {
      const sure = await confirmDialog({
        title: 'Reject this?',
        messageHtml: isReg ? 'The asset will not be added.' : 'It will not be counted and no changes will be applied.',
        confirmLabel: 'Reject', danger: true
      });
      if (!sure) return;
    }
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

// The pop-out for one check-in log row: who, where, when, and the assets it covered.
function openCheckinModal(root, row) {
  const items = row.items || [];
  const body = `
    <div class="ad-head">
      <div><span class="status-dot status-${row.status}"></span>${row.status === 'complete' ? 'Complete' : 'Partial'} check-in</div>
      <div class="ad-tag">${esc(row.room)}</div>
      <div class="ad-name">${esc(row.device)}</div>
    </div>
    <div class="ad-grid">
      ${field('Checked in', localTime(row.time))}
      ${field('Scanned by', esc(row.user))}
      ${field('Assets', row.expected ? `${row.count} of ${row.expected}` : String(row.count))}
      ${field('Missing', row.missing != null ? String(row.missing) : '—')}
    </div>
    ${row.notes ? `<div class="ad-section"><h3>Notes</h3><p class="ad-text">${esc(row.notes)}</p></div>` : ''}
    <div class="ad-section">
      <h3>Assets in this check-in (${items.length})</h3>
      ${items.length
        ? items.map((i) => `
          <div class="ad-row">
            <span class="ad-row-main"><strong>${esc(i.asset_tag)}</strong> · ${esc(i.name)}</span>
            ${scanBadge(i.status)}
            <span class="ad-row-meta">${localTime(i.scanned_at)}</span>
          </div>`).join('')
        : '<p class="ad-empty">No individual assets were recorded for this check-in.</p>'}
    </div>`;
  openPopout(root, { heading: 'Check-in details', bodyHtml: body });
}

// Registrations + updates, regrouped by sync request so a request that carried both
// shows as one block. Newest request first.
function groupQueue(queue) {
  const groups = new Map();
  const put = (batch, item) => {
    if (!groups.has(batch.batch_id)) groups.set(batch.batch_id, { ...batch, items: [] });
    groups.get(batch.batch_id).items.push(item);
  };
  queue.registrations.batches.forEach((b) => b.items.forEach((i) => put(b, { ...i, type: 'registration' })));
  queue.scans.batches.forEach((b) => b.items.forEach((i) => put(b, { ...i, type: 'update' })));
  return [...groups.values()].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
}

function rowHtml(i) {
  if (i.type === 'registration') {
    const extra = [i.category, i.assigned_to ? `for ${i.assigned_to}` : null].filter(Boolean).join(' · ');
    return `
      <tr class="q-item" data-type="registration" data-id="${i.id}" tabindex="0" role="button" aria-label="Review registration ${esc(i.name)}">
        <td>${typeBadge('registration')}</td>
        <td><span class="mono-strong">${esc(i.name)}</span><span class="q-sub">Asset ID is assigned when verified</span></td>
        <td>${esc(i.room)}</td>
        <td>New asset${extra ? ` · ${esc(extra)}` : ''}</td>
        <td class="q-go" aria-hidden="true">Review ›</td>
      </tr>`;
  }
  const changes = i.change_fields.length ? `changes ${esc(i.change_fields.join(', '))}` : '';
  const what = i.kind === 'edit'
    ? `Edit · ${changes || 'no changes'}`
    : `Mobile scan · ${SCAN_LABELS[i.scanned_as] || esc(i.scanned_as)}${changes ? ` · ${changes}` : ''}`;
  return `
    <tr class="q-item${i.room_mismatch ? ' q-flag' : ''}" data-type="scan" data-id="${i.id}" tabindex="0" role="button" aria-label="Review update ${esc(i.asset_tag)}">
      <td>${typeBadge('update')}</td>
      <td><span class="mono-strong">${esc(i.asset_name)}</span><span class="q-sub">${esc(i.asset_tag)}</span></td>
      <td>${i.kind === 'edit' ? esc(i.registered_room) : esc(i.scanned_room)}${i.room_mismatch ? `<span class="q-warn">registered in ${esc(i.registered_room)}</span>` : ''}</td>
      <td>${what}</td>
      <td class="q-go" aria-hidden="true">Review ›</td>
    </tr>`;
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-inventory';
  el.innerHTML = `
    <div class="crt-panel queue-panel">
      <div class="crt-header"><span class="crt-dot"></span> Pending approval <span class="tab-count" id="pa-count"></span></div>
      <p class="queue-lede">Everything phones sent at their last sync waits here until you verify it. A <strong>registration</strong> adds a new asset; an <strong>update</strong> is a scan or an edit of an asset that already exists. Click a row to review it.</p>
      <div id="queue-body" class="queue-body">Loading…</div>
    </div>
    <div class="crt-panel checkin-panel">
      <div class="crt-header"><span class="crt-dot"></span> Check-in log</div>
      <table class="retro-table checkin-table">
        <thead><tr><th>Time</th><th>Device</th><th>Room</th><th>Count</th><th>Status</th><th></th></tr></thead>
        <tbody id="checkin-rows"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  const queueBody = el.querySelector('#queue-body');
  let groups = [];
  let shownCount = null;
  let log = [];

  async function loadCheckinLog() {
    const result = await apiGet('/api/v1/inventory/sync-log?limit=20');
    const tbody = el.querySelector('#checkin-rows');
    if (!result.ok || result.log.length === 0) {
      log = [];
      tbody.innerHTML = '<tr><td colspan="6">No sync activity yet.</td></tr>';
      return;
    }
    log = result.log;
    tbody.innerHTML = log.map((row, i) => `
      <tr class="checkin-row" data-i="${i}" tabindex="0" role="button" aria-label="Details of the check-in from ${esc(row.device)}">
        <td>${localTime(row.time)}</td>
        <td>${esc(row.device)}</td>
        <td>${esc(row.room)}</td>
        <td>${row.count}</td>
        <td><span class="status-dot status-${row.status}"></span>${row.status === 'complete' ? 'Complete' : 'Partial'}</td>
        <td class="q-go" aria-hidden="true">Details ›</td>
      </tr>`).join('');
  }

  const checkinBody = el.querySelector('#checkin-rows');
  const openCheckin = (tr) => { const row = tr && log[Number(tr.dataset.i)]; if (row) openCheckinModal(el, row); };
  checkinBody.addEventListener('click', (e) => openCheckin(e.target.closest('.checkin-row')));
  checkinBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('.checkin-row');
    if (tr) { e.preventDefault(); openCheckin(tr); }
  });

  // ---- pending approval ----
  function drawQueue() {
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    el.querySelector('#pa-count').textContent = total ? String(total) : '';
    if (groups.length === 0) {
      queueBody.innerHTML = '<p class="empty-hint">Nothing is waiting for approval. Registrations, scans and edits from a phone appear here after its next sync.</p>';
      return;
    }
    queueBody.innerHTML = groups.map((g) => {
      const regs = g.items.filter((i) => i.type === 'registration').length;
      const upds = g.items.length - regs;
      const mix = [regs ? plural(regs, 'registration') : null, upds ? plural(upds, 'update') : null].filter(Boolean).join(', ');
      return `
      <section class="queue-batch" data-batch="${esc(g.batch_id)}">
        <header class="queue-batch-head">
          <span class="queue-device">${esc(g.device)}</span>
          <span class="queue-time">Sync request · ${localTime(g.received_at)} · ${mix}</span>
        </header>
        <div class="queue-scroll">
          <table class="retro-table queue-table">
            <thead><tr><th>Type</th><th>Asset</th><th>Room</th><th>Details</th><th></th></tr></thead>
            <tbody>${g.items.map(rowHtml).join('')}</tbody>
          </table>
        </div>
        <footer class="queue-batch-actions">
          <span class="q-sel">Click a row to review it</span>
          <button type="button" class="btn-retro small danger q-reject-all">Reject all</button>
          <button type="button" class="btn-retro small q-verify-all">Verify all</button>
        </footer>
      </section>`;
    }).join('');

    queueBody.querySelectorAll('.queue-batch').forEach((batchEl) => {
      const group = groups.find((x) => x.batch_id === batchEl.dataset.batch);
      const open = (row) => row && openReviewModal(el, { type: row.dataset.type === 'registration' ? 'registration' : 'scan', id: Number(row.dataset.id) }, refreshAll);
      batchEl.addEventListener('click', (e) => open(e.target.closest('.q-item')));
      batchEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.q-item');
        if (!row) return;
        e.preventDefault();
        open(row);
      });
      batchEl.querySelector('.q-verify-all').addEventListener('click', () => reviewGroup('approve', group));
      batchEl.querySelector('.q-reject-all').addEventListener('click', () => reviewGroup('reject', group));
    });
  }

  async function reviewGroup(action, group) {
    const regIds = group.items.filter((i) => i.type === 'registration').map((i) => i.id);
    const updIds = group.items.filter((i) => i.type === 'update').map((i) => i.id);
    const n = group.items.length;
    const flagged = group.items.filter((i) => i.room_mismatch).length;
    const what = [regIds.length ? plural(regIds.length, 'registration') : null, updIds.length ? plural(updIds.length, 'update') : null].filter(Boolean).join(' and ');
    const approve = action === 'approve';
    const ok = await confirmDialog({
      title: approve ? `Verify all ${n}?` : `Reject all ${n}?`,
      messageHtml: approve
        ? `Verify ${esc(what)} from ${esc(group.user)}?${regIds.length ? ' Registrations are added to the registry.' : ''}${flagged ? `<br/><br/>${plural(flagged, 'item')} ${flagged === 1 ? 'was' : 'were'} scanned in a different room than registered.` : ''}`
        : `Reject ${esc(what)} from ${esc(group.user)}? ${regIds.length ? 'No assets will be added. ' : ''}Nothing will be counted or changed.`,
      confirmLabel: approve ? 'Verify all' : 'Reject all', danger: !approve
    });
    if (!ok) return;
    queueBody.querySelectorAll(`[data-batch="${group.batch_id}"] button`).forEach((b) => { b.disabled = true; });
    const calls = [];
    if (regIds.length) calls.push(apiPost('/api/v1/inventory/pending/review', { type: 'registration', action, ids: regIds }));
    if (updIds.length) calls.push(apiPost('/api/v1/inventory/pending/review', { type: 'scan', action, ids: updIds }));
    const results = await Promise.all(calls);
    const failedCalls = results.filter((r) => !r.ok);
    const failedItems = results.flatMap((r) => r.failed || []);
    if (failedCalls.length) alert(failedCalls[0].error || 'Could not save that. Try again.');
    else if (failedItems.length) alert(`${plural(failedItems.length, 'item')} could not be verified:\n${failedItems.map((f) => f.error).join('\n')}`);
    refreshAll();
  }

  async function loadQueue() {
    const result = await apiGet('/api/v1/inventory/pending');
    if (!result.ok) {
      queueBody.innerHTML = `<p class="empty-hint">${esc(result.error || 'Could not load the queue.')}</p>`;
      return;
    }
    shownCount = result.count;
    groups = groupQueue(result);
    drawQueue();
  }

  async function refreshAll() {
    await Promise.all([loadQueue(), loadCheckinLog()]);
    document.dispatchEvent(new CustomEvent('assettrack:queue-changed'));
  }

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
