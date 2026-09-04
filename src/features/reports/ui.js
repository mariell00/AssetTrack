// features/reports/ui.js — "Reports" screen: filter parameters, two big
// action cards (PDF / Excel), and a live preview panel of what the report
// will contain before you commit to generating it.
import { apiGet } from '../../js/api-client.js';

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-reports';
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  el.innerHTML = `
    <div class="crt-panel">
      <div class="panel-title">REPORT PARAMETERS</div>
      <div class="report-params-grid">
        <label>DATE FROM<input type="date" id="report-from" class="retro-input" value="${fmt(monthAgo)}" /></label>
        <label>DATE TO<input type="date" id="report-to" class="retro-input" value="${fmt(today)}" /></label>
        <label>ROOM / LOCATION
          <input type="text" id="report-room" class="retro-input" value="ALL ROOMS" placeholder="ALL ROOMS" />
        </label>
        <label>STATUS FILTER
          <select id="report-status" class="retro-input">
            <option value="ALL">ALL</option>
            <option value="active">ACTIVE</option>
            <option value="maintenance">MAINTENANCE</option>
            <option value="pending">PENDING</option>
            <option value="offline">OFFLINE</option>
          </select>
        </label>
      </div>
    </div>

    <div class="report-action-row">
      <button class="report-action-card" id="btn-pdf">
        <span class="report-action-icon">⏏</span>
        <span class="report-action-label">[ GENERATE PDF ]</span>
        <span class="report-action-caption">FULL ASSET INVENTORY REPORT</span>
      </button>
      <button class="report-action-card" id="btn-xlsx">
        <span class="report-action-icon">▤</span>
        <span class="report-action-label">[ EXPORT EXCEL ]</span>
        <span class="report-action-caption">SPREADSHEET DATA EXPORT (.XLSX)</span>
      </button>
    </div>

    <div class="crt-panel">
      <div class="panel-title">REPORT PREVIEW</div>
      <div id="report-preview" class="report-preview-grid">Loading…</div>
    </div>
  `;

  function currentParams() {
    return {
      from: el.querySelector('#report-from').value,
      to: el.querySelector('#report-to').value,
      room: el.querySelector('#report-room').value,
      status: el.querySelector('#report-status').value
    };
  }

  async function loadPreview() {
    const { from, to, room, status } = currentParams();
    const qs = new URLSearchParams({ from, to, room, status }).toString();
    const result = await apiGet(`/api/v1/reports/preview?${qs}`);
    const box = el.querySelector('#report-preview');
    if (!result.ok) { box.textContent = 'Unable to load preview.'; return; }
    const p = result.preview;
    box.innerHTML = `
      <div class="preview-stat"><span class="preview-label">TOTAL RECORDS</span><span class="preview-value">${p.total_records}</span></div>
      <div class="preview-stat"><span class="preview-label">DATE RANGE</span><span class="preview-value">${p.date_range_days ? p.date_range_days + ' DAYS' : '—'}</span></div>
      <div class="preview-stat"><span class="preview-label">ROOMS</span><span class="preview-value">${p.rooms_count}</span></div>
      <div class="preview-stat"><span class="preview-label">STATUS</span><span class="preview-value">${p.status}</span></div>
    `;
  }

  function downloadReport(format) {
    const { from, to, room, status } = currentParams();
    const qs = new URLSearchParams({ from, to, room, status, format }).toString();
    window.location.href = `/api/v1/reports/download?${qs}`;
    setTimeout(loadPreview, 800); // pick up the new EXPORT line in the activity log
  }

  ['#report-from', '#report-to', '#report-room', '#report-status'].forEach((sel) => {
    el.querySelector(sel).addEventListener('change', loadPreview);
  });
  el.querySelector('#btn-pdf').addEventListener('click', () => downloadReport('pdf'));
  el.querySelector('#btn-xlsx').addEventListener('click', () => downloadReport('xlsx'));

  loadPreview();
  return el;
}
