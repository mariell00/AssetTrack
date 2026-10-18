// features/mapping/ui-locations.js — "Locations": admin screen for
// managing Buildings and the Rooms inside each one. This is the missing
// piece that used to make Rooms only ever get created as a side-effect of
// typing a room name into an Asset's form — now there's an actual place
// to define the list up front (e.g. "Room 201", "Room 202"), which is
// what lets the Asset Registry and the mobile Scan screen offer a ROOM
// dropdown instead of free text.
//
// Placing a building's pin on the map is still done from the CLUSTER MAP
// screen's "PLACE ON MAP" flow (clicking the actual map) — not duplicated
// here — so this screen just shows whether a building has been placed yet.
import { apiGet, apiPost, apiPut, apiDelete } from '../../js/api-client.js';

function openBuildingModal(root, { building } = {}, onSaved) {
  const isEdit = !!building;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box crt-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> ${isEdit ? 'RENAME BUILDING' : 'ADD BUILDING'}
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <form id="building-form" class="retro-form modal-form">
        <label>BUILDING NAME
          <input type="text" id="f-building-name" class="retro-input" value="${building ? escapeAttr(building.name) : ''}" placeholder="e.g. Main Building" required />
        </label>
        <label>LATITUDE <span class="mono-dim">(optional — or place it later from CLUSTER MAP)</span>
          <input type="text" inputmode="decimal" id="f-building-lat" class="retro-input" value="${building && building.latitude != null ? building.latitude : ''}" placeholder="e.g. 8.359999" />
        </label>
        <label>LONGITUDE <span class="mono-dim">(optional)</span>
          <input type="text" inputmode="decimal" id="f-building-lng" class="retro-input" value="${building && building.longitude != null ? building.longitude : ''}" placeholder="e.g. 124.868103" />
        </label>
        <button type="submit" class="btn-retro">${isEdit ? '▶ SAVE CHANGES' : '▶ ADD BUILDING'}</button>
        <p id="modal-error" class="form-error"></p>
      </form>
    </div>
  `;
  root.appendChild(overlay);
  overlay.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#building-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = overlay.querySelector('#modal-error');
    const name = overlay.querySelector('#f-building-name').value.trim();
    const latRaw = overlay.querySelector('#f-building-lat').value.trim();
    const lngRaw = overlay.querySelector('#f-building-lng').value.trim();

    // Both blank is fine (place it later from the map); both filled is
    // fine; one without the other isn't a usable coordinate pair.
    if ((latRaw && !lngRaw) || (!latRaw && lngRaw)) {
      errorEl.textContent = 'Enter both latitude and longitude, or leave both blank.';
      return;
    }
    const payload = { name };
    if (latRaw && lngRaw) {
      const latitude = Number(latRaw);
      const longitude = Number(lngRaw);
      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        errorEl.textContent = 'Latitude/longitude must be numbers.';
        return;
      }
      payload.latitude = latitude;
      payload.longitude = longitude;
    }

    const result = isEdit
      ? await apiPut(`/api/v1/map/buildings/${building.id}`, payload)
      : await apiPost('/api/v1/map/buildings', payload);
    if (!result.ok) {
      errorEl.textContent = result.error || 'Save failed.';
      return;
    }
    overlay.remove();
    onSaved();
  });
}

// Hands off to the Cluster Map screen and drops it straight into
// "click the map to place this building" mode — an alternative to typing
// exact coordinates above, for admins who'd rather just click the spot.
function goPlaceOnMap(building) {
  sessionStorage.setItem('assettrack_place_building', JSON.stringify({ id: building.id, name: building.name }));
  window.location.hash = '#/map';
}

function openRoomModal(root, { room, buildings, defaultBuildingId } = {}, onSaved) {
  const isEdit = !!room;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box crt-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> ${isEdit ? 'EDIT ROOM' : 'ADD ROOM'}
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <form id="room-form" class="retro-form modal-form">
        <label>ROOM NAME
          <input type="text" id="f-room-name" class="retro-input" value="${room ? escapeAttr(room.name) : ''}" placeholder="e.g. Room 201" required />
        </label>
        <label>BUILDING
          <select id="f-room-building" class="retro-input" required>
            ${buildings.map((b) => `<option value="${b.id}" ${(room ? room.building_id : defaultBuildingId) === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
          </select>
        </label>
        <label>FLOOR <span class="mono-dim">(optional)</span>
          <input type="text" id="f-room-floor" class="retro-input" value="${room && room.floor ? escapeAttr(room.floor) : ''}" placeholder="e.g. 2nd Floor" />
        </label>
        <button type="submit" class="btn-retro">${isEdit ? '▶ SAVE CHANGES' : '▶ ADD ROOM'}</button>
        <p id="modal-error" class="form-error"></p>
      </form>
    </div>
  `;
  root.appendChild(overlay);
  overlay.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: overlay.querySelector('#f-room-name').value.trim(),
      building_id: Number(overlay.querySelector('#f-room-building').value),
      floor: overlay.querySelector('#f-room-floor').value.trim() || null
    };
    const result = isEdit
      ? await apiPut(`/api/v1/map/rooms/${room.id}`, payload)
      : await apiPost('/api/v1/map/rooms', payload);
    if (!result.ok) {
      overlay.querySelector('#modal-error').textContent = result.error || 'Save failed.';
      return;
    }
    overlay.remove();
    onSaved();
  });
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-locations';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> LOCATIONS // BUILDINGS &amp; ROOMS
        <div class="header-actions">
          <button id="btn-add-building" class="btn-retro small">+ ADD BUILDING</button>
        </div>
      </div>
      <p class="map-hint">Give a building coordinates directly here, or use "PLACE ON MAP" / "MOVE PIN" to click the exact spot on the CLUSTER MAP — every room added below rides along with the building's pin.</p>
      <div id="buildings-list" class="locations-list">Loading…</div>
    </div>
  `;

  const listEl = el.querySelector('#buildings-list');

  function buildingBlockHtml(building, rooms) {
    const placedLabel = building.latitude != null
      ? `PINNED @ ${building.latitude.toFixed(5)}, ${building.longitude.toFixed(5)}`
      : 'NOT ON MAP YET';
    const roomRows = rooms.length
      ? rooms.map((r) => `
          <tr data-room-id="${r.id}">
            <td>${r.name}</td>
            <td>${r.floor || '—'}</td>
            <td>${r.asset_count}</td>
            <td class="row-actions">
              <button class="btn-retro small outline btn-edit-room" data-id="${r.id}">EDIT</button>
              <button class="btn-retro small danger btn-del-room" data-id="${r.id}">DEL</button>
            </td>
          </tr>
        `).join('')
      : `<tr><td colspan="4">No rooms yet.</td></tr>`;

    return `
      <div class="crt-panel location-building" data-building-id="${building.id}">
        <div class="crt-header small">
          <span>${building.name} <span class="mono-dim">(${placedLabel})</span></span>
          <div class="header-actions">
            <button class="btn-retro small outline btn-place-building" data-id="${building.id}" data-name="${escapeAttr(building.name)}">${building.latitude != null ? '⌖ MOVE PIN' : '⌖ PLACE ON MAP'}</button>
            <button class="btn-retro small btn-add-room" data-id="${building.id}" data-name="${escapeAttr(building.name)}">+ ROOM</button>
            <button class="btn-retro small outline btn-edit-building" data-id="${building.id}">RENAME</button>
            <button class="btn-retro small danger btn-del-building" data-id="${building.id}">DEL</button>
          </div>
        </div>
        <table class="retro-table">
          <thead><tr><th>ROOM</th><th>FLOOR</th><th>ASSETS</th><th>ACTIONS</th></tr></thead>
          <tbody>${roomRows}</tbody>
        </table>
      </div>
    `;
  }

  function unassignedBlockHtml(rooms) {
    if (rooms.length === 0) return '';
    const roomRows = rooms.map((r) => `
      <tr data-room-id="${r.id}">
        <td>${r.name}</td>
        <td>${r.floor || '—'}</td>
        <td>${r.asset_count}</td>
        <td class="row-actions">
          <button class="btn-retro small outline btn-edit-room" data-id="${r.id}">ASSIGN / EDIT</button>
          <button class="btn-retro small danger btn-del-room" data-id="${r.id}">DEL</button>
        </td>
      </tr>
    `).join('');
    return `
      <div class="crt-panel location-building" data-building-id="">
        <div class="crt-header small">
          <span>UNASSIGNED ROOMS <span class="mono-dim">(no building set)</span></span>
        </div>
        <table class="retro-table">
          <thead><tr><th>ROOM</th><th>FLOOR</th><th>ASSETS</th><th>ACTIONS</th></tr></thead>
          <tbody>${roomRows}</tbody>
        </table>
      </div>
    `;
  }

  async function load() {
    const [buildingsResult, roomsResult] = await Promise.all([
      apiGet('/api/v1/map/buildings'),
      apiGet('/api/v1/map/rooms/list')
    ]);
    if (!buildingsResult.ok || !roomsResult.ok) {
      listEl.innerHTML = `<p class="form-error">${buildingsResult.error || roomsResult.error || 'Unable to load locations.'}</p>`;
      return;
    }

    const buildings = buildingsResult.buildings;
    const rooms = roomsResult.rooms;
    const roomsByBuilding = new Map();
    const unassigned = [];
    for (const r of rooms) {
      if (r.building_id) {
        if (!roomsByBuilding.has(r.building_id)) roomsByBuilding.set(r.building_id, []);
        roomsByBuilding.get(r.building_id).push(r);
      } else {
        unassigned.push(r);
      }
    }

    listEl.innerHTML = (
      buildings.length
        ? buildings.map((b) => buildingBlockHtml(b, roomsByBuilding.get(b.id) || [])).join('')
        : '<p class="empty-hint">No buildings yet — add one to get started.</p>'
    ) + unassignedBlockHtml(unassigned);

    listEl.querySelectorAll('.btn-place-building').forEach((btn) => {
      btn.addEventListener('click', () => {
        goPlaceOnMap({ id: Number(btn.dataset.id), name: btn.dataset.name });
      });
    });
    listEl.querySelectorAll('.btn-add-room').forEach((btn) => {
      btn.addEventListener('click', () => {
        openRoomModal(el, { buildings, defaultBuildingId: Number(btn.dataset.id) }, load);
      });
    });
    listEl.querySelectorAll('.btn-edit-building').forEach((btn) => {
      btn.addEventListener('click', () => {
        const building = buildings.find((b) => String(b.id) === btn.dataset.id);
        openBuildingModal(el, { building }, load);
      });
    });
    listEl.querySelectorAll('.btn-del-building').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this building? Its rooms must be moved or deleted first.')) return;
        const result = await apiDelete(`/api/v1/map/buildings/${btn.dataset.id}`);
        if (!result.ok) { alert(result.error || 'Could not delete building.'); return; }
        load();
      });
    });
    listEl.querySelectorAll('.btn-edit-room').forEach((btn) => {
      btn.addEventListener('click', () => {
        const room = rooms.find((r) => String(r.id) === btn.dataset.id);
        openRoomModal(el, { room, buildings }, load);
      });
    });
    listEl.querySelectorAll('.btn-del-room').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this room? Any assets logged there fall back to Unassigned.')) return;
        const result = await apiDelete(`/api/v1/map/rooms/${btn.dataset.id}`);
        if (!result.ok) { alert(result.error || 'Could not delete room.'); return; }
        load();
      });
    });
  }

  el.querySelector('#btn-add-building').addEventListener('click', () => openBuildingModal(el, {}, load));

  load();
  return el;
}
