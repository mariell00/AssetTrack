// features/mapping/ui-map.js — "Cluster Map": a real Leaflet map of campus,
// with Leaflet.markercluster grouping nearby room pins as you zoom out.
// Hovering a pin shows a tooltip listing that room's assets and who each
// one is assigned to. Leaflet + Leaflet.markercluster are vendored locally
// (src/renderer/vendor/) and loaded via plain <link>/<script> tags in
// index.html's <head> — Leaflet's own "Using a Downloaded Version"
// instructions — rather than from a CDN, so the map keeps working with
// zero internet access, same offline philosophy as tile-cache.js's
// pre-downloaded tiles.
import { apiGet, apiPut } from '../../js/api-client.js';

// Those <head> tags are plain (non-module) scripts, so they run
// synchronously as the page parses — well before this module (loaded via
// <script type="module">, which is deferred by default) ever executes.
// window.L should already exist by the time render() below runs; this is
// just a safety check in case someone re-orders index.html later.
function ensureLeafletLoaded() {
  if (window.L && window.L.markerClusterGroup) return Promise.resolve();
  return Promise.reject(new Error(
    'Leaflet did not load — check that index.html\'s <head> still has the ' +
    'vendor/leaflet and vendor/leaflet.markercluster <link>/<script> tags.'
  ));
}

// What shows on hover — the whole point of this screen per the request:
// "show information about the asset user" for each pin.
function tooltipHtml(room) {
  const assetRows = room.assets.length
    ? room.assets.map((a) => `
        <div class="map-tip-asset">
          <span class="map-tip-tag">${a.asset_tag}</span> — ${a.name}
          <div class="map-tip-user">${a.assigned_to ? 'User: ' + a.assigned_to : 'Unassigned'}</div>
        </div>
      `).join('')
    : '<div class="map-tip-asset map-tip-empty">No assets logged in this room yet.</div>';

  return `
    <div class="map-tooltip">
      <div class="map-tip-title">${room.name}</div>
      <div class="map-tip-count">${room.asset_count} asset${room.asset_count === 1 ? '' : 's'}</div>
      ${assetRows}
    </div>
  `;
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-map';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header"><span class="crt-dot"></span> CLUSTER MAP</div>
      <div id="leaflet-map" class="leaflet-map-container">Loading map…</div>
      <p class="map-caption">ASSETTRACK v2.4.1 // NBSC CAMPUS MAP — hover a pin for asset details</p>
    </div>
    <div class="map-lower">
      <div class="crt-panel map-legend">
        <div class="panel-title">UNPLACED ROOMS</div>
        <div id="unplaced-rooms" class="mono-list">Loading…</div>
      </div>
      <div class="crt-panel map-selection">
        <div class="panel-title">ROOM DETAILS</div>
        <div id="room-detail" class="room-detail">&gt; Hover or click a pin<br/>to view details_</div>
      </div>
    </div>
  `;

  const mapEl = el.querySelector('#leaflet-map');
  const unplacedEl = el.querySelector('#unplaced-rooms');
  const detailEl = el.querySelector('#room-detail');

  let map = null;
  let clusterGroup = null;
  let placingRoomId = null; // set while waiting for the next map click to land a pin

  function showDetail(room) {
    const rows = room.assets.map((a) => `
      <div class="room-detail-row">${a.asset_tag} — ${a.name}
        <strong>${a.assigned_to ? a.assigned_to : 'Unassigned'}</strong>
      </div>
    `).join('') || '<div class="room-detail-row">No assets logged here yet.</div>';
    detailEl.innerHTML = `
      <div class="room-detail-title">${room.name}</div>
      <div class="room-detail-row">Total assets: <strong>${room.asset_count}</strong></div>
      ${rows}
    `;
  }

  async function loadRooms() {
    const result = await apiGet('/api/v1/map/rooms');
    if (!result.ok) { unplacedEl.textContent = result.error || 'Unable to load room data.'; return; }

    clusterGroup.clearLayers();
    const placed = result.rooms.filter((r) => r.latitude != null && r.longitude != null);
    const unplaced = result.rooms.filter((r) => r.latitude == null || r.longitude == null);

    placed.forEach((room) => {
      const marker = window.L.marker([room.latitude, room.longitude]);
      marker.bindTooltip(tooltipHtml(room), { direction: 'top', offset: [0, -8], sticky: false });
      marker.on('click', () => showDetail(room));
      clusterGroup.addLayer(marker);
    });

    unplacedEl.innerHTML = unplaced.length
      ? unplaced.map((r) => `
          <div class="mono-row mono-row-place">
            <span>${r.name} (${r.asset_count})</span>
            <button class="btn-retro small outline btn-place" data-id="${r.id}" data-name="${r.name}">PLACE ON MAP</button>
          </div>
        `).join('')
      : '<div class="mono-row">All rooms are placed on the map.</div>';

    unplacedEl.querySelectorAll('.btn-place').forEach((btn) => {
      btn.addEventListener('click', () => {
        placingRoomId = btn.dataset.id;
        mapEl.style.cursor = 'crosshair';
        detailEl.innerHTML = `<div class="room-detail-title">Click the map to place "${btn.dataset.name}"</div>`;
      });
    });
  }

  async function initMap() {
    await ensureLeafletLoaded();
    if (!mapEl.isConnected) return; // user navigated away while Leaflet was still loading

    mapEl.textContent = '';
    // Centered on NBSC's actual campus coordinates (Manolo Fortich,
    // Bukidnon). Exact per-building placement then happens via the
    // PLACE ON MAP buttons below — a single campus-wide point can't tell
    // which specific NBSC building is which lab/room.
    map = window.L.map(mapEl).setView([8.359999, 124.868103], 17);

    window.L.tileLayer('/static/map_tiles/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Whatever provider actually filled src/static/map_tiles/ via
      // tiles:fetch (see settings.json's tileProvider) may need its own
      // attribution alongside OSM's — e.g. MapTiler requires "© MapTiler"
      // credit too. Update this if you configure a different provider.
      attribution: '&copy; MapTiler &copy; OpenStreetMap contributors',
      errorTileUrl: '' // blank rather than a broken-image icon for any tile not yet cached
    }).addTo(map);

    clusterGroup = window.L.markerClusterGroup();
    map.addLayer(clusterGroup);

    map.on('click', async (e) => {
      if (!placingRoomId) return;
      const roomId = placingRoomId;
      placingRoomId = null;
      mapEl.style.cursor = '';
      const result = await apiPut(`/api/v1/map/rooms/${roomId}/location`, {
        latitude: e.latlng.lat,
        longitude: e.latlng.lng
      });
      if (result.ok) loadRooms();
      else alert(result.error || 'Could not save that location.');
    });

    await loadRooms();
  }

  initMap().catch((err) => {
    mapEl.textContent = err.message;
  });
  return el;
}
