// features/mapping/ui-map.js — "Cluster Map": a real Leaflet map of campus,
// with Leaflet.markercluster grouping nearby pins as you zoom out. Markers
// are per-ASSET (each asset gets its own pin, positioned at its room's
// building coordinates) rather than one grouped pin per building — so
// registering a second asset in the same building shows up as its own
// separate, individually-clickable marker instead of folding into a shared
// popup list. Multiple assets in the same building necessarily share that
// building's exact lat/lng (assets don't have their own coordinates), which
// is exactly the case Leaflet.markercluster's built-in "spiderfy" handles:
// zoom in and click the cluster and it fans the overlapping markers out in
// a small spider pattern of individually-clickable points, rather than this
// needing to fake separation with per-asset jitter.
//
// Layout: a side rail next to the map holds a quick PROFILE preview (the
// currently-selected asset's avatar/name) and a RECENTLY ADDED list to
// jump to any asset; below the map, BUILDINGS (placement, admin-only) sits
// beside PROFILE DETAILS — the same selected asset expanded into the
// two-column "avatar + assigned-to/standing" | "asset details" layout.
// Building placement (PLACE ON MAP / MOVE PIN) still operates at the
// building level since that's what gives every asset inside it a location
// to inherit in the first place.
//
// Leaflet + Leaflet.markercluster are vendored locally (src/renderer/
// vendor/) and loaded via plain <link>/<script> tags in index.html's
// <head> — Leaflet's own "Using a Downloaded Version" instructions —
// rather than from a CDN, so the map keeps working with zero internet
// access, same offline philosophy as tile-cache.js's pre-downloaded tiles.
import { apiGet, apiPut } from '../../js/api-client.js';

// Those <head> tags are plain (non-module) scripts, so they run
// synchronously as the page parses — well before this module (loaded via
// <script type="module">, which is deferred by default) ever executes.
// window.L should already exist by the time render() below runs; this is
// just a safety check in case someone re-orders index.html later.
//
// Pins reveal nothing until clicked — no hover tooltip. bindPopup() below
// opens only on click (Leaflet's default for popups, unlike tooltips which
// default to hover), and Leaflet's default popup autoClose:true means
// clicking a different pin swaps the reveal rather than stacking them.
function ensureLeafletLoaded() {
  if (window.L && window.L.markerClusterGroup) return Promise.resolve();
  return Promise.reject(new Error(
    'Leaflet did not load — check that index.html\'s <head> still has the ' +
    'vendor/leaflet and vendor/leaflet.markercluster <link>/<script> tags.'
  ));
}

const STATUS_LABELS = { active: 'ACTIVE', pending: 'PENDING', maintenance: 'MAINT.', offline: 'OFFLINE' };

// Small circular "who this belongs to" avatar — the assigned user's photo
// (assets.assigned_photo, set from the Asset Registry modal) when one's
// been attached, otherwise first letters of up to two words in the
// assigned name, or a generic person glyph when unassigned.
function initialsOf(name) {
  if (!name) return '—';
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function avatarHtml(assignedTo, sizeClass = '', photo = null) {
  if (photo) {
    return `<img src="${photo}" class="map-avatar map-avatar-photo${sizeClass ? ' ' + sizeClass : ''}" alt="" />`;
  }
  return `<div class="map-avatar${sizeClass ? ' ' + sizeClass : ''}${assignedTo ? '' : ' map-avatar-empty'}">${initialsOf(assignedTo)}</div>`;
}

// What a single asset's marker reveals on click — the point of a per-asset
// pin is exactly this: who has it and where, without wading through every
// other asset in the same building first.
function assetPopupHtml(asset) {
  return `
    <div class="map-tooltip map-tooltip-asset">
      ${avatarHtml(asset.assigned_to, '', asset.assigned_photo)}
      <div class="map-tip-asset-info">
        <div class="map-tip-title">${asset.asset_tag} — ${asset.name}</div>
        <div class="map-tip-user">${asset.assigned_to ? asset.assigned_to : 'Unassigned'}</div>
        <div class="map-tip-count">${asset.building_name}${asset.room_name ? ' · ' + asset.room_name : ''}${asset.floor ? ' · ' + asset.floor : ''}</div>
      </div>
      ${asset.photo ? `<img src="${asset.photo}" class="map-tip-photo" alt="" />` : ''}
    </div>
  `;
}

// Placing/editing a building's pin is admin-only server-side (matches
// Locations screen management) — hide those controls for staff rather than
// showing buttons that will just come back "Forbidden."
function isAdmin() {
  const raw = localStorage.getItem('assettrack_user');
  return !!raw && JSON.parse(raw).role === 'admin';
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-map';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header"><span class="crt-dot"></span> CLUSTER MAP</div>
      <div class="map-top-row">
        <div class="map-side-rail">
          <div class="map-profile-block" id="rail-profile-block">
            ${avatarHtml(null, 'map-avatar-lg')}
            <div class="map-profile-name" id="rail-profile-name">No asset selected</div>
            <div class="map-profile-caption">PROFILE</div>
          </div>
          <div class="map-side-divider"></div>
          <div class="panel-title">RECENTLY ADDED</div>
          <div id="recent-assets" class="mono-list map-recent-list">Loading…</div>
        </div>
        <div class="map-main">
          <div id="leaflet-map" class="leaflet-map-container">Loading map…</div>
        </div>
      </div>
      <p class="map-caption">ASSETTRACK v2.4.1 // NBSC CAMPUS MAP — click a pin to reveal that asset's profile; zoom in and click a cluster to spread out assets sharing a building</p>
    </div>
    <div class="map-lower">
      <div class="crt-panel map-legend" id="unplaced-panel">
        <div class="panel-title">BUILDINGS</div>
        <div id="unplaced-buildings" class="mono-list">Loading…</div>
        <p class="map-hint">Click a pin to reveal that asset's profile — nothing shows until you click it. Add or edit buildings and rooms from the LOCATIONS screen, or click PLACE ON MAP / MOVE PIN below, then click the map.</p>
      </div>
      <div class="crt-panel map-selection">
        <div class="panel-title">PROFILE DETAILS</div>
        <div id="profile-details" class="profile-details-grid">
          <div class="profile-details-empty">&gt; Click a pin or a recently added asset<br/>to view its profile_</div>
        </div>
      </div>
    </div>
  `;

  const mapEl = el.querySelector('#leaflet-map');
  const unplacedEl = el.querySelector('#unplaced-buildings');
  const recentEl = el.querySelector('#recent-assets');
  const railAvatarWrap = el.querySelector('#rail-profile-block');
  const railNameEl = el.querySelector('#rail-profile-name');
  const detailsEl = el.querySelector('#profile-details');

  if (!isAdmin()) el.querySelector('#unplaced-panel').style.display = 'none';

  let map = null;
  let clusterGroup = null;
  let placingBuildingId = null; // set while waiting for the next map click to land a pin
  const markersByAssetId = new Map(); // lets the RECENTLY ADDED list locate/open a specific asset's marker

  // Puts the map into "click to place/move this building" mode — used by
  // both the PLACE ON MAP / MOVE PIN buttons below and by the handoff from
  // the Locations screen (sessionStorage flag checked in loadBuildings).
  function startPlacing(id, name) {
    placingBuildingId = String(id);
    mapEl.style.cursor = 'crosshair';
    detailsEl.innerHTML = `<div class="profile-details-empty">Click the map to place "${name}"</div>`;
  }

  // Updates both the side rail's quick PROFILE preview and the below-map
  // PROFILE DETAILS panel for whichever asset was just clicked (a marker
  // or a RECENTLY ADDED row) — two views of the same selection.
  function selectAsset(asset) {
    railAvatarWrap.innerHTML = `
      ${avatarHtml(asset.assigned_to, 'map-avatar-lg', asset.assigned_photo)}
      <div class="map-profile-name" id="rail-profile-name">${asset.assigned_to ? asset.assigned_to : 'Unassigned'}</div>
      <div class="map-profile-caption">PROFILE</div>
    `;

    detailsEl.innerHTML = `
      <div class="profile-details-left">
        ${avatarHtml(asset.assigned_to, 'map-avatar-xl', asset.assigned_photo)}
        <div class="profile-field">
          <span class="profile-field-label">ASSIGNED TO</span>
          <span class="profile-field-value">${asset.assigned_to ? asset.assigned_to : 'Unassigned'}</span>
        </div>
        <div class="profile-field">
          <span class="profile-field-label">STANDING</span>
          <span class="profile-field-value"><span class="badge badge-asset-${asset.status}">${STATUS_LABELS[asset.status] || asset.status}</span></span>
        </div>
      </div>
      <div class="profile-details-right">
        <div class="panel-subtitle">Asset Details</div>
        <div class="profile-detail-row"><strong>Tag:</strong> ${asset.asset_tag}</div>
        <div class="profile-detail-row"><strong>Name:</strong> ${asset.name}</div>
        <div class="profile-detail-row"><strong>Location:</strong> ${asset.building_name}${asset.room_name ? ' · ' + asset.room_name : ''}${asset.floor ? ' · ' + asset.floor : ''}</div>
        ${asset.photo ? `<img src="${asset.photo}" class="map-tip-photo room-detail-photo" alt="" />` : ''}
      </div>
    `;
  }

  // Zooms/pans until the marker is out of any cluster it's currently
  // folded into, then opens its popup — this is Leaflet.markercluster's
  // own method for "reveal this specific marker even if it's clustered",
  // which is exactly what clicking a RECENTLY ADDED row needs to do.
  function locateAsset(asset) {
    selectAsset(asset);
    const marker = markersByAssetId.get(asset.id);
    if (!marker) return;
    clusterGroup.zoomToShowLayer(marker, () => marker.openPopup());
  }

  async function loadBuildings() {
    const result = await apiGet('/api/v1/map/buildings-map');
    if (!result.ok) { unplacedEl.textContent = result.error || 'Unable to load building data.'; return; }

    // Every building is listed here — placed ones get a MOVE PIN button
    // (in case the pin needs adjusting), unplaced ones get PLACE ON MAP —
    // this is the map-click alternative to typing exact coordinates in
    // the Locations screen's Add/Edit Building form.
    unplacedEl.innerHTML = result.buildings.length
      ? result.buildings.map((b) => `
          <div class="mono-row mono-row-place">
            <span>${b.name} (${b.room_count} room${b.room_count === 1 ? '' : 's'})${b.latitude != null ? ' · pinned' : ''}</span>
            <button class="btn-retro small outline btn-place" data-id="${b.id}" data-name="${b.name}">${b.latitude != null ? 'MOVE PIN' : 'PLACE ON MAP'}</button>
          </div>
        `).join('')
      : '<div class="mono-row">No buildings yet — add one from LOCATIONS.</div>';

    unplacedEl.querySelectorAll('.btn-place').forEach((btn) => {
      btn.addEventListener('click', () => startPlacing(btn.dataset.id, btn.dataset.name));
    });

    // Handoff from the Locations screen's PLACE ON MAP / MOVE PIN button:
    // jump straight into placement mode for that specific building rather
    // than making the admin find it again in the list above.
    const pending = sessionStorage.getItem('assettrack_place_building');
    if (pending) {
      sessionStorage.removeItem('assettrack_place_building');
      try {
        const { id, name } = JSON.parse(pending);
        if (result.buildings.some((b) => b.id === id)) startPlacing(id, name);
      } catch { /* malformed/stale flag — ignore */ }
    }
  }

  async function loadAssets() {
    const result = await apiGet('/api/v1/map/assets-map');
    if (!result.ok) { recentEl.textContent = result.error || 'Unable to load asset data.'; return; }

    clusterGroup.clearLayers();
    markersByAssetId.clear();
    result.assets.forEach((asset) => {
      const marker = window.L.marker([asset.latitude, asset.longitude]);
      // bindPopup (not bindTooltip) so nothing shows until the pin is
      // clicked — no hover reveal.
      marker.bindPopup(assetPopupHtml(asset), { maxWidth: 240 });
      marker.on('click', () => selectAsset(asset));
      markersByAssetId.set(asset.id, marker);
      clusterGroup.addLayer(marker);
    });

    recentEl.innerHTML = result.assets.length
      ? result.assets.slice(0, 8).map((a) => `
          <div class="mono-row mono-row-place recent-asset-row" data-id="${a.id}">
            <span>
              <strong>${a.asset_tag}</strong> — ${a.name}<br/>
              <span class="recent-asset-user">${a.assigned_to ? a.assigned_to : 'Unassigned'} · ${a.building_name}</span>
            </span>
          </div>
        `).join('')
      : '<div class="mono-row">No assets placed on the map yet — assets appear here once their room\'s building has a pin.</div>';

    const assetsById = new Map(result.assets.map((a) => [a.id, a]));
    recentEl.querySelectorAll('.recent-asset-row').forEach((row) => {
      row.addEventListener('click', () => {
        const asset = assetsById.get(Number(row.dataset.id));
        if (asset) locateAsset(asset);
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
    // which specific NBSC building is which.
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
      if (!placingBuildingId) return;
      const buildingId = placingBuildingId;
      placingBuildingId = null;
      mapEl.style.cursor = '';
      const result = await apiPut(`/api/v1/map/buildings/${buildingId}/location`, {
        latitude: e.latlng.lat,
        longitude: e.latlng.lng
      });
      if (result.ok) { loadBuildings(); loadAssets(); }
      else alert(result.error || 'Could not save that location.');
    });

    await Promise.all([loadBuildings(), loadAssets()]);

    // The map is created with a fixed-height container that's a flex
    // sibling of the side rail; Leaflet measures its container's size once
    // on init, so give it a nudge in case web fonts finished loading late
    // and reflowed the rail's width after that first measurement.
    setTimeout(() => map && map.invalidateSize(), 200);
  }

  initMap().catch((err) => {
    mapEl.textContent = err.message;
  });

  // Registering/editing an asset (Asset Registry modal, src/features/
  // assets/ui.js) dispatches this on save — refresh right away so a
  // newly registered asset shows its own pin and appears in RECENTLY ADDED
  // without needing to leave and come back to this screen.
  const onAssetsChanged = () => { if (map) loadAssets(); };
  document.addEventListener('assettrack:assets-changed', onAssetsChanged);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      document.removeEventListener('assettrack:assets-changed', onAssetsChanged);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return el;
}
