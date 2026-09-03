// features/reports/ui.js — date-picker + "Generate PDF/Excel" buttons.
export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-reports scanline';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header"><span class="crt-dot"></span> AUTOMATED AUDIT REPORTS</div>
      <div class="report-controls">
        <label>FROM <input type="date" id="report-from" class="retro-input" /></label>
        <label>TO <input type="date" id="report-to" class="retro-input" /></label>
        <button id="btn-pdf" class="btn-retro">⬇ PDF REPORT</button>
        <button id="btn-xlsx" class="btn-retro">⬇ EXCEL REPORT</button>
      </div>
      <p class="report-hint">Reports are generated locally from the current inventory.db — no internet required.</p>
    </div>
  `;

  function downloadReport(format) {
    const from = el.querySelector('#report-from').value;
    const to = el.querySelector('#report-to').value;
    const qs = new URLSearchParams({ from, to, format }).toString();
    window.location.href = `/api/v1/reports/download?${qs}`;
  }

  el.querySelector('#btn-pdf').addEventListener('click', () => downloadReport('pdf'));
  el.querySelector('#btn-xlsx').addEventListener('click', () => downloadReport('xlsx'));

  return el;
}
