// features/mapping/ui-map.js — "Cluster Map": a real, offline-capable
// Leaflet map of the campus (Northern Bukidnon State College, Sitio
// Kihari, Tankulan, Manolo Fortich, Bukidnon), with rooms grouped into
// zoom-dependent clusters and colored by sync completeness. Colors and
// tiers are shared with the Inventory screen (see mapping/routes.js's
// /geojson, which reuses inventory/services.js#roomProgress) so "synced"
// means the same thing everywhere in the app.
import { apiGet } from '../../js/api-client.js';

const TIER_COLOR = { full: '#5FD68C', partial: '#F2C94C', low: '#EB5757' };

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
      <div id="leaflet-map" class="leaflet-map-holder">Loading map…</div>
      <p class="map-caption">ASSETTRACK v2.4.1 // NORTHERN BUKIDNON STATE COLLEGE — SITIO KIHARI, TANKULAN</p>
    </div>
    <div class="map-lower">
      <div class="crt-panel map-legend">
        <div class="panel-title">CLUSTER LEGEND</div>
        <div class="legend-row"><span class="legend-swatch tier-full"></span> FULLY SYNCED — 100%</div>
        <div class="legend-row"><span class="legend-swatch tier-partial"></span> PARTIAL SYNC — 75-99%</div>
        <div class="legend-row"><span class="legend-swatch tier-low"></span> LOW SYNC — BELOW 75%</div>
      </div>
      <div class="crt-panel map-selection">
        <div class="panel-title">SELECTED CLUSTER</div>
        <div id="room-detail" class="room-detail">&gt; Click a marker on the map<br/>to view room details_</div>
      </div>
    </div>
  `;

  let map = null;
  let markerLayer = null;
  let currentZoom = 17;

  function showClusterDetail(props) {
    const detail = el.querySelector('#room-detail');
    const roomRows = props.rooms
      .map((r) => {
        const tier = syncTier(r.pct);
        return `<div class="room-detail-row">${r.name} — <strong class="tier-text-${tier}">${r.pct}%</strong> (${r.asset_count} assets)</div>`;
      })
      .join('');
    const tier = syncTier(props.pct);
    const title = props.rooms.length > 1 ? `${props.rooms.length} ROOMS (CLUSTERED)` : props.rooms[0].name.toUpperCase();
    detail.innerHTML = `
      <div class="room-detail-title">${title}</div>
      <div class="room-detail-row">Total assets: <strong>${props.count}</strong></div>
      <div class="room-detail-row">Avg sync level: <strong class="tier-text-${tier}">${props.pct}%</strong></div>
      <hr class="room-detail-divider" />
      ${roomRows}
    `;
  }

  async function loadClusters() {
    if (!map || !markerLayer) return;
    const result = await apiGet(`/api/v1/map/geojson?zoom=${currentZoom}`);
    markerLayer.clearLayers();
    if (!result.ok || !result.features || result.features.length === 0) return;

    result.features.forEach((f) => {
      const [lng, lat] = f.geometry.coordinates;
      const tier = syncTier(f.properties.pct);
      const radius = 8 + Math.min(f.properties.count, 20) * 1.1;
      const marker = L.circleMarker([lat, lng], {
        radius,
        color: TIER_COLOR[tier],
        fillColor: TIER_COLOR[tier],
        fillOpacity: 0.55,
        weight: 2
      });
      const label =
        f.properties.rooms.length > 1
          ? `${f.properties.rooms.length} rooms · ${f.properties.count} assets`
          : `${f.properties.rooms[0].name} · ${f.properties.count} assets`;
      marker.bindTooltip(label);
      marker.on('click', () => showClusterDetail(f.properties));
      marker.addTo(markerLayer);
    });
  }

  async function init() {
    const holder = el.querySelector('#leaflet-map');
    const configResult = await apiGet('/api/v1/map/config');
    if (!configResult.ok) {
      holder.innerHTML = '<p class="empty-hint">Unable to load map configuration.</p>';
      return;
    }

    holder.textContent = '';
    map = L.map(holder, {
      minZoom: configResult.minZoom,
      maxZoom: configResult.maxZoom
    }).setView([configResult.center.lat, configResult.center.lng], configResult.defaultZoom);

    // Tiles are served from this same local server (see main.js) and
    // pre-cached to disk ahead of time via `npm run tiles:fetch`, so the
    // map keeps working with zero internet access day-to-day. If tiles
    // haven't been fetched yet, tiles just render blank — markers and
    // clustering still work fine either way.
    L.tileLayer('/static/map_tiles/{z}/{x}/{y}.png', {
      minZoom: configResult.minZoom,
      maxZoom: configResult.maxZoom,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);
    currentZoom = configResult.defaultZoom;

    // Cluster grouping is zoom-dependent server-side (see cluster.js) —
    // nearby rooms merge into a single marker when zoomed out and split
    // apart as you zoom in. Re-fetch on every zoom change to keep that live.
    map.on('zoomend', () => {
      currentZoom = map.getZoom();
      loadClusters();
    });

    await loadClusters();

    // Leaflet needs an explicit size recalculation if its container had
    // zero width/height at construction time — can happen here since the
    // screen may still be mid-transition when render() first runs.
    setTimeout(() => map && map.invalidateSize(), 100);
  }

  init();

  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      if (map) map.remove();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return el;
}
