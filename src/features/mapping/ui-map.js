// features/mapping/ui-map.js — "Cluster Map" screen: an abstract floor-plan
// grid of room blocks, color-coded by sync completeness. Deliberately not a
// geographic map (no tiles, no Leaflet) — this is faster, always works
// fully offline, and matches how staff actually think about the floor.
import { apiGet } from '../../js/api-client.js';

function syncTier(pct) {
  if (pct >= 100) return 'full';
  if (pct >= 75) return 'partial';
  return 'low';
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-map';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header"><span class="crt-dot"></span> CLUSTER MAP</div>
      <div id="room-grid" class="room-grid">Loading…</div>
      <p class="map-caption">ASSETTRACK v2.4.1 // FLOOR PLAN DISPLAY</p>
    </div>
    <div class="map-lower">
      <div class="crt-panel map-legend">
        <div class="panel-title">CLUSTER LEGEND</div>
        <div class="legend-row"><span class="legend-swatch tier-full"></span> FULLY SYNCED — 100%</div>
        <div class="legend-row"><span class="legend-swatch tier-partial"></span> PARTIAL SYNC — 75-99%</div>
        <div class="legend-row"><span class="legend-swatch tier-low"></span> LOW SYNC — BELOW 75%</div>
      </div>
      <div class="crt-panel map-selection">
        <div class="panel-title">SELECT A ROOM</div>
        <div id="room-detail" class="room-detail">&gt; Click a room block<br/>to view details_</div>
      </div>
    </div>
  `;

  async function load() {
    const result = await apiGet('/api/v1/inventory/progress');
    const grid = el.querySelector('#room-grid');
    if (!result.ok || result.rooms.length === 0) {
      grid.innerHTML = '<p class="empty-hint">No rooms configured yet. Add rooms via Asset Registry import.</p>';
      return;
    }

    grid.innerHTML = result.rooms.map((r) => `
      <div class="room-block tier-${syncTier(r.pct)}" data-room='${JSON.stringify(r).replace(/'/g, "&apos;")}'>
        <span class="room-block-name">${r.room_name}</span>
        <span class="room-block-ratio">${r.verified}/${r.expected}</span>
      </div>
    `).join('');

    grid.querySelectorAll('.room-block').forEach((block) => {
      block.addEventListener('click', () => {
        grid.querySelectorAll('.room-block').forEach((b) => b.classList.remove('selected'));
        block.classList.add('selected');
        const r = JSON.parse(block.dataset.room.replace(/&apos;/g, "'"));
        const tier = syncTier(r.pct);
        el.querySelector('#room-detail').innerHTML = `
          <div class="room-detail-title">${r.room_name}</div>
          <div class="room-detail-row">Verified: <strong>${r.verified} / ${r.expected}</strong></div>
          <div class="room-detail-row">Sync level: <strong class="tier-text-${tier}">${r.pct}%</strong></div>
          <div class="room-detail-row">Status: <strong class="tier-text-${tier}">${tier === 'full' ? 'FULLY SYNCED' : tier === 'partial' ? 'PARTIAL SYNC' : 'LOW SYNC'}</strong></div>
        `;
      });
    });
  }

  load();
  return el;
}
