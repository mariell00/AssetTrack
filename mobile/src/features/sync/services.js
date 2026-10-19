// mobile/features/sync/services.js — collects pending logs from IndexedDB
// and POSTs them to the Desktop's /api/v1/inventory/sync endpoint, then
// files a per-room summary via /sync-session so the desktop's Inventory
// Sync screen (room progress cards + Mobile Check-in Log) actually reflects
// what just happened, instead of only the raw per-scan log.
import { getAllPendingScans, clearPendingScans } from '../../core/indexed-db.js';
import { apiPost } from '../../core/api-client.js';
import { currentUser } from '../auth/services.js';

async function pendingCount() {
  try { return (await getAllPendingScans()).length; } catch { return 0; }
}

async function syncNow() {
  const pending = await getAllPendingScans();
  if (pending.length === 0) return { ok: true, recorded: 0, skipped_count: 0, skipped: [], message: 'Nothing to sync.' };

  const user = currentUser();
  const result = await apiPost('/api/v1/inventory/sync', {
    scans: pending.map(({ localId, queued_at, ...rest }) => rest),
    scanned_by: user ? user.username : 'unknown'
  });

  if (result.ok) {
    // The desktop skips scans whose tag isn't registered. Leave those out of
    // the per-room totals so the Check-in Log doesn't count scans that were
    // never recorded.
    const skippedTags = new Set((result.skipped || []).map((s) => s.asset_tag));
    // A single sync batch can span more than one room if the admin
    // switched rooms mid-session (or scanned a few before ever picking
    // one, leaving room_id null/"Unassigned") — file one session summary
    // per room actually represented, so each shows up correctly labeled
    // rather than merged into one misleading entry.
    const byRoom = new Map();
    for (const scan of pending) {
      if (skippedTags.has(scan.asset_tag)) continue;
      const key = scan.room_id || '';
      byRoom.set(key, (byRoom.get(key) || 0) + 1);
    }
    for (const [roomId, count] of byRoom) {
      await apiPost('/api/v1/inventory/sync-session', {
        room_id: roomId || null,
        total_scanned: count,
        missing_count: 0
      });
    }
    await clearPendingScans();
  }
  return result;
}

export { syncNow, pendingCount };
