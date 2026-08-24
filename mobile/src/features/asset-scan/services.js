// mobile/features/asset-scan/services.js — saves each NFC scan to IndexedDB
// (offline-first: works with zero Wi-Fi, syncs later via the sync feature).
import { addPendingScan } from '../../core/indexed-db.js';
import { currentUser } from '../auth/services.js';

async function recordScan(nfcUid, roomId, status = 'verified') {
  const user = currentUser();
  await addPendingScan({
    nfc_uid: nfcUid,
    room_id: roomId,
    scanned_by: user ? user.username : 'unknown',
    status
  });
}

export { recordScan };
