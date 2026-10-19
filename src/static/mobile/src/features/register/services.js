// mobile/features/register/services.js — registers a brand-new asset
// straight from the field and fetches its QR label. Unlike a Scan
// (which just queues in IndexedDB for later sync), registering a new
// asset needs the desktop's database to assign it a real ID and hand
// back a QR image — so this always requires a live connection to the
// Desktop host. There's no offline queue for this one.
import { apiPost, apiGet } from '../../core/api-client.js';
import { fetchRoomsList, fetchAssignees } from '../../core/lookups.js';

// `assetTag` is optional. Left blank, the desktop generates the next Asset ID
// (AST-0001, AST-0002, …) exactly as it does for assets registered there; typed
// in, it's used as-is (e.g. to match a label that's already printed).
async function registerAsset({ assetTag, name, category, roomId, assignedTo, status, photo }) {
  const result = await apiPost('/api/v1/assets', {
    asset_tag: assetTag || undefined,
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

export { registerAsset, fetchRoomsList, fetchAssignees };
