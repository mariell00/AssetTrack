// mobile/features/sync/services.js — collects everything waiting on the phone
// (scans, edits made at scan time, and new-asset registrations) from IndexedDB
// and POSTs it to the Desktop's /api/v1/inventory/sync endpoint as ONE sync
// request. The desktop holds it for the super admin to verify. Then
// files a per-room summary via /sync-session so the desktop's Inventory
// Sync screen (room progress cards + Mobile Check-in Log) actually reflects
// what just happened, instead of only the raw per-scan log.
//
// Safe to repeat: items leave the phone's outbox only after the desktop confirms it
// has them. If a request gets through but the reply is lost, the items are still
// here and go out again — and each registration carries its own id (client_uuid), so
// the desktop recognises it and does not add it twice.
import {
  getAllPendingScans, removePendingItems, updatePendingItem, getRegistrationRecords, updateRegistrationRecord,
  saveRegistrationRecord, trimRegistrationRecords
} from '../../core/indexed-db.js';
import { newUuid } from '../../core/uuid.js';
import { apiPost } from '../../core/api-client.js';
import { currentUser } from '../auth/services.js';

async function pendingCount() {
  try { return (await getAllPendingScans()).length; } catch { return 0; }
}

// This phone's registrations and where each stands (see my_registrations in indexed-db.js).
async function getRegistrations() {
  try { return await getRegistrationRecords(); } catch { return []; }
}

// Asks the desktop what became of the registrations that were sent but not yet
// verified, and keeps the answer: a verified one learns its Asset ID (AST-0007).
// Best-effort — with no connection it simply leaves things as they were.
async function refreshRegistrations() {
  const open = (await getRegistrations()).filter((r) => r.state === 'pending');
  if (open.length === 0) return { ok: true, changed: 0 };
  const result = await apiPost('/api/v1/inventory/registrations/status', { uuids: open.map((r) => r.client_uuid) });
  if (!result.ok || !Array.isArray(result.registrations)) return { ok: false, changed: 0 };

  let changed = 0;
  for (const r of result.registrations) {
    const mine = open.find((o) => o.client_uuid === r.client_uuid);
    if (!mine || mine.state === r.status) continue;
    await updateRegistrationRecord(r.client_uuid, { state: r.status, asset_tag: r.asset_tag || null });
    changed++;
  }
  await trimRegistrationRecords().catch(() => {});
  return { ok: true, changed };
}

async function syncNow() {
  const pending = await getAllPendingScans();
  if (pending.length === 0) {
    await refreshRegistrations();
    return { ok: true, recorded: 0, skipped_count: 0, skipped: [], message: 'Nothing to sync.' };
  }

  // A registration queued by an older version of the app has no id yet. Give it one now and
  // keep it, so that if this attempt's reply is lost the retry is recognised too.
  for (const item of pending) {
    if (item.type !== 'registration' || item.client_uuid) continue;
    item.client_uuid = newUuid();
    await updatePendingItem(item.localId, { client_uuid: item.client_uuid });
    await saveRegistrationRecord({
      client_uuid: item.client_uuid, name: (item.payload && item.payload.name) || 'New asset',
      state: 'queued', asset_tag: null, created_at: item.queued_at || new Date().toISOString()
    }).catch(() => {});
  }

  const user = currentUser();
  const result = await apiPost('/api/v1/inventory/sync', {
    scans: pending.map(({ localId, queued_at, ...rest }) => rest),
    scanned_by: user ? user.username : 'unknown'
  });

  if (result.ok) {
    // What the desktop says about each registration it was sent (new, or already had).
    const outcomes = new Map((result.registration_results || []).map((o) => [o.client_uuid, o]));
    const skippedUuids = new Set((result.skipped || []).filter((s) => s.type === 'registration').map((s) => s.client_uuid));
    for (const item of pending) {
      if (item.type !== 'registration' || !item.client_uuid) continue;
      const o = outcomes.get(item.client_uuid);
      const state = o ? o.status : (skippedUuids.has(item.client_uuid) ? 'failed' : 'pending');
      await updateRegistrationRecord(item.client_uuid, { state, asset_tag: (o && o.asset_tag) || null }).catch(() => {});
    }

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
      if ((scan.type || 'scan') !== 'scan') continue; // registrations and edit-only items aren't room scans
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
    await refreshRegistrations();
  }
  return result;
}

export { syncNow, pendingCount, getRegistrations, refreshRegistrations };
