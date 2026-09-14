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
      <label class="report-action-card report-action-card-upload" id="btn-import">
        <span class="report-action-icon">⭱</span>
        <span class="report-action-label">[ IMPORT EXCEL ]</span>
        <span class="report-action-caption">BULK-LOAD ASSETS FROM .XLSX/.CSV</span>
        <input type="file" id="report-import-file" accept=".xlsx,.csv" hidden />
      </label>
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
    if (!result.ok) { box.textContent = result.error || 'Unable to load preview.'; return; }
    const p = result.preview;
    box.innerHTML = `
      <div class="preview-stat"><span class="preview-label">TOTAL RECORDS</span><span class="preview-value">${p.total_records}</span></div>
      <div class="preview-stat"><span class="preview-label">DATE RANGE</span><span class="preview-value">${p.date_range_days ? p.date_range_days + ' DAYS' : '—'}</span></div>
      <div class="preview-stat"><span class="preview-label">ROOMS</span><span class="preview-value">${p.rooms_count}</span></div>
      <div class="preview-stat"><span class="preview-label">STATUS</span><span class="preview-value">${p.status}</span></div>
    `;
  }

  // Fetched as a blob (rather than a plain window.location.href navigation)
  // so a server-side failure can be shown as an alert instead of blowing
  // away the whole Admin Hub UI with a raw JSON error page.
  async function downloadReport(format, btn) {
    const { from, to, room, status } = currentParams();
    const qs = new URLSearchParams({ from, to, room, status, format }).toString();
    const originalLabel = btn.querySelector('.report-action-label').textContent;
    btn.disabled = true;
    btn.querySelector('.report-action-label').textContent = '[ GENERATING… ]';

    try {
      const token = localStorage.getItem('assettrack_token');
      const res = await fetch(`/api/v1/reports/download?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `Report generation failed (HTTP ${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'xlsx' ? 'assettrack-audit.xlsx' : 'assettrack-audit.pdf';
      a.click();
      URL.revokeObjectURL(url);
      loadPreview();
    } catch (err) {
      alert('Report generation failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.querySelector('.report-action-label').textContent = originalLabel;
    }
  }

  ['#report-from', '#report-to', '#report-room', '#report-status'].forEach((sel) => {
    el.querySelector(sel).addEventListener('change', loadPreview);
  });
  el.querySelector('#btn-pdf').addEventListener('click', (e) => downloadReport('pdf', e.currentTarget));
  el.querySelector('#btn-xlsx').addEventListener('click', (e) => downloadReport('xlsx', e.currentTarget));

  el.querySelector('#report-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const card = el.querySelector('#btn-import');
    const label = card.querySelector('.report-action-label');
    const originalLabel = label.textContent;
    label.textContent = '[ IMPORTING… ]';

    try {
      const token = localStorage.getItem('assettrack_token');
      const buffer = await file.arrayBuffer();
      const res = await fetch('/api/v1/assets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: buffer
      });
      const result = await res.json().catch(() => ({ ok: false, error: `Import failed (HTTP ${res.status}).` }));
      alert(result.ok ? `Imported ${result.imported} of ${result.total_rows} rows.` : (result.error || 'Import failed.'));
      if (result.ok) loadPreview();
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      label.textContent = originalLabel;
      e.target.value = '';
    }
  });

  loadPreview();
  return el;
}
