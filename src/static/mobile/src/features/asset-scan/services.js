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
// What is entered on the "Asset Info" panel is NOT sent to the desktop straight away.
// It is saved on the phone and goes out with the next SYNC as a proposed update;
// the super admin verifies it on the Sync screen before it changes the asset.
//   changes     — the fields that differ from the record (location, condition, status,
//                 quantity, user); may be empty if only a count was entered
//   scanLocalId — the scan these belong to (so they travel together)
//   counted     — how many were counted at this scan (a number, or null for none); it
//                 describes the scan, so it only ever rides on one
async function queueAssetChanges(assetTag, changes, { scanLocalId = null, counted = null } = {}) {
  const hasChanges = !!changes && Object.keys(changes).length > 0;
  if (scanLocalId) {
    const patch = {};
    if (hasChanges) patch.changes = changes;
    if (counted !== null && counted !== undefined) patch.counted = counted;
    const ok = await updatePendingItem(scanLocalId, patch);
    if (ok) return;
  }
  if (!hasChanges) return; // a count with no scan to attach to means nothing
  const user = currentUser();
  await addPendingScan({ type: 'edit', asset_tag: assetTag, scanned_by: user ? user.username : 'unknown', changes });
}

export { recordScan, fetchAssetByTag, queueAssetChanges, fetchRoomsList };
