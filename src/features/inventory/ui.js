// features/inventory/ui.js — two things:
//  1) renderPanel() — a compact "room verification progress" widget, used
//     as a small tile embedded in other screens if needed.
//  2) render() — the full "Inventory Sync" screen: a grid of per-room sync
//     cards (segmented progress bar, last sync time, a manual SYNC/refresh
//     button) plus the Mobile Check-in Log table below.
import { apiGet } from '../../js/api-client.js';

function tierClass(pct) {
  if (pct >= 100) return 'full';
  if (pct >= 75) return 'partial';
  return 'low';
}

function formatTime(ts) {
  if (!ts) return 'never';
  return ts.replace('T', ' ').slice(0, 19);
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-inventory';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header"><span class="crt-dot"></span> INVENTORY SYNC</div>
      <div id="sync-grid" class="sync-grid">Loading…</div>
    </div>
    <div class="crt-panel checkin-panel">
      <div class="panel-title">MOBILE CHECK-IN LOG</div>
      <table class="retro-table">
        <thead><tr><th>TIME</th><th>DEVICE</th><th>ROOM</th><th>COUNT</th><th>STATUS</th></tr></thead>
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
          <div class="sync-card-last">LAST: ${formatTime(r.last_sync)}</div>
          <div class="segmented-bar">${segments}</div>
          <div class="sync-card-footer">
            <span class="sync-card-count tier-text-${tier}">${r.verified}/${r.expected}</span>
            <button class="btn-retro small btn-sync-room" data-room="${r.room_id}">⟳ SYNC</button>
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
        <td><span class="status-dot status-${row.status}"></span> ${row.status === 'complete' ? 'COMPLETE' : 'PARTIAL'}</td>
      </tr>
    `).join('');
  }

  loadRooms();
  loadCheckinLog();
  return el;
}

// Compact widget kept for reuse elsewhere (e.g. an embedded dashboard tile).
export function renderPanel() {
  const el = document.createElement('div');
  el.className = 'panel inventory-panel';
  el.innerHTML = `<h3>ROOM VERIFICATION PROGRESS</h3><div id="progress-bars" class="mono-list">Loading…</div>`;

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
