// features/analytics/ui.js — "Spatial Analytics" screen: bar chart of scans
// by building, a set of headline stat cards, and a this-week/last-week
// activity heatmap. All CSS-drawn (no chart library) to keep the app fully
// offline and dependency-free.
import { apiGet } from '../../js/api-client.js';

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-analytics';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> SPATIAL ANALYTICS
        <div class="header-actions">
          <button class="btn-retro small" id="btn-refresh-analytics">↻ REFRESH</button>
        </div>
      </div>
      <div class="analytics-layout">
        <div class="analytics-main">
          <div class="panel">
            <h3>SCANS BY BUILDING (7 DAYS)</h3>
            <div id="bar-chart" class="bar-chart">Loading…</div>
          </div>
          <div class="panel">
            <h3>ACTIVITY HEATMAP — THIS WEEK VS LAST WEEK</h3>
            <div id="heatmap" class="heatmap">Loading…</div>
          </div>
        </div>
        <div class="analytics-stats" id="stat-cards">Loading…</div>
      </div>
    </div>
  `;

  function heatColor(value, max) {
    if (max === 0) return 'rgba(75, 86, 148, 0.08)';
    const intensity = Math.min(1, value / max);
    return `rgba(75, 86, 148, ${0.12 + intensity * 0.75})`;
  }

  async function load() {
    const result = await apiGet('/api/v1/analytics/summary');
    if (!result.ok) return;

    // Stat cards
    el.querySelector('#stat-cards').innerHTML = result.stats.map((s) => `
      <div class="stat-card">
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${s.label}</div>
      </div>
    `).join('');

    // Bar chart
    const bar = result.bar;
    const maxScans = Math.max(1, ...bar.map((b) => b.scans));
    el.querySelector('#bar-chart').innerHTML = bar.length ? `
      <div class="bar-row">
        ${bar.map((b) => `
          <div class="bar-col">
            <div class="bar-fill" style="height:${(b.scans / maxScans) * 100}%"></div>
            <span class="bar-value">${b.scans}</span>
            <span class="bar-label">${b.building}</span>
          </div>
        `).join('')}
      </div>
    ` : '<p class="empty-hint">No scan activity yet — data will appear once staff start syncing.</p>';

    // Heatmap
    const hm = result.heatmap;
    const maxVal = Math.max(1, ...hm.rows.flatMap((r) => r.values));
    el.querySelector('#heatmap').innerHTML = hm.buildings.length ? `
      <div class="heatmap-grid" style="grid-template-columns: 100px repeat(${hm.buildings.length}, 1fr);">
        <div></div>
        ${hm.buildings.map((b) => `<div class="heatmap-col-label">${b}</div>`).join('')}
        ${hm.rows.map((row) => `
          <div class="heatmap-row-label">${row.label}</div>
          ${row.values.map((v) => `
            <div class="heatmap-cell" style="background:${heatColor(v, maxVal)}" title="${v} scans">${v}</div>
          `).join('')}
        `).join('')}
      </div>
    ` : '<p class="empty-hint">No room/building data configured yet.</p>';
  }

  el.querySelector('#btn-refresh-analytics').addEventListener('click', load);
  load();
  return el;
}
