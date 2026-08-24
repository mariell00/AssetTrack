// mobile/features/sync/services.js — collects pending logs from IndexedDB
// and POSTs them to the Desktop's /api/v1/inventory/sync endpoint.
import { getAllPendingScans, clearPendingScans } from '../../core/indexed-db.js';
import { apiPost } from '../../core/api-client.js';
import { currentUser } from '../auth/services.js';

async function syncNow() {
  const pending = await getAllPendingScans();
  if (pending.length === 0) return { ok: true, recorded: 0, message: 'Nothing to sync.' };

  const user = currentUser();
  const result = await apiPost('/api/v1/inventory/sync', {
    scans: pending.map(({ localId, queued_at, ...rest }) => rest),
    scanned_by: user ? user.username : 'unknown'
  });

  if (result.ok) await clearPendingScans();
  return result;
}

export { syncNow };
