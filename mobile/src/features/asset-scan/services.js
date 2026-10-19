// mobile/features/asset-scan/services.js — saves each QR scan to IndexedDB
// (offline-first: works with zero Wi-Fi, syncs later via the sync feature),
// plus live lookup/update of the scanned asset's details.
import { addPendingScan } from '../../core/indexed-db.js';
import { currentUser } from '../auth/services.js';
import { apiGet, apiPut } from '../../core/api-client.js';
import { fetchRoomsList } from '../../core/lookups.js';

// The scanned QR value is the asset's Asset Tag; the backend's
// /api/v1/inventory/sync endpoint matches scans by asset_tag.
async function recordScan(qrValue, roomId, status = 'verified') {
  const user = currentUser();
  await addPendingScan({
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

// Saves edits made on the mobile "Asset Info" panel straight to the
// desktop host (same PUT /api/v1/assets/:id the desktop Asset Registry
// modal uses). Requires connectivity — edits aren't queued offline like
// scans are, to avoid silently overwriting newer changes made elsewhere.
async function updateAssetDetail(assetId, data) {
  return apiPut(`/api/v1/assets/${assetId}`, data);
}

export { recordScan, fetchAssetByTag, fetchAssetDetail, updateAssetDetail, fetchRoomsList };
