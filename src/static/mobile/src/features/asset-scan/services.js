// mobile/features/asset-scan/services.js — saves each QR scan to IndexedDB
// (offline-first: works with zero Wi-Fi, syncs later via the sync feature),
// plus live lookup/update of the scanned asset's details.
import { addPendingScan, updatePendingItem } from '../../core/indexed-db.js';
import { currentUser } from '../auth/services.js';
import { apiGet, apiPut } from '../../core/api-client.js';
import { fetchRoomsList } from '../../core/lookups.js';

// The scanned QR value is the asset's Asset Tag; the backend's
// /api/v1/inventory/sync endpoint matches scans by asset_tag.
// Resolves with the queued item's id, so edits made right after the scan can be attached to it.
async function recordScan(qrValue, roomId, status = 'verified') {
  const user = currentUser();
  return addPendingScan({
    type: 'scan',
    asset_tag: qrValue,
    room_id: roomId,
    scanned_by: user ? user.username : 'unknown',
    status
  });
}

// Looks up the full asset record for a scanned QR value so it can be shown
// (and edited) right after the scan. This is a live API call — unlike
// recordScan above, it needs a connection to the desktop host, so callers
// should handle `ok: false` / `offline: true` by just skipping the edit
// step rather than blocking the scan flow.
async function fetchAssetByTag(qrValue) {
  return apiGet(`/api/v1/assets/by-tag/${encodeURIComponent(qrValue)}`);
}

// Same detail record, by id — used when opening an asset from the Asset Registry list.
async function fetchAssetDetail(id) {
  return apiGet(`/api/v1/assets/${id}/detail`);
}

// Edits made on the "Asset Info" panel are NOT sent to the desktop straight away.
// They are saved on the phone and go out with the next SYNC as a proposed update;
// the super admin verifies it in Inventory sync before it changes the asset.
//   scanLocalId — the scan these edits belong to (so they travel together);
//                 without one (opened from the registry list) they go as an
//                 edit-only item.
async function queueAssetChanges(assetTag, changes, { scanLocalId = null } = {}) {
  if (scanLocalId) {
    const ok = await updatePendingItem(scanLocalId, { changes });
    if (ok) return;
  }
  const user = currentUser();
  await addPendingScan({ type: 'edit', asset_tag: assetTag, scanned_by: user ? user.username : 'unknown', changes });
}

export { recordScan, fetchAssetByTag, fetchAssetDetail, queueAssetChanges, fetchRoomsList };
