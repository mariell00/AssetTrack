// mobile/features/sync/services.js — collects everything waiting on the phone
// (scans, and the counts and edits made at scan time) from IndexedDB and POSTs it to
// the Desktop's /api/v1/inventory/sync endpoint as ONE sync request. The desktop holds
// it for the super admin to verify. Then files a per-room summary via /sync-session so
// the desktop's Sync screen (Check-in log) reflects what just happened, instead of only
// the raw per-scan log.
//
// Safe to repeat: items leave the phone's outbox only after the desktop confirms it
// has them. If a request gets through but the reply is lost, the items are still here
// and go out again — a scan sent twice before it is verified is folded into one.
import { getAllPendingScans, removePendingItems } from '../../core/indexed-db.js';
import { apiPost } from '../../core/api-client.js';
import { currentUser } from '../auth/services.js';

// What the outbox holds that can still be sent. (A new-asset registration saved by an older
// version of the app can't be: phones no longer register assets.)
const sendable = (items) => items.filter((i) => i.type !== 'registration');

async function pendingCount() {
  try { return sendable(await getAllPendingScans()).length; } catch { return 0; }
}

async function syncNow() {
  let pending = await getAllPendingScans();

  // An older version of the app may still have registrations saved. They can't be sent — assets
  // are registered on the desktop — so clear them out and say so, rather than leave them stuck.
  const legacy = pending.filter((i) => i.type === 'registration');
  if (legacy.length) {
    await removePendingItems(legacy.map((i) => i.localId));
    pending = sendable(pending);
  }
  const note = legacy.length ? { discarded_registrations: legacy.length } : {};

  if (pending.length === 0) {
    return { ok: true, recorded: 0, skipped_count: 0, skipped: [], message: 'Nothing to sync.', ...note };
  }

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
      if ((scan.type || 'scan') !== 'scan') continue; // edit-only items aren't room scans
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
    // Only now — the desktop has confirmed — do these leave the phone, and only these.
    await removePendingItems(pending.map((p) => p.localId));
  }
  return { ...result, ...note };
}

export { syncNow, pendingCount };
