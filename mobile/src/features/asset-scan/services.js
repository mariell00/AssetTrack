// mobile/features/asset-scan/services.js — saves each QR scan to IndexedDB
// (offline-first: works with zero Wi-Fi, syncs later via the sync feature),
// plus live lookup/update of the scanned asset's details.
import { addPendingScan } from '../../core/indexed-db.js';
import { currentUser } from '../auth/services.js';
import { apiGet, apiPut } from '../../core/api-client.js';

// Reuses the same room-progress data the Admin Hub's Inventory Sync screen
// shows (GET /api/v1/inventory/progress) just for the {room_id, room_name}
// pairs — no separate "list rooms" endpoint needed.
async function fetchRooms() {
  return apiGet('/api/v1/inventory/progress');
}

// The scanned QR value is sent as BOTH asset_tag and nfc_uid: the backend's
// /api/v1/inventory/sync endpoint already looks a scan up by asset_tag
// first, then falls back to the nfc_tags table (see
// features/inventory/services.js on the desktop side). Sending both means
// this works whether a printed QR label encodes an asset's Asset Tag or an
// older UID that was already registered as an NFC tag — no desktop/server
// changes are needed to support QR.
async function recordScan(qrValue, roomId, status = 'verified') {
  const user = currentUser();
  await addPendingScan({
    asset_tag: qrValue,
    nfc_uid: qrValue,
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

// Saves edits made on the mobile "Asset Info" panel straight to the
// desktop host (same PUT /api/v1/assets/:id the Admin Hub's Asset Registry
// modal uses). Requires connectivity — edits aren't queued offline like
// scans are, to avoid silently overwriting newer changes made elsewhere.
async function updateAssetDetail(assetId, data) {
  return apiPut(`/api/v1/assets/${assetId}`, data);
}

export { recordScan, fetchAssetByTag, updateAssetDetail, fetchRooms };
