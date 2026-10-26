// features/mapping/ui-map.js — "Cluster Map": a real Leaflet map of campus
// with ONE pin per building (the building is what actually has coordinates —
// every room and asset inside it inherits that spot). Clicking a pin reveals
// the building rather than a single asset: a small popup with the headline
// numbers, and a BUILDING DETAILS panel below the map with two tabs —
//
//   ROOMS   what's in each room, and who holds it
//   PEOPLE  who has assets in this building, and which ones
//
// Rooms answer "where is it", people answer "who has it"; showing both
// avoids guessing which one an admin wants. Assets are still reachable —
// one click deeper, inside a room or person — instead of being the pin.
//
// Layout: a side rail holds the selected building's name and a BUILDINGS list
// to jump to any pin; below the map, PIN PLACEMENT (admin-only) sits beside
// BUILDING DETAILS. Placing/moving a pin (PLACE ON MAP / MOVE PIN, or the
// handoff from the Locations screen) is unchanged.
//
// Leaflet + Leaflet.markercluster are vendored locally (src/renderer/vendor/)
// and loaded via <link>/<script> tags in index.html's <head>, so the map keeps
// working with zero internet access, same offline philosophy as tile-cache.js.
import { apiGet, apiPut } from '../../js/api-client.js';
import { esc } from '../assets/ui.js';

// Those <head> tags are plain (non-module) scripts, so they've already run by
// the time this deferred module executes; this is just a safety check in case
// someone re-orders index.html later.
function ensureLeafletLoaded() {
  if (window.L && window.L.markerClusterGroup) return Promise.resolve();
  return Promise.reject(new Error(
    'Leaflet did not load — check that index.html\'s <head> still has the ' +
    'vendor/leaflet and vendor/leaflet.markercluster <link>/<script> tags.'
  ));
}

const STATUS_LABELS = { active: 'Active', pending: 'Pending', maintenance: 'Maintenance', offline: 'Offline' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function initialsOf(name) {
  if (!name) return '—';
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

// Round "who" avatar: the person's photo from the Assignees list when they
// have one, otherwise their initials (or a blank grey disc for unassigned).
function avatarHtml(name, sizeClass = '', photo = null) {
  const cls = `map-avatar${sizeClass ? ' ' + sizeClass : ''}`;
  if (photo) return `<img src="${photo}" class="${cls} map-avatar-photo" alt="" />`;
  return `<div class="${cls}${name ? '' : ' map-avatar-empty'}" aria-hidden="true">${esc(initialsOf(name))}</div>`;
}

const statusBadge = (status) => `<span class="badge badge-asset-${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
const peopleCount = (n) => (n === 1 ? '1 person' : `${n} people`);
const summaryLine = (b) => `${plural(b.room_count, 'room')} · ${peopleCount(b.people_count)} · ${plural(b.asset_count, 'asset')}`;

// Square count badge used as the pin itself — the number is how many assets
// the building holds, so busy buildings read at a glance.
function pinIcon(b, selected) {
  return window.L.divIcon({
    className: 'bpin-wrap',
    html: `<div class="bpin${selected ? ' is-selected' : ''}"><span>${b.asset_count}</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -22]
  });
}

// What the pin's popup reveals on click: the headline only — the full lists
// live in BUILDING DETAILS so the popup stays small enough to read on a map.
function popupHtml(b) {
  const shown = b.people.slice(0, 5);
  const more = b.people.length - shown.length;
  return `
    <div class="map-tooltip map-bpop">
      <div class="map-tip-title">${esc(b.name)}</div>
      <div class="map-tip-count">${esc(summaryLine(b))}</div>
      ${b.people.length ? `
        <div class="bpop-people" aria-label="People with assets here">
          ${shown.map((p) => avatarHtml(p.name, 'map-avatar-sm', p.photo)).join('')}
          ${more > 0 ? `<span class="bpop-more">+${more}</span>` : ''}
        </div>` : ''}
      <div class="map-tip-empty">${b.room_count ? 'Rooms &amp; people in the panel below ↓' : 'No rooms yet — add some in Locations'}</div>
    </div>
  `;
}

// Placing/editing a building's pin is superadmin-only server-side (matches
// Locations screen management) — hide those controls for anyone else rather
// than showing buttons that will just come back "Forbidden."
function isAdmin() {
  const raw = localStorage.getItem('assettrack_user');
  return !!raw && JSON.parse(raw).role === 'superadmin';
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-map';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header"><span class="crt-dot"></span> Cluster map</div>
      <div class="map-top-row">
        <div class="map-side-rail">
          <div class="map-profile-block" id="rail-building-block">
            <div class="map-avatar map-avatar-lg map-avatar-building" aria-hidden="true">▦</div>
            <div class="map-profile-name" id="rail-building-name">No building selected</div>
            <div class="map-profile-caption">Building</div>
          </div>
          <div class="map-side-divider"></div>
          <div class="panel-title">Buildings</div>
          <div id="building-list" class="mono-list map-recent-list">Loading…</div>
        </div>
        <div class="map-main">
          <div id="leaflet-map" class="leaflet-map-container">Loading map…</div>
        </div>
      </div>
      <p class="map-caption">Click a pin to open that building. Its rooms and people appear below, and the number on each pin is how many assets it holds.</p>
    </div>
    <div class="map-lower">
      <div class="crt-panel map-legend" id="unplaced-panel">
        <div class="panel-title">Pin placement</div>
        <div id="unplaced-buildings" class="mono-list">Loading…</div>
        <p class="map-hint">Add or edit buildings and rooms from the Locations screen, or click Place on map / move pin here, then click the map.</p>
      </div>
      <div class="crt-panel map-selection">
        <div class="panel-title">Building details</div>
        <div id="building-details">
          <div class="profile-details-empty">Click a pin or a building in the list to see its rooms and people.</div>
        </div>
      </div>
    </div>
  `;

  const mapEl = el.querySelector('#leaflet-map');
  const unplacedEl = el.querySelector('#unplaced-buildings');
  const listEl = el.querySelector('#building-list');
  const railNameEl = el.querySelector('#rail-building-name');
  const detailsEl = el.querySelector('#building-details');

  if (!isAdmin()) el.querySelector('#unplaced-panel').style.display = 'none';

  let map = null;
  let clusterGroup = null;
  let placingBuildingId = null; // set while waiting for the next map click to land a pin
  let buildings = [];
  let selectedId = null;
  let activeTab = 'rooms';
  const markersByBuildingId = new Map();

  // Puts the map into "click to place/move this building" mode — used by both
  // the PLACE ON MAP / MOVE PIN buttons and the handoff from the Locations
  // screen (sessionStorage flag checked in loadData).
  function startPlacing(id, name) {
    placingBuildingId = String(id);
    mapEl.style.cursor = 'crosshair';
    detailsEl.innerHTML = `<div class="profile-details-empty">Click the map to place "${esc(name)}"</div>`;
  }

  // ---- BUILDING DETAILS -------------------------------------------------

  function roomsTab(b) {
    if (!b.rooms.length) return '<div class="profile-details-empty">No rooms in this building yet — add them from the Locations screen.</div>';
    const photoOf = new Map(b.people.map((p) => [p.name.toLowerCase(), p.photo]));
    return b.rooms.map((r) => {
      const stack = r.people.slice(0, 4).map((p) => avatarHtml(p.name, 'map-avatar-sm', photoOf.get(p.name.toLowerCase()))).join('');
      const more = r.people.length - 4;
      const body = r.asset_count === 0
        ? '<div class="bd-empty">No assets in this room yet.</div>'
        : `
          ${r.people.map((p) => `
            <div class="bd-person">${avatarHtml(p.name, 'map-avatar-sm', photoOf.get(p.name.toLowerCase()))}
              <span class="bd-person-name">${esc(p.name)}</span><span class="bd-count">${plural(p.asset_count, 'asset')}</span></div>`).join('')}
          ${r.unassigned_count ? `<div class="bd-person">${avatarHtml(null, 'map-avatar-sm')}<span class="bd-person-name bd-dim">Unassigned</span><span class="bd-count">${plural(r.unassigned_count, 'asset')}</span></div>` : ''}
          <div class="bd-assets">
            ${r.assets.map((a) => `<div class="bd-asset"><strong>${esc(a.asset_tag)}</strong> — ${esc(a.name)} ${statusBadge(a.status)}</div>`).join('')}
          </div>`;
      return `
        <details class="bd-item">
          <summary>
            <span class="bd-title">${esc(r.name)}${r.floor ? ` <span class="bd-dim">· ${esc(r.floor)}</span>` : ''}</span>
            <span class="bd-meta"><span class="bd-stack">${stack}${more > 0 ? `<span class="bpop-more">+${more}</span>` : ''}</span>${plural(r.asset_count, 'asset')}</span>
          </summary>
          <div class="bd-body">${body}</div>
        </details>`;
    }).join('');
  }

  function peopleTab(b) {
    if (!b.people.length && !b.unassigned_count) return '<div class="profile-details-empty">Nobody has assets in this building yet.</div>';
    // `avatar` is passed in so the Unassigned row can show the blank grey disc
    // instead of initials.
    const row = (p, avatar) => `
      <details class="bd-item">
        <summary>
          <span class="bd-title bd-title-person">${avatar}
            <span>${esc(p.name)}${p.sub ? `<br/><span class="bd-sub">${esc(p.sub)}</span>` : ''}</span></span>
          <span class="bd-meta">${plural(p.asset_count, 'asset')}${p.room_total ? ` · ${plural(p.room_total, 'room')}` : ''}</span>
        </summary>
        <div class="bd-body"><div class="bd-assets">
          ${p.assets.map((a) => `<div class="bd-asset"><strong>${esc(a.asset_tag)}</strong> — ${esc(a.name)} <span class="bd-dim">· ${esc(a.room_name)}</span> ${statusBadge(a.status)}</div>`).join('')}
        </div></div>
      </details>`;
    const people = b.people.map((p) => row(
      { ...p, sub: [p.position, p.department].filter(Boolean).join(' · '), room_total: p.rooms.length },
      avatarHtml(p.name, 'map-avatar-md', p.photo)
    ));
    if (b.unassigned_count) {
      people.push(row(
        { name: 'Unassigned', sub: 'Not held by anyone', asset_count: b.unassigned_count, room_total: 0, assets: b.unassigned_assets },
        avatarHtml(null, 'map-avatar-md')
      ));
    }
    return people.join('');
  }

  function renderDetails() {
    const b = buildings.find((x) => x.id === selectedId);
    if (!b) return;
    railNameEl.textContent = b.name;
    detailsEl.innerHTML = `
      <div class="bd-head">
        <div class="bd-name">${esc(b.name)}</div>
        <div class="bd-summary">${esc(summaryLine(b))}${b.latitude == null ? ' · <span class="bd-dim">not pinned on the map</span>' : ''}</div>
      </div>
      <div class="bk-tabs bd-tabs" role="tablist" aria-label="Building details">
        <button class="bk-tab${activeTab === 'rooms' ? ' is-active' : ''}" role="tab" aria-selected="${activeTab === 'rooms'}" data-tab="rooms" type="button">Rooms <span class="tab-count">${b.room_count}</span></button>
        <button class="bk-tab${activeTab === 'people' ? ' is-active' : ''}" role="tab" aria-selected="${activeTab === 'people'}" data-tab="people" type="button">People <span class="tab-count">${b.people_count}</span></button>
      </div>
      <div class="bd-list" role="tabpanel">${activeTab === 'rooms' ? roomsTab(b) : peopleTab(b)}</div>
    `;
    detailsEl.querySelectorAll('.bk-tab').forEach((btn) => btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderDetails();
    }));
  }

  function selectBuilding(id) {
    const restyle = (bid, selected) => {
      const entry = markersByBuildingId.get(bid);
      const b = buildings.find((x) => x.id === bid);
      if (entry && b) entry.marker.setIcon(pinIcon(b, selected));
    };
    restyle(selectedId, false);
    selectedId = id;
    restyle(id, true);
    listEl.querySelectorAll('.building-row').forEach((row) => row.classList.toggle('is-selected', Number(row.dataset.id) === id));
    renderDetails();
  }

  // Zooms/pans until the pin is out of any cluster it's folded into, then opens
  // its popup — what clicking a row in the BUILDINGS list does.
  function locateBuilding(b) {
    selectBuilding(b.id);
    const entry = markersByBuildingId.get(b.id);
    if (entry) clusterGroup.zoomToShowLayer(entry.marker, () => entry.marker.openPopup());
  }

  // ---- data ----------------------------------------------------------------

  async function loadData() {
    const result = await apiGet('/api/v1/map/buildings-map');
    if (!result.ok) {
      const msg = esc(result.error || 'Unable to load building data.');
      unplacedEl.innerHTML = msg; listEl.innerHTML = msg;
      return;
    }
    buildings = result.buildings;

    // Pins: only buildings that have been placed on the map.
    clusterGroup.clearLayers();
    markersByBuildingId.clear();
    buildings.filter((b) => b.latitude != null && b.longitude != null).forEach((b) => {
      const marker = window.L.marker([b.latitude, b.longitude], {
        icon: pinIcon(b, b.id === selectedId),
        title: b.name,
        alt: `${b.name}: ${plural(b.asset_count, 'asset')}`
      });
      // bindPopup (not bindTooltip): nothing shows until the pin is clicked.
      marker.bindPopup(popupHtml(b), { maxWidth: 260 });
      marker.on('click', () => selectBuilding(b.id));
      markersByBuildingId.set(b.id, { marker, buildingId: b.id });
      clusterGroup.addLayer(marker);
    });

    // BUILDINGS list (everyone): jump to any pinned building.
    listEl.innerHTML = buildings.length
      ? buildings.map((b) => `
          <div class="mono-row mono-row-place building-row${b.id === selectedId ? ' is-selected' : ''}${b.latitude == null ? ' is-unpinned' : ''}" data-id="${b.id}" tabindex="0" role="button">
            <span><strong>${esc(b.name)}</strong><br/>
              <span class="recent-asset-user">${b.latitude == null ? 'not pinned · ' : ''}${esc(plural(b.room_count, 'room'))} · ${esc(plural(b.asset_count, 'asset'))}</span></span>
          </div>`).join('')
      : '<div class="mono-row">No buildings yet — add one from Locations.</div>';
    const byId = new Map(buildings.map((b) => [b.id, b]));
    listEl.querySelectorAll('.building-row').forEach((row) => {
      const open = () => {
        const b = byId.get(Number(row.dataset.id));
        if (!b) return;
        if (b.latitude == null) selectBuilding(b.id); else locateBuilding(b);
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });

    // PIN PLACEMENT (superadmin): placed ones get MOVE PIN, unplaced PLACE ON MAP.
    unplacedEl.innerHTML = buildings.length
      ? buildings.map((b) => `
          <div class="mono-row mono-row-place">
            <span>${esc(b.name)}${b.latitude != null ? ' · pinned' : ''}</span>
            <button class="btn-retro small outline btn-place" data-id="${b.id}" data-name="${esc(b.name)}">${b.latitude != null ? 'Move pin' : 'Place on map'}</button>
          </div>`).join('')
      : '<div class="mono-row">No buildings yet — add one from Locations.</div>';
    unplacedEl.querySelectorAll('.btn-place').forEach((btn) => {
      btn.addEventListener('click', () => startPlacing(btn.dataset.id, btn.dataset.name));
    });

    // Keep whatever building was open (data may have just changed under it).
    if (selectedId != null && byId.has(selectedId)) renderDetails();

    // Handoff from the Locations screen's PLACE ON MAP / MOVE PIN button.
    const pending = sessionStorage.getItem('assettrack_place_building');
    if (pending) {
      sessionStorage.removeItem('assettrack_place_building');
      try {
        const { id, name } = JSON.parse(pending);
        if (buildings.some((b) => b.id === id)) startPlacing(id, name);
      } catch { /* malformed/stale flag — ignore */ }
    }
  }

  async function initMap() {
    await ensureLeafletLoaded();
    if (!mapEl.isConnected) return; // user navigated away while Leaflet was still loading

    mapEl.textContent = '';
    // Centered on NBSC's actual campus coordinates (Manolo Fortich, Bukidnon).
    map = window.L.map(mapEl).setView([8.359999, 124.868103], 17);

    window.L.tileLayer('/static/map_tiles/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; MapTiler &copy; OpenStreetMap contributors',
      errorTileUrl: '' // blank rather than a broken-image icon for any tile not yet cached
    }).addTo(map);

    // Buildings on a campus sit close together; a tighter radius keeps
    // neighbouring pins separate until you've really zoomed out.
    clusterGroup = window.L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false });
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
      if (result.ok) { selectedId = Number(buildingId); await loadData(); }
      else alert(result.error || 'Could not save that location.');
    });

    await loadData();

    // Leaflet measures its container once on init; nudge it in case web fonts
    // finished loading late and reflowed the rail's width afterwards.
    setTimeout(() => map && map.invalidateSize(), 200);
  }

  initMap().catch((err) => { mapEl.textContent = err.message; });

  // Registering/editing an asset (Asset Registry modal) dispatches this on
  // save — refresh so counts, rooms and people are current without leaving.
  const onAssetsChanged = () => { if (map) loadData(); };
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
