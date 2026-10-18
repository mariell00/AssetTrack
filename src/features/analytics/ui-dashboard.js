// features/analytics/ui-dashboard.js — the Dashboard screen.
// Layout follows the dashboard wireframe: a monthly bar graph and a set of
// circular status meters side by side, then a spreadsheet-style sheet of report
// logs underneath. The sheet has tabs along the bottom like a workbook:
// "Report logs" (scans) and "Activity log" (system events).
// All CSS-drawn — no chart library — so it keeps working fully offline.
import { apiGet } from '../../js/api-client.js';

const PLOT_HEIGHT = 300; // px — must match --bk-plot in app-brutal.css

const CATEGORY_CLASS = {
  SYNC: 'log-sync', IMPORT: 'log-import', ALERT: 'log-alert', UPDATE: 'log-update',
  CONN: 'log-conn', EXPORT: 'log-export', AUTH: 'log-auth', INIT: 'log-init'
};
const ASSET_STATUS_LABELS = { active: 'ACTIVE', maintenance: 'MAINT.', pending: 'PENDING', offline: 'OFFLINE' };
const SCAN_RESULT_LABELS = { verified: 'VERIFIED', missing: 'MISSING', misplaced: 'MISPLACED' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatStamp(sqlDate) {
  // "2026-10-14 12:25:00" (UTC, from SQLite) -> local "14 Oct, 8:25 PM"
  if (!sqlDate) return '—';
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return esc(sqlDate);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-dashboard';
  el.innerHTML = `
    <div class="bk-row">
      <section class="bk-panel" aria-labelledby="bk-chart-title">
        <header class="bk-panel-head">
          <h2 id="bk-chart-title">Verified assets per month</h2>
          <span class="bk-panel-meta" id="bk-chart-meta"></span>
        </header>
        <div class="bk-panel-body" id="bk-chart">Loading…</div>
      </section>

      <section class="bk-panel" aria-labelledby="bk-status-title">
        <header class="bk-panel-head">
          <h2 id="bk-status-title">Asset status</h2>
          <span class="bk-panel-meta" id="bk-status-meta"></span>
        </header>
        <div class="bk-panel-body" id="bk-status">Loading…</div>
      </section>
    </div>

    <section class="bk-sheet" aria-label="Logs">
      <div class="bk-sheet-view" id="bk-sheet-view">
        <div class="bk-empty">Loading…</div>
      </div>
      <footer class="bk-sheet-foot">
        <div class="bk-tabs" role="tablist">
          <button type="button" role="tab" class="bk-tab is-active" data-tab="logs" aria-selected="true">Report logs</button>
          <button type="button" role="tab" class="bk-tab" data-tab="activity" aria-selected="false">Activity log</button>
        </div>
        <span class="bk-sheet-count" id="bk-sheet-count"></span>
        <a class="bk-sheet-link" href="#/reports">Open reports</a>
      </footer>
    </section>
  `;

  const chartBox = el.querySelector('#bk-chart');
  const chartMeta = el.querySelector('#bk-chart-meta');
  const statusBox = el.querySelector('#bk-status');
  const statusMeta = el.querySelector('#bk-status-meta');
  const sheetView = el.querySelector('#bk-sheet-view');
  const sheetCount = el.querySelector('#bk-sheet-count');

  let activeTab = 'logs';
  let logs = [];
  let events = [];

  // ---- bar graph: verified assets per month ----
  function drawChart(monthly) {
    const max = Math.max(1, ...monthly.map((m) => m.verified));
    const current = monthly.length - 1;
    const total = monthly.reduce((sum, m) => sum + m.verified, 0);
    chartMeta.textContent = `Last 12 months`;
    if (total === 0) {
      chartBox.innerHTML = '<p class="bk-empty">No verified assets yet. Bars appear after staff sync their first room check.</p>';
      return;
    }
    chartBox.innerHTML = `
      <div class="bk-chart" role="img" aria-label="Verified assets per month, last 12 months">
        <div class="bk-grid" aria-hidden="true"><span>${max}</span><span></span><span></span><span>0</span></div>
        <div class="bk-cols">
          ${monthly.map((m, i) => `
            <div class="bk-col${i === current ? ' is-current' : ''}${m.verified === 0 ? ' is-zero' : ''}" title="${esc(m.label)} ${m.year}: ${m.verified} verified">
              <span class="bk-val">${m.verified}</span>
              <span class="bk-bar" style="height:${Math.round((m.verified / max) * PLOT_HEIGHT)}px"></span>
              <span class="bk-mon">${esc(m.label)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ---- circular progress meters: pending sync / active / maintenance / offline ----
  function drawStatus(s) {
    statusMeta.textContent = `${s.total.toLocaleString()} assets total`;
    if (s.total === 0) {
      statusBox.innerHTML = '<p class="bk-empty">No assets registered yet. Add some in the Asset registry.</p>';
      return;
    }
    const rows = [
      { key: 'pending', label: 'Pending sync', hint: 'not verified today', value: s.pendingSync },
      { key: 'active', label: 'Active', hint: 'in service', value: s.active },
      { key: 'maintenance', label: 'Maintenance', hint: 'flagged for repair', value: s.maintenance },
      { key: 'offline', label: 'Offline', hint: 'out of service', value: s.offline }
    ];
    statusBox.innerHTML = `<div class="bk-rings">${rows.map((r) => {
      const share = (r.value / s.total) * 100;
      const pct = Math.round(share);
      return `
        <div class="bk-ring bk-ring-${r.key}">
          <div class="bk-ring-dial" role="progressbar" aria-label="${r.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
            <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
              <circle class="bk-ring-track" cx="60" cy="60" r="46" />
              <circle class="bk-ring-fill" cx="60" cy="60" r="46" pathLength="100" stroke-dasharray="${share.toFixed(2)} 100" transform="rotate(-90 60 60)" />
              <circle class="bk-ring-edge" cx="60" cy="60" r="53.5" />
              <circle class="bk-ring-edge" cx="60" cy="60" r="38.5" />
            </svg>
            <span class="bk-ring-pct">${pct}<small>%</small></span>
          </div>
          <span class="bk-ring-label">${r.label}</span>
          <span class="bk-ring-count">${r.value.toLocaleString()}</span>
          <span class="bk-ring-hint">${r.hint}</span>
        </div>
      `;
    }).join('')}</div>`;
  }

  // ---- spreadsheet: report logs ----
  function drawLogs() {
    sheetCount.textContent = logs.length ? `Showing latest ${logs.length} scans` : '';
    if (logs.length === 0) {
      sheetView.innerHTML = '<p class="bk-empty">No scans recorded yet. Rows appear here after staff sync from the mobile app.</p>';
      return;
    }
    sheetView.innerHTML = `
      <div class="bk-scroll">
        <table class="bk-table">
          <thead>
            <tr>
              <th class="bk-rn" scope="col"></th>
              <th scope="col">Scanned</th>
              <th scope="col">Location</th>
              <th scope="col">Asset ID</th>
              <th scope="col">Asset</th>
              <th scope="col">Result</th>
              <th scope="col">Status</th>
              <th scope="col">Assigned to</th>
              <th scope="col">Scanned by</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map((r, i) => {
              const where = [r.building, r.room].filter(Boolean).join(' › ') || '—';
              const status = r.asset_status || 'active';
              return `
                <tr>
                  <th class="bk-rn" scope="row">${i + 1}</th>
                  <td class="bk-mono">${formatStamp(r.scanned_at)}</td>
                  <td>${esc(where)}</td>
                  <td class="bk-mono bk-strong">${esc(r.asset_tag)}</td>
                  <td>${esc(r.asset_name)}</td>
                  <td><span class="badge badge-scan-${esc(r.scan_status)}">${SCAN_RESULT_LABELS[r.scan_status] || esc(r.scan_status).toUpperCase()}</span></td>
                  <td><span class="badge badge-asset-${esc(status)}">${ASSET_STATUS_LABELS[status] || esc(status).toUpperCase()}</span></td>
                  <td>${r.assigned_to ? esc(r.assigned_to) : '<span class="bk-dim">—</span>'}</td>
                  <td>${esc(r.scanned_by)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ---- terminal: activity log ----
  function drawActivity() {
    sheetCount.textContent = events.length ? `Latest ${events.length} events` : '';
    if (events.length === 0) {
      sheetView.innerHTML = '<p class="bk-empty">No activity yet. Logins, imports and syncs are listed here as they happen.</p>';
      return;
    }
    sheetView.innerHTML = `
      <div class="bk-scroll bk-terminal">
        ${events.map((ev) => `
          <div class="log-line">
            <span class="log-time">[${esc(ev.created_at.replace('T', ' ').slice(11, 19))}]</span>
            <span class="log-tag ${CATEGORY_CLASS[ev.category] || ''}">${esc(ev.category)}</span>
            <span class="log-sep">·</span>
            <span class="log-msg log-level-${esc(ev.level)}">${esc(ev.message)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function drawSheet() {
    // keep the reader's scroll position when the 8-second refresh redraws the sheet
    const prev = sheetView.querySelector('.bk-scroll');
    const top = prev ? prev.scrollTop : 0;
    const left = prev ? prev.scrollLeft : 0;
    if (activeTab === 'logs') drawLogs(); else drawActivity();
    const next = sheetView.querySelector('.bk-scroll');
    if (next) { next.scrollTop = top; next.scrollLeft = left; }
  }

  async function loadSummary() {
    const result = await apiGet('/api/v1/analytics/dashboard');
    if (!result.ok) {
      chartBox.innerHTML = '<p class="bk-empty">Could not load the dashboard. Check that the server is running, then reopen this page.</p>';
      statusBox.innerHTML = '';
      return;
    }
    drawChart(result.monthly);
    drawStatus(result.status);
    logs = result.logs;
    if (activeTab === 'logs') drawSheet();
  }

  async function loadActivity() {
    const result = await apiGet('/api/v1/system/activity?limit=30');
    events = result.ok ? result.events : [];
    if (activeTab === 'activity') drawSheet();
  }

  el.querySelectorAll('.bk-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      el.querySelectorAll('.bk-tab').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      drawSheet();
    });
  });

  loadSummary();
  loadActivity();
  const poll = setInterval(() => { loadSummary(); loadActivity(); }, 8000);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) { clearInterval(poll); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return el;
}
