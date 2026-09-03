// features/inventory/ui.js — dashboard panel: live verification progress per room.
import { apiGet } from '../../js/api-client.js';

export function render() {
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
        <div class="progress-track">
          <div class="progress-fill" style="width:${r.pct}%"></div>
        </div>
        <span class="progress-pct">${r.verified}/${r.expected} (${r.pct}%)</span>
      </div>
    `).join('');
  });

  return el;
}
