// features/mapping/ui-map.js — "Cluster Map": a real Leaflet map of campus, driven by NAMES.
//
// The left rail lists the people assets are assigned to (the Assignees list). Sort them A→Z,
// Z→A or by how many assets they hold, or type in the search box. Click a name — or search until
// one name is left — and that person's assigned assets pop out on the map: one pin per building
// where they have assets, the number on the pin being how many of theirs are in that building.
// Click a pin for the list; the panel below the map lists every asset by building and room, and
// says which ones cannot be shown (no room set yet, or the building has no pin).
//
// Nothing is drawn until a name is picked — the buildings themselves are no longer shown. The
// admin-only BUILDING PINS panel stays, because a building still needs its spot placed once
// (Place on map / Move pin, or the handoff from the Locations screen) for assets in it to appear.
//
// Leaflet is vendored locally (src/renderer/vendor/) and loaded via <link>/<script> tags in
// index.html's <head>, so the map keeps working with zero internet access, like tile-cache.js.
import { apiGet, apiPut } from '../../js/api-client.js';
import { esc } from '../assets/ui.js';

function ensureLeafletLoaded() {
  if (window.L) return Promise.resolve();
  return Promise.reject(new Error(
    'Leaflet did not load — check that index.html\'s <head> still has the vendor/leaflet <link>/<script> tags.'
  ));
}

const STATUS_LABELS = { active: 'Active', pending: 'Pending', maintenance: 'Maintenance', offline: 'Offline' };
const SORT_KEY = 'assettrack_map_people_sort';
const SORTS = {
  'name-asc':   { label: 'Name A → Z',    fn: (a, b) => a.name.localeCompare(b.name) },
  'name-desc':  { label: 'Name Z → A',    fn: (a, b) => b.name.localeCompare(a.name) },
  'assets-desc': { label: 'Most assets',  fn: (a, b) => b.asset_count - a.asset_count || a.name.localeCompare(b.name) },
  'assets-asc': { label: 'Fewest assets', fn: (a, b) => a.asset_count - b.asset_count || a.name.localeCompare(b.name) }
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const statusBadge = (status) => `<span class="badge badge-asset-${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const safePhoto = (p) => (typeof p === 'string' && /^data:image\//.test(p) ? p : null);
const personKey = (p) => String(p.name).trim().toLowerCase();

function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') : '—';
}

function avatarHtml(person, sizeClass = '') {
  const cls = `map-avatar${sizeClass ? ' ' + sizeClass : ''}`;
  const photo = person && safePhoto(person.photo);
  if (photo) return `<img src="${photo}" class="${cls} map-avatar-photo" alt="" />`;
  return `<div class="${cls}${person ? '' : ' map-avatar-empty'}" aria-hidden="true">${esc(initialsOf(person && person.name))}</div>`;
}

// Square count badge used as the pin — the number is how many of THIS person's assets are in
// that building. It pops in when a name is picked.
function pinIcon(count, selected) {
  return window.L.divIcon({
    className: 'bpin-wrap',
    html: `<div class="bpin bpin-pop${selected ? ' is-selected' : ''}"><span>${count}</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -22]
  });
}

function popupHtml(person, buildingName, assets) {
  const shown = assets.slice(0, 8);
  const more = assets.length - shown.length;
  return `
    <div class="map-tooltip map-bpop">
      <div class="map-tip-title">${esc(buildingName)}</div>
      <div class="map-tip-count">${esc(person.name)} · ${esc(plural(assets.length, 'asset'))} here</div>
      <div class="bpop-assets">
        ${shown.map((a) => `<div class="bd-asset"><strong>${esc(a.asset_tag)}</strong> — ${esc(a.name)}${a.room_name ? ` <span class="bd-dim">· ${esc(a.room_name)}</span>` : ''}</div>`).join('')}
        ${more > 0 ? `<div class="bd-dim">+${more} more — see the list below the map</div>` : ''}
      </div>
    </div>`;
}

// Placing/editing a building's pin is superadmin-only server-side — hide those controls for
// anyone else rather than showing buttons that will just come back "Forbidden."
function isAdmin() {
  const raw = localStorage.getItem('assettrack_user');
  return !!raw && JSON.parse(raw).role === 'superadmin';
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-map';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header"><span class="crt-dot"></span> Cluster map
        <div class="header-actions">
          <input type="search" id="people-search" class="retro-input map-header-search" placeholder="Search a name…" aria-label="Search people" autocomplete="off" />
        </div>
      </div>
      <div class="map-top-row">
        <div class="map-side-rail">
          <div class="map-profile-block" id="rail-person-block">
            <div class="map-avatar map-avatar-lg map-avatar-empty" id="rail-person-avatar" aria-hidden="true">?</div>
            <div class="map-profile-name" id="rail-person-name">No name selected</div>
            <div class="map-profile-caption" id="rail-person-caption">Assignee</div>
            <button type="button" class="btn-retro small outline" id="person-clear" hidden>Clear</button>
          </div>
          <div class="map-side-divider"></div>
          <div class="panel-title">People</div>
          <div class="people-tools">
            <select id="people-sort" class="retro-input sort-select" aria-label="Sort people"></select>
          </div>
          <div id="people-list" class="mono-list map-recent-list" role="listbox" aria-label="People">Loading…</div>
        </div>
        <div class="map-main">
          <div id="leaflet-map" class="leaflet-map-container">Loading map…</div>
        </div>
      </div>
      <p class="map-caption">Pick a name or search for one — their assigned assets appear on the map. The number on a pin is how many of their assets are in that building.</p>
    </div>
    <div class="map-lower">
      <div class="crt-panel map-selection">
        <div class="panel-title">Assigned assets</div>
        <div id="person-details">
          <div class="profile-details-empty">Pick a name on the left, or search for one, to see where their assets are.</div>
        </div>
      </div>
      <div class="crt-panel map-legend" id="unplaced-panel">
        <div class="panel-title">Building pins</div>
        <div id="unplaced-buildings" class="mono-list">Loading…</div>
        <p class="map-hint">An asset shows on the map once its room's building has a pin. Add or edit buildings and rooms from the Locations screen, or click Place on map / Move pin here, then click the map.</p>
      </div>
    </div>
  `;

  const mapEl = el.querySelector('#leaflet-map');
  const unplacedEl = el.querySelector('#unplaced-buildings');
  const listEl = el.querySelector('#people-list');
  const searchEl = el.querySelector('#people-search');
  const sortEl = el.querySelector('#people-sort');
  const detailsEl = el.querySelector('#person-details');
  const railName = el.querySelector('#rail-person-name');
  const railCaption = el.querySelector('#rail-person-caption');
  const clearBtn = el.querySelector('#person-clear');

  if (!isAdmin()) el.querySelector('#unplaced-panel').style.display = 'none';

  let map = null;
  let pinLayer = null;
  let placingBuildingId = null; // set while waiting for the next map click to land a pin
  let people = [];
  let buildings = [];
  let selectedKey = null;
  const markersByBuilding = new Map();

  let sortKey = localStorage.getItem(SORT_KEY);
  if (!SORTS[sortKey]) sortKey = 'name-asc';
  sortEl.innerHTML = Object.entries(SORTS).map(([k, s]) => `<option value="${k}"${k === sortKey ? ' selected' : ''}>${esc(s.label)}</option>`).join('');

  function startPlacing(id, name) {
    placingBuildingId = String(id);
    mapEl.style.cursor = 'crosshair';
    detailsEl.innerHTML = `<div class="profile-details-empty">Click the map to place "${esc(name)}"</div>`;
  }

  // ---- people list: sort + search ------------------------------------------

  // Every word typed must appear in the person's name, position or office — in any order, so
  // "acuesa mary" finds "Mary Koren W. Acuesa".
  function matches(p, query) {
    const words = plain(query).split(/[\s,.]+/).filter(Boolean);
    if (!words.length) return true;
    const hay = plain(`${p.name} ${p.position || ''} ${p.department || ''}`);
    return words.every((w) => hay.includes(w));
  }

  function visiblePeople() {
    return people.filter((p) => matches(p, searchEl.value)).sort(SORTS[sortKey].fn);
  }

  function drawList() {
    const rows = visiblePeople();
    if (!people.length) { listEl.innerHTML = '<div class="mono-row">No assignees yet — add some in Manage Assignees.</div>'; return rows; }
    if (!rows.length) { listEl.innerHTML = '<div class="mono-row">No one matches that search.</div>'; return rows; }
    listEl.innerHTML = rows.map((p) => `
      <div class="person-row${personKey(p) === selectedKey ? ' is-selected' : ''}${p.asset_count === 0 ? ' is-empty' : ''}" data-key="${esc(personKey(p))}" tabindex="0" role="option" aria-selected="${personKey(p) === selectedKey}">
        ${avatarHtml(p, 'map-avatar-md')}
        <span class="person-row-main">
          <strong>${esc(p.name)}</strong>
          <span class="recent-asset-user">${esc(plural(p.asset_count, 'asset'))}${p.position || p.department ? ` · ${esc([p.position, p.department].filter(Boolean).join(' · '))}` : ''}</span>
        </span>
      </div>`).join('');
    return rows;
  }

  // ---- showing one person's assets ----------------------------------------------

  // The big round avatar at the top of the rail: the person's photo or initials, a "?" when nobody is picked.
  function setRailAvatar(person) {
    const holder = document.createElement('div');
    holder.innerHTML = person ? avatarHtml(person, 'map-avatar-lg') : '<div class="map-avatar map-avatar-lg map-avatar-empty" aria-hidden="true">?</div>';
    const next = holder.firstElementChild;
    next.id = 'rail-person-avatar';
    el.querySelector('#rail-person-avatar').replaceWith(next);
  }

  function clearSelection() {
    selectedKey = null;
    if (pinLayer) pinLayer.clearLayers();
    markersByBuilding.clear();
    setRailAvatar(null);
    railName.textContent = 'No name selected';
    railCaption.textContent = 'Assignee';
    clearBtn.hidden = true;
    detailsEl.innerHTML = '<div class="profile-details-empty">Pick a name on the left, or search for one, to see where their assets are.</div>';
    drawList();
  }

  function detailsHtml(p, pinned, unpinned, noRoom) {
    const groups = new Map(); // building -> room -> assets
    for (const a of p.assets) {
      const bKey = a.building_id == null ? 'none' : String(a.building_id);
      if (!groups.has(bKey)) groups.set(bKey, { id: a.building_id, name: a.building_name, pinned: a.latitude != null && a.longitude != null, rooms: new Map() });
      const g = groups.get(bKey);
      const rKey = a.room_id == null ? 'none' : String(a.room_id);
      if (!g.rooms.has(rKey)) g.rooms.set(rKey, { name: a.room_name, floor: a.floor, assets: [] });
      g.rooms.get(rKey).assets.push(a);
    }
    const ordered = [...groups.values()].sort((x, y) => (x.id == null) - (y.id == null) || String(x.name).localeCompare(String(y.name)));
    const note = [];
    if (pinned === 0 && p.asset_count > 0) note.push('None of these assets can be shown on the map yet.');
    if (noRoom > 0) note.push(`${plural(noRoom, 'asset')} ${noRoom === 1 ? 'has' : 'have'} no room set — give ${noRoom === 1 ? 'it' : 'them'} a room in the Asset Registry.`);
    if (unpinned > 0) note.push(`${plural(unpinned, 'asset')} ${unpinned === 1 ? 'is' : 'are'} in a building that has no pin yet.`);

    return `
      <div class="bd-head bd-head-person">
        ${avatarHtml(p, 'map-avatar-md')}
        <div>
          <div class="bd-name">${esc(p.name)}</div>
          <div class="bd-summary">${esc([p.position, p.department].filter(Boolean).join(' · ')) || 'Assignee'} · ${esc(plural(p.asset_count, 'asset'))} · ${esc(plural(pinned, 'asset'))} on the map</div>
        </div>
      </div>
      ${note.length ? `<p class="map-hint">${note.map(esc).join(' ')}</p>` : ''}
      <div class="bd-list">
        ${p.asset_count === 0 ? '<div class="profile-details-empty">No assets are assigned to this person.</div>' : ordered.map((g) => {
          const count = [...g.rooms.values()].reduce((n, r) => n + r.assets.length, 0);
          const title = g.id == null ? 'No room set' : g.name;
          const sub = g.id == null ? '' : (g.pinned ? '' : ' <span class="bd-dim">· not pinned on the map</span>');
          return `
            <details class="bd-item" open>
              <summary>
                <span class="bd-title">${esc(title)}${sub}</span>
                <span class="bd-meta">${esc(plural(count, 'asset'))}</span>
              </summary>
              <div class="bd-body">
                ${[...g.rooms.values()].map((r) => `
                  ${g.id != null ? `<div class="bd-room">${esc(r.name || 'No room')}${r.floor ? ` <span class="bd-dim">· ${esc(r.floor)}</span>` : ''}</div>` : ''}
                  ${r.assets.map((a) => `
                    <div class="bd-asset${g.pinned ? ' is-locatable' : ''}" ${g.pinned ? `data-building="${g.id}" tabindex="0" role="button"` : ''}>
                      <strong>${esc(a.asset_tag)}</strong> — ${esc(a.name)}${a.quantity > 1 ? ` <span class="bd-dim">× ${esc(a.quantity)}</span>` : ''} ${statusBadge(a.status)}
                    </div>`).join('')}`).join('')}
              </div>
            </details>`;
        }).join('')}
      </div>`;
  }

  function selectPerson(key, { fit = true } = {}) {
    const p = people.find((x) => personKey(x) === key);
    if (!p) return;
    selectedKey = key;

    // rail profile
    setRailAvatar(p);
    railName.textContent = p.name;
    railCaption.textContent = [p.position, p.department].filter(Boolean).join(' · ') || plural(p.asset_count, 'asset');
    clearBtn.hidden = false;
    drawList();

    // pins: one per building where this person has assets (and the building has a pin)
    pinLayer.clearLayers();
    markersByBuilding.clear();
    const byBuilding = new Map();
    let noRoom = 0;
    let unpinned = 0;
    for (const a of p.assets) {
      if (a.building_id == null) { noRoom += 1; continue; }
      if (a.latitude == null || a.longitude == null) { unpinned += 1; continue; }
      if (!byBuilding.has(a.building_id)) byBuilding.set(a.building_id, { name: a.building_name, lat: a.latitude, lng: a.longitude, assets: [] });
      byBuilding.get(a.building_id).assets.push(a);
    }
    for (const [bid, b] of byBuilding) {
      const marker = window.L.marker([b.lat, b.lng], { icon: pinIcon(b.assets.length, false), title: `${b.name}: ${plural(b.assets.length, 'asset')}`, alt: b.name });
      marker.bindPopup(popupHtml(p, b.name, b.assets), { maxWidth: 280 });
      pinLayer.addLayer(marker);
      markersByBuilding.set(bid, marker);
    }

    const pinned = p.assets.length - noRoom - unpinned;
    detailsEl.innerHTML = detailsHtml(p, pinned, unpinned, noRoom);

    if (fit && byBuilding.size && map) {
      const bounds = pinLayer.getBounds();
      if (byBuilding.size === 1) map.flyTo(bounds.getCenter(), 18, { duration: 0.6 });
      else map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 18, duration: 0.6 });
    }
  }

  // ---- data ----------------------------------------------------------------

  function drawPlacement() {
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
  }

  async function loadData() {
    const [peopleRes, buildingsRes] = await Promise.all([
      apiGet('/api/v1/map/people-map'),
      apiGet('/api/v1/map/buildings')
    ]);
    if (!peopleRes.ok) {
      const msg = esc(peopleRes.error || 'Unable to load people.');
      listEl.innerHTML = msg; unplacedEl.innerHTML = msg;
      return;
    }
    people = peopleRes.people;
    buildings = buildingsRes.ok ? buildingsRes.buildings : [];
    drawPlacement();
    drawList();
    // Keep whoever was open (data may have just changed under them).
    if (selectedKey && people.some((p) => personKey(p) === selectedKey)) selectPerson(selectedKey, { fit: false });
    else if (selectedKey) clearSelection();

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

    pinLayer = window.L.featureGroup().addTo(map);

    map.on('click', async (e) => {
      if (!placingBuildingId) return;
      const buildingId = placingBuildingId;
      placingBuildingId = null;
      mapEl.style.cursor = '';
      const result = await apiPut(`/api/v1/map/buildings/${buildingId}/location`, {
        latitude: e.latlng.lat,
        longitude: e.latlng.lng
      });
      if (result.ok) await loadData();
      else alert(result.error || 'Could not save that location.');
      if (selectedKey) selectPerson(selectedKey, { fit: false });
    });

    await loadData();
    setTimeout(() => map && map.invalidateSize(), 200);
  }

  // ---- events ----------------------------------------------------------------

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.person-row');
    if (row) selectPerson(row.dataset.key);
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.person-row');
    if (!row) return;
    e.preventDefault();
    selectPerson(row.dataset.key);
  });

  sortEl.addEventListener('change', () => {
    sortKey = sortEl.value;
    localStorage.setItem(SORT_KEY, sortKey);
    drawList();
  });

  // Searching narrows the list; when exactly one name is left it is opened straight away.
  let searchTimer;
  searchEl.addEventListener('input', () => {
    drawList();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const rows = visiblePeople();
      if (searchEl.value.trim() && rows.length === 1 && personKey(rows[0]) !== selectedKey) selectPerson(personKey(rows[0]));
    }, 300);
  });
  searchEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const rows = visiblePeople();
    if (rows.length) selectPerson(personKey(rows[0])); // Enter opens the first match
  });

  clearBtn.addEventListener('click', clearSelection);

  // Click an asset in the list below to fly to its building's pin and open it.
  const locate = (target) => {
    const row = target.closest('.bd-asset[data-building]');
    if (!row || !map) return;
    const marker = markersByBuilding.get(Number(row.dataset.building));
    if (!marker) return;
    map.flyTo(marker.getLatLng(), 19, { duration: 0.5 });
    map.once('moveend', () => marker.openPopup());
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  detailsEl.addEventListener('click', (e) => locate(e.target));
  detailsEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); locate(e.target); } });

  initMap().catch((err) => { mapEl.textContent = err.message; });

  // Registering/editing an asset (Asset Registry modal) dispatches this on save — refresh so
  // names, counts and pins are current without leaving the screen.
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
