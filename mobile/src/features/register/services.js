// mobile/features/register/services.js — registers a brand-new asset
// straight from the field and fetches its QR label. Unlike a Scan
// (which just queues in IndexedDB for later sync), registering a new
// asset needs the desktop's database to assign it a real ID and hand
// back a QR image — so this always requires a live connection to the
// Desktop host. There's no offline queue for this one.
import { apiPost, apiGet } from '../../core/api-client.js';

// The managed room list (mapping/ui-locations.js on the desktop), grouped
// by building — same source the Asset Info edit panel uses
// (asset-scan/services.js). A room only ever lands on the Cluster Map if
// it belongs to a placed building, so picking from this list (rather than
// free-typing a room name that resolveRoomId() would create as an
// unassigned room with no building) is what makes a freshly registered
// asset actually show up on the map.
async function fetchRoomsList() {
  return apiGet('/api/v1/map/rooms/list');
}

async function registerAsset({ assetTag, name, category, roomId, assignedTo, status, photo }) {
  const result = await apiPost('/api/v1/assets', {
    asset_tag: assetTag,
    name,
    category: category || null,
    room_id: roomId ? Number(roomId) : null,
    assigned_to: assignedTo || null,
    status: status || 'active',
    photo: photo || null
  });
  if (!result.ok) return result;

  const qr = await apiGet(`/api/v1/assets/${result.asset.id}/qr`);
  return { ok: true, asset: result.asset, qr: qr.ok ? qr : null };
}

export { registerAsset, fetchRoomsList };
