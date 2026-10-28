// features/inventory/services.js — compares scanned logs vs expected assets
// per room, and records new scan batches coming from the mobile app.
const crypto = require('crypto');
const { getDb } = require('../../core/database');

// A short "who + what device" label for the Mobile Check-in Log — source
// and device name come from the requester's verified JWT / User-Agent (see
// routes.js), not anything the client could fake by editing a request
// body.
function deviceLabel(username, source, ip, deviceName) {
  const who = username || 'unknown';
  const device = deviceName ? ` · ${deviceName}` : '';
  return ip ? `${who}${device} · ${ip}` : `${who}${device}`;
}

// ---- What a phone can send, and what happens to it ----------------------
//
// One SYNC from the mobile app is one "sync request": a list of items, each
//   { type: 'scan', asset_tag, room_id, status, changes? }
//        an existing asset was scanned (+ optional proposed edits to its details)
//   { type: 'edit', asset_tag, changes }
//        edits made from the registry list, without scanning
//   { type: 'registration', client_uuid, payload: { name, category, room_id, ... } }
//        a brand-new asset. `client_uuid` is an id the phone made up for this one
//        registration (internal — nobody sees or types it). If the phone never hears
//        the reply and sends it again, the same id tells us it's the same
//        registration, so it is never queued (or verified) twice.
// (an item with no `type` is a plain scan, which is what older phones send).
//
// None of it takes effect on arrival. Everything from a phone goes into the
// review queue (pending_scans / pending_registrations) and the super admin
// verifies it in the Inventory Sync screen: approving a registration adds the
// asset, approving a scan applies its edits and logs the scan as verified.
const SCAN_STATUSES = new Set(['verified', 'missing', 'misplaced']);

// Fields a phone is allowed to propose for an existing asset. The Asset ID is
// deliberately not one of them.
const EDITABLE_FIELDS = ['name', 'category', 'description', 'condition', 'status', 'room_id', 'assigned_to', 'value_php', 'acquired_date', 'photo'];
// A phone can't propose an Asset ID for a new asset: it is generated here, when the
// registration is verified (the QR label is made from it then).
const REGISTRATION_FIELDS = [...EDITABLE_FIELDS];

// What a phone's registration id looks like (a random UUID). Anything else is ignored.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cleanUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

// What we already know about a registration the phone calls `uuid`, or null if it
// is new. Looks at every state (pending, approved, rejected), not just the queue.
function registrationOutcome(db, uuid) {
  const row = db.prepare(`
    SELECT r.review_status, r.requested_by, a.asset_tag
    FROM pending_registrations r LEFT JOIN assets a ON a.id = r.created_asset_id
    WHERE r.client_uuid = ?
  `).get(uuid);
  if (row) {
    return { client_uuid: uuid, status: row.review_status, asset_tag: row.review_status === 'approved' ? row.asset_tag : null, owner: row.requested_by };
  }
  const asset = db.prepare('SELECT asset_tag FROM assets WHERE client_uuid = ?').get(uuid);
  return asset ? { client_uuid: uuid, status: 'approved', asset_tag: asset.asset_tag, owner: null } : null;
}

// The part of an outcome that goes back to the phone.
function publicOutcome({ client_uuid, status, asset_tag }) {
  return { client_uuid, status, asset_tag };
}

function pickFields(obj, allowed) {
  const out = {};
  for (const key of allowed) {
    if (!obj || obj[key] === undefined) continue;
    let v = obj[key];
    if (typeof v === 'string') v = v.trim();
    if (key === 'room_id') v = v === '' || v === null ? null : Number(v);
    if (key === 'value_php') v = v === '' || v === null ? null : Number(v);
    if (v === '') v = null;
    out[key] = v;
  }
  if ('name' in out && !out.name) delete out.name; // a name can't be blanked out
  return out;
}

function recordSyncBatch(items, meta = {}) {
  const db = getDb();
  const scannedBy = meta.scannedBy || 'unknown';
  const source = meta.source || null;
  const ip = meta.ip || null;
  const deviceName = meta.deviceName || null;
  const batchId = crypto.randomUUID();
  const dev = { device_source: source, device_ip: ip, device_name: deviceName };

  const findByTag = db.prepare('SELECT id FROM assets WHERE asset_tag = ?');
  const insertLog = db.prepare(`
    INSERT INTO inventory_logs (asset_id, room_id, scanned_by, status, device_source, device_ip, device_name)
    VALUES (@asset_id, @room_id, @scanned_by, @status, @device_source, @device_ip, @device_name)
  `);
  const insertPending = db.prepare(`
    INSERT INTO pending_scans (batch_id, asset_id, room_id, scanned_by, claimed_status, kind, changes_json, device_source, device_ip, device_name)
    VALUES (@batch_id, @asset_id, @room_id, @scanned_by, @status, @kind, @changes_json, @device_source, @device_ip, @device_name)
  `);
  const insertRegistration = db.prepare(`
    INSERT INTO pending_registrations (batch_id, requested_by, payload_json, device_source, device_ip, device_name, client_uuid)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  // The same asset sent twice before anyone reviews it shouldn't make two queue rows: fold the second in.
  const findQueued = db.prepare(`
    SELECT id, changes_json FROM pending_scans
    WHERE review_status = 'pending' AND asset_id = ? AND scanned_by = ? AND kind = ? AND COALESCE(room_id, 0) = COALESCE(?, 0)
  `);
  const updateQueued = db.prepare('UPDATE pending_scans SET changes_json = ? WHERE id = ?');

  const counts = { scans: 0, edits: 0, registrations: 0 };
  const skipped = [];
  let alreadyReceived = 0;       // registrations that had reached us before (a re-send)
  const registrationResults = []; // one answer per registration, so the phone learns each one's state
  const tx = db.transaction((records) => {
    for (const s of records) {
      const type = s.type || 'scan';

      if (type === 'registration') {
        const by = s.scanned_by || scannedBy;
        const uuid = cleanUuid(s.client_uuid);

        // Seen before? Then this is a re-send (the reply never reached the phone), not a
        // new asset: don't queue it again — just tell the phone where it stands.
        const known = uuid ? registrationOutcome(db, uuid) : null;
        if (known) {
          if (known.owner && known.owner !== by) { skipped.push({ ...s, reason: 'This registration id belongs to another account.' }); continue; }
          alreadyReceived++;
          registrationResults.push(publicOutcome(known));
          continue;
        }

        const payload = pickFields(s.payload || {}, REGISTRATION_FIELDS);
        if (!payload.name) { skipped.push({ ...s, reason: 'A new asset needs a name.' }); continue; }
        insertRegistration.run(batchId, by, JSON.stringify(payload), source, ip, deviceName, uuid);
        counts.registrations++;
        if (uuid) registrationResults.push({ client_uuid: uuid, status: 'pending', asset_tag: null });
        continue;
      }

      const asset = s.asset_tag ? findByTag.get(s.asset_tag) : null;
      if (!asset) { skipped.push(s); continue; }

      const changes = pickFields(s.changes || {}, EDITABLE_FIELDS);
      const hasChanges = Object.keys(changes).length > 0;
      const by = s.scanned_by || scannedBy;

      if (type === 'edit') {
        if (!hasChanges) continue;
        const existing = findQueued.get(asset.id, by, 'edit', null);
        if (existing) updateQueued.run(JSON.stringify({ ...JSON.parse(existing.changes_json || '{}'), ...changes }), existing.id);
        else insertPending.run({ batch_id: batchId, asset_id: asset.id, room_id: null, scanned_by: by, status: 'verified', kind: 'edit', changes_json: JSON.stringify(changes), ...dev });
        counts.edits++;
        continue;
      }

      // type === 'scan'
      const row = {
        asset_id: asset.id,
        room_id: s.room_id || null,
        scanned_by: by,
        status: SCAN_STATUSES.has(s.status) ? s.status : 'verified'
      };
      if (source === 'mobile') {
        const existing = findQueued.get(row.asset_id, row.scanned_by, 'scan', row.room_id);
        if (existing) {
          if (hasChanges) updateQueued.run(JSON.stringify({ ...JSON.parse(existing.changes_json || '{}'), ...changes }), existing.id);
        } else {
          insertPending.run({ batch_id: batchId, ...row, kind: 'scan', changes_json: hasChanges ? JSON.stringify(changes) : null, ...dev });
        }
      } else {
        insertLog.run({ ...row, ...dev }); // a desktop caller isn't reviewed
        if (hasChanges) require('../assets/services').updateAsset(asset.id, changes);
      }
      counts.scans++;
    }
  });
  tx(items);

  const recorded = counts.scans + counts.edits + counts.registrations;
  const queued = source === 'mobile' ? recorded : counts.registrations + counts.edits;
  const { logEvent } = require('../system/services');
  const who = deviceLabel(scannedBy, source, ip, deviceName);
  const parts = [];
  if (counts.registrations) parts.push(`${counts.registrations} registration(s)`);
  if (counts.scans) parts.push(`${counts.scans} scan(s)`);
  if (counts.edits) parts.push(`${counts.edits} edit(s)`);
  if (recorded > 0 || alreadyReceived === 0) {
    logEvent('SYNC',
      queued > 0 ? `${who} sent ${parts.join(', ')} for verification` : `${who} synced ${recorded} item(s)`,
      recorded > 0 ? (queued > 0 ? 'warn' : 'success') : 'warn');
  }
  if (alreadyReceived > 0) {
    logEvent('SYNC', `${who} re-sent ${alreadyReceived} registration(s) that had already arrived — not added twice`, 'success');
  }
  if (skipped.length > 0) {
    logEvent('ALERT', `${skipped.length} item(s) skipped — tag not registered or details missing`, 'alert');
  }

  return {
    ok: true, recorded, ...counts,
    already_received: alreadyReceived,
    registration_results: registrationResults,
    skipped_count: skipped.length, skipped,
    needs_review: queued > 0
  };
}

// A mobile client that still calls the live endpoints (POST /assets, PUT
// /assets/:id) is routed into the same review queue, so nothing from a phone
// can reach the registry without verification.
function queueMobileRegistration(body, meta = {}) {
  const payload = pickFields(body, REGISTRATION_FIELDS);
  if (!payload.name) return { ok: false, status: 400, error: 'name is required.' };
  const db = getDb();
  const by = meta.scannedBy || 'unknown';
  const uuid = cleanUuid(body.client_uuid);
  const known = uuid ? registrationOutcome(db, uuid) : null;
  if (known) {
    if (known.owner && known.owner !== by) return { ok: false, status: 409, error: 'This registration id belongs to another account.' };
    return { ok: true, pending: known.status === 'pending', duplicate: true, ...publicOutcome(known) };
  }
  db.prepare(`
    INSERT INTO pending_registrations (batch_id, requested_by, payload_json, device_source, device_ip, device_name, client_uuid)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), by, JSON.stringify(payload), meta.source || null, meta.ip || null, meta.deviceName || null, uuid);
  require('../system/services').logEvent('SYNC', `${deviceLabel(meta.scannedBy, meta.source, meta.ip, meta.deviceName)} sent 1 registration(s) for verification`, 'warn');
  return { ok: true, pending: true };
}

function queueMobileEdit(assetId, body, meta = {}) {
  const db = getDb();
  const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId);
  if (!asset) return { ok: false, status: 404, error: 'Asset not found.' };
  const changes = pickFields(body, EDITABLE_FIELDS);
  if (Object.keys(changes).length === 0) return { ok: true, pending: true };
  db.prepare(`
    INSERT INTO pending_scans (batch_id, asset_id, room_id, scanned_by, claimed_status, kind, changes_json, device_source, device_ip, device_name)
    VALUES (?, ?, NULL, ?, 'verified', 'edit', ?, ?, ?, ?)
  `).run(crypto.randomUUID(), asset.id, meta.scannedBy || 'unknown', JSON.stringify(changes), meta.source || null, meta.ip || null, meta.deviceName || null);
  require('../system/services').logEvent('SYNC', `${deviceLabel(meta.scannedBy, meta.source, meta.ip, meta.deviceName)} sent 1 edit(s) for verification`, 'warn');
  return { ok: true, pending: true };
}

// Live verification progress: for a given room, what fraction of assigned
// assets have been scanned as "verified" today.
function roomProgress(roomId) {
  const db = getDb();
  const expected = db.prepare('SELECT COUNT(*) AS c FROM assets WHERE room_id = ?').get(roomId).c;
  const verifiedToday = db.prepare(`
    SELECT COUNT(DISTINCT asset_id) AS c
    FROM inventory_logs
    WHERE room_id = ? AND status = 'verified' AND date(scanned_at) = date('now')
  `).get(roomId).c;
  const lastSync = db.prepare(`
    SELECT MAX(scanned_at) AS last_sync FROM inventory_logs WHERE room_id = ?
  `).get(roomId).last_sync;
  // Scanned on a phone and synced, but not yet verified by the super admin.
  const awaiting = db.prepare(`
    SELECT COUNT(DISTINCT asset_id) AS c FROM pending_scans WHERE room_id = ? AND review_status = 'pending'
  `).get(roomId).c;

  return {
    room_id: Number(roomId),
    expected,
    awaiting,
    verified: verifiedToday,
    pct: expected === 0 ? 0 : Math.round((verifiedToday / expected) * 100),
    last_sync: lastSync
  };
}

function allRoomsProgress() {
  const db = getDb();
  const rooms = db.prepare('SELECT id, name FROM rooms ORDER BY name').all();
  return rooms.map((r) => ({ room_name: r.name, ...roomProgress(r.id) }));
}

// "Mobile Check-in Log" — recent sync sessions with a verified device label
// (who + mobile/desktop + phone/PC model + IP — see deviceLabel above) and
// a COMPLETE/PARTIAL verdict against the room's expected count.
function syncLog(limit = 20) {
  const db = getDb();

  // The assets that were checked in under one log row, so selecting the row can
  // show what it actually covered (the pop-out on the Sync screen).
  const itemsBySession = db.prepare(`
    SELECT a.asset_tag, a.name, l.status, l.scanned_at
    FROM inventory_logs l JOIN assets a ON a.id = l.asset_id
    WHERE l.scanned_by = @user AND COALESCE(l.room_id, -1) = COALESCE(@room_id, -1)
      AND l.scanned_at BETWEEN datetime(@at, '-10 minutes') AND datetime(@at, '+10 minutes')
    ORDER BY l.id DESC LIMIT 200
  `);
  const itemsByGroup = db.prepare(`
    SELECT a.asset_tag, a.name, l.status, l.scanned_at
    FROM inventory_logs l
    JOIN assets a ON a.id = l.asset_id
    LEFT JOIN rooms r ON r.id = l.room_id
    WHERE substr(l.scanned_at, 1, 16) = @time AND l.scanned_by = @user
      AND COALESCE(l.device_source, '') = COALESCE(@source, '')
      AND COALESCE(l.device_ip, '') = COALESCE(@ip, '')
      AND COALESCE(l.device_name, '') = COALESCE(@device_name, '')
      AND COALESCE(r.name, 'Unassigned') = @room
    ORDER BY l.id DESC LIMIT 200
  `);

  const sessions = db.prepare(`
    SELECT s.*, r.name AS room_name,
      (SELECT COUNT(*) FROM assets WHERE room_id = s.room_id) AS expected
    FROM sync_sessions s
    LEFT JOIN rooms r ON r.id = s.room_id
    ORDER BY s.id DESC
    LIMIT ?
  `).all(limit);

  if (sessions.length > 0) {
    return sessions.map((s) => ({
      id: `s${s.id}`,
      time: s.created_at,
      device: deviceLabel(s.scanned_by, s.device_source, s.device_ip, s.device_name),
      user: s.scanned_by,
      room: s.room_name || 'Unassigned',
      count: s.total_scanned,
      expected: s.expected,
      missing: s.missing_count,
      notes: s.notes || null,
      status: s.expected > 0 && s.total_scanned >= s.expected ? 'complete' : 'partial',
      items: itemsBySession.all({ user: s.scanned_by, room_id: s.room_id, at: s.created_at })
    }));
  }

  // Fall back to raw scan batches grouped by minute if no formal sync
  // sessions have been submitted yet (e.g. only ad-hoc /sync calls so far).
  return db.prepare(`
    SELECT
      substr(l.scanned_at, 1, 16) AS time,
      l.scanned_by AS user,
      l.device_source AS source,
      l.device_ip AS ip,
      l.device_name AS device_name,
      COALESCE(r.name, 'Unassigned') AS room,
      COUNT(*) AS count
    FROM inventory_logs l
    LEFT JOIN rooms r ON r.id = l.room_id
    GROUP BY time, user, source, ip, device_name, room
    ORDER BY time DESC
    LIMIT ?
  `).all(limit).map((row, i) => ({
    id: `g${i}`,
    time: row.time,
    device: deviceLabel(row.user, row.source, row.ip, row.device_name),
    user: row.user,
    room: row.room,
    count: row.count,
    status: 'complete',
    items: itemsByGroup.all({ time: row.time, user: row.user, source: row.source, ip: row.ip, device_name: row.device_name, room: row.room })
  }));
}

function markScanned(assetId, meta = {}) {
  const db = getDb();
  const asset = db.prepare('SELECT room_id FROM assets WHERE id = ?').get(assetId);
  const roomId = asset ? asset.room_id : null;
  const by = meta.scannedBy || 'unknown';
  if (meta.source === 'mobile') {
    db.prepare(`
      INSERT INTO pending_scans (batch_id, asset_id, room_id, scanned_by, claimed_status, device_source, device_ip, device_name)
      VALUES (?, ?, ?, ?, 'verified', ?, ?, ?)
    `).run(crypto.randomUUID(), assetId, roomId, by, meta.source, meta.ip || null, meta.deviceName || null);
    return { ok: true, needs_review: true };
  }
  db.prepare(`
    INSERT INTO inventory_logs (asset_id, room_id, scanned_by, status, device_source, device_ip, device_name)
    VALUES (?, ?, ?, 'verified', ?, ?, ?)
  `).run(assetId, roomId, by, meta.source || null, meta.ip || null, meta.deviceName || null);
  return { ok: true };
}

// ---- Review queue (the Inventory Sync screen's "Awaiting verification") ----

// Order the review pop-out lists fields in (photo first, then the details).
const COMPARE_FIELDS = ['photo', 'name', 'category', 'condition', 'status', 'room_id', 'assigned_to', 'value_php', 'acquired_date', 'description'];
const FIELD_LABELS = {
  name: 'Asset name', category: 'Category', description: 'Description', condition: 'Condition',
  status: 'Status', room_id: 'Room', assigned_to: 'Assigned to', value_php: 'Value (PHP)',
  acquired_date: 'Acquired', photo: 'Photo'
};

function roomName(db, id) {
  if (id === null || id === undefined) return 'Unassigned';
  const r = db.prepare('SELECT name FROM rooms WHERE id = ?').get(id);
  return r ? r.name : 'Unassigned';
}

function groupByBatch(rows, makeBatch, makeItem) {
  const batches = new Map();
  for (const row of rows) {
    if (!batches.has(row.batch_id)) batches.set(row.batch_id, { ...makeBatch(row), items: [] });
    batches.get(row.batch_id).items.push(makeItem(row));
  }
  const list = [...batches.values()];
  for (const b of list) b.items.reverse(); // oldest first within a request
  return list;
}

// Everything waiting, split into the two lists the screen shows. Each list is
// grouped into the sync request that brought the items in, newest request first.
function pendingQueue() {
  const db = getDb();

  const regRows = db.prepare(`
    SELECT * FROM pending_registrations WHERE review_status = 'pending' ORDER BY id DESC
  `).all();
  const registrations = groupByBatch(regRows,
    (r) => ({ batch_id: r.batch_id, user: r.requested_by, device: deviceLabel(r.requested_by, r.device_source, r.device_ip, r.device_name), received_at: r.received_at }),
    (r) => {
      const p = JSON.parse(r.payload_json);
      return {
        id: r.id, name: p.name, category: p.category || null, status: p.status || 'active',
        room: roomName(db, p.room_id), assigned_to: p.assigned_to || null, has_photo: !!p.photo
      };
    });

  const scanRows = db.prepare(`
    SELECT p.*, a.asset_tag, a.name AS asset_name,
           r.name AS scanned_room, rr.name AS registered_room,
           (p.kind = 'scan' AND p.room_id IS NOT NULL AND a.room_id IS NOT NULL AND p.room_id <> a.room_id) AS room_mismatch
    FROM pending_scans p
    JOIN assets a ON a.id = p.asset_id
    LEFT JOIN rooms r ON r.id = p.room_id
    LEFT JOIN rooms rr ON rr.id = a.room_id
    WHERE p.review_status = 'pending'
    ORDER BY p.id DESC
  `).all();
  const scans = groupByBatch(scanRows,
    (r) => ({ batch_id: r.batch_id, user: r.scanned_by, device: deviceLabel(r.scanned_by, r.device_source, r.device_ip, r.device_name), received_at: r.received_at }),
    (r) => {
      const changes = r.changes_json ? JSON.parse(r.changes_json) : {};
      return {
        id: r.id, kind: r.kind, asset_tag: r.asset_tag, asset_name: r.asset_name,
        scanned_as: r.claimed_status,
        scanned_room: r.kind === 'scan' ? (r.scanned_room || 'Unassigned') : null,
        registered_room: r.registered_room || 'Unassigned',
        room_mismatch: !!r.room_mismatch,
        change_fields: Object.keys(changes).map((k) => FIELD_LABELS[k] || k)
      };
    });

  return {
    registrations: { batches: registrations, count: regRows.length },
    scans: { batches: scans, count: scanRows.length },
    count: regRows.length + scanRows.length
  };
}

function pendingCount() {
  const db = getDb();
  const registrations = db.prepare("SELECT COUNT(*) AS c FROM pending_registrations WHERE review_status = 'pending'").get().c;
  const scans = db.prepare("SELECT COUNT(*) AS c FROM pending_scans WHERE review_status = 'pending'").get().c;
  return { count: registrations + scans, registrations, scans };
}

// Full detail for the confirmation pop-up.
function registrationDetail(id) {
  const db = getDb();
  const r = db.prepare("SELECT * FROM pending_registrations WHERE id = ? AND review_status = 'pending'").get(id);
  if (!r) return null;
  const p = JSON.parse(r.payload_json);
  return {
    id: r.id, requested_by: r.requested_by, received_at: r.received_at,
    device: deviceLabel(r.requested_by, r.device_source, r.device_ip, r.device_name),
    // The Asset ID doesn't exist yet: it is generated when this is approved.
    asset: { ...p, room_name: roomName(db, p.room_id) }
  };
}

function scanDetail(id) {
  const db = getDb();
  const r = db.prepare("SELECT * FROM pending_scans WHERE id = ? AND review_status = 'pending'").get(id);
  if (!r) return null;
  const asset = require('../assets/services').getAssetDetail(r.asset_id);
  if (!asset) return null;
  const changes = r.changes_json ? JSON.parse(r.changes_json) : {};

  // Only the fields that would actually change.
  const diff = [];
  for (const [field, to] of Object.entries(changes)) {
    const from = asset[field] === undefined ? null : asset[field];
    if ((from ?? null) === (to ?? null)) continue;
    diff.push({
      field, label: FIELD_LABELS[field] || field, is_photo: field === 'photo',
      from: field === 'room_id' ? roomName(db, from) : from,
      to: field === 'room_id' ? roomName(db, to) : to
    });
  }
  // Every field side by side — what is saved now (original) and what it becomes
  // once verified (updated) — with the ones that change flagged. The review
  // pop-out shows this as two columns; `diff` above stays the changed-only list.
  const norm = (v) => (v === '' || v === undefined ? null : v);
  const compare = COMPARE_FIELDS.map((field) => {
    const from = norm(asset[field]);
    const proposed = Object.prototype.hasOwnProperty.call(changes, field);
    const to = proposed ? norm(changes[field]) : from;
    return {
      field, label: FIELD_LABELS[field] || field, is_photo: field === 'photo',
      from: field === 'room_id' ? roomName(db, from) : from,
      to: field === 'room_id' ? roomName(db, to) : to,
      changed: proposed && from !== to
    };
  });

  return {
    id: r.id, kind: r.kind, scanned_by: r.scanned_by, received_at: r.received_at,
    device: deviceLabel(r.scanned_by, r.device_source, r.device_ip, r.device_name),
    scanned_as: r.claimed_status,
    scanned_room: r.kind === 'scan' ? roomName(db, r.room_id) : null,
    registered_room: roomName(db, asset.room_id),
    room_mismatch: r.kind === 'scan' && r.room_id !== null && asset.room_id !== null && r.room_id !== asset.room_id,
    asset, diff, compare
  };
}

function insertVerifiedLog(db, row) {
  db.prepare(`
    INSERT INTO inventory_logs (asset_id, room_id, scanned_by, status, scanned_at, device_source, device_ip, device_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.asset_id, row.room_id, row.scanned_by, row.status, row.scanned_at, row.device_source, row.device_ip, row.device_name);
}

function cleanIds(ids) {
  return (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
}

// Verify or reject queued SCANS. Approving applies the scan's proposed edits to
// the asset, then (for a real scan) logs it as verified so it counts everywhere.
function reviewScans(action, ids, reviewer) {
  const db = getDb();
  const assets = require('../assets/services');
  const getRow = db.prepare("SELECT * FROM pending_scans WHERE id = ? AND review_status = 'pending'");
  const close = db.prepare("UPDATE pending_scans SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?");
  const result = { done: 0, failed: [] };
  db.transaction(() => {
    for (const id of ids) {
      const row = getRow.get(id);
      if (!row) continue; // already handled (e.g. from another window)
      if (action === 'approve') {
        try {
          const changes = row.changes_json ? pickFields(JSON.parse(row.changes_json), EDITABLE_FIELDS) : {};
          if (Object.keys(changes).length) assets.updateAsset(row.asset_id, changes);
        } catch (err) {
          result.failed.push({ id, error: err.message });
          continue;
        }
        if (row.kind === 'scan') {
          // Keep the time the phone's data arrived, so the log shows when it happened, not when it was reviewed.
          insertVerifiedLog(db, { asset_id: row.asset_id, room_id: row.room_id, scanned_by: row.scanned_by, status: row.claimed_status, scanned_at: row.received_at, device_source: row.device_source, device_ip: row.device_ip, device_name: row.device_name });
        }
      }
      close.run(action === 'approve' ? 'approved' : 'rejected', reviewer, id);
      result.done++;
    }
  })();
  return result;
}

// Verify or reject queued REGISTRATIONS. Approving is what actually adds the
// asset (and generates its Asset ID); it is logged as verified straight away,
// like an asset registered on the desktop.
function reviewRegistrations(action, ids, reviewer) {
  const db = getDb();
  const assets = require('../assets/services');
  const getRow = db.prepare("SELECT * FROM pending_registrations WHERE id = ? AND review_status = 'pending'");
  const reject = db.prepare("UPDATE pending_registrations SET review_status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?");
  const approve = db.prepare("UPDATE pending_registrations SET review_status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'), created_asset_id = ? WHERE id = ?");
  const result = { done: 0, failed: [], created: [] };
  db.transaction(() => {
    for (const id of ids) {
      const row = getRow.get(id);
      if (!row) continue;
      if (action === 'reject') { reject.run(reviewer, id); result.done++; continue; }

      // Safety net: if an asset already carries this registration's phone id, it was
      // created before — link to it instead of adding a second copy.
      const existing = row.client_uuid ? db.prepare('SELECT id FROM assets WHERE client_uuid = ?').get(row.client_uuid) : null;
      if (existing) { approve.run(reviewer, existing.id, id); result.done++; continue; }

      let asset;
      try {
        // The Asset ID is always generated here — even a row queued by an older phone that
        // typed one. The phone's own id travels along and stays on the asset as its reference.
        const { asset_tag: _typedOnPhone, ...fields } = JSON.parse(row.payload_json);
        asset = assets.createAsset({ ...fields, client_uuid: row.client_uuid || null });
      } catch (err) {
        const taken = /UNIQUE/i.test(err.message || '');
        result.failed.push({ id, error: taken ? 'That Asset ID is already registered.' : err.message });
        continue;
      }
      insertVerifiedLog(db, { asset_id: asset.id, room_id: asset.room_id, scanned_by: row.requested_by, status: 'verified', scanned_at: row.received_at, device_source: row.device_source, device_ip: row.device_ip, device_name: row.device_name });
      approve.run(reviewer, asset.id, id);
      result.created.push(asset.asset_tag);
      result.done++;
    }
  })();
  return result;
}

// The phone asks what became of the registrations it sent, by the ids it made. Only
// the sender's own registrations are answered. Gives the phone the Asset ID (AST-…)
// once a registration has been verified.
function registrationStatuses(uuids, username) {
  const db = getDb();
  const list = [...new Set((Array.isArray(uuids) ? uuids : []).map(cleanUuid).filter(Boolean))].slice(0, 200);
  const get = db.prepare(`
    SELECT r.client_uuid, r.review_status AS status, a.asset_tag
    FROM pending_registrations r LEFT JOIN assets a ON a.id = r.created_asset_id
    WHERE r.client_uuid = ? AND r.requested_by = ?
  `);
  return list.map((u) => get.get(u, username)).filter(Boolean)
    .map((r) => ({ client_uuid: r.client_uuid, status: r.status, asset_tag: r.status === 'approved' ? r.asset_tag : null }));
}

function reviewPending({ type, action, ids }, reviewer = 'unknown') {
  if (action !== 'approve' && action !== 'reject') return { ok: false, status: 400, error: 'action must be approve or reject.' };
  if (type !== 'registration' && type !== 'scan') return { ok: false, status: 400, error: 'type must be registration or scan.' };
  const list = cleanIds(ids);
  if (list.length === 0) return { ok: false, status: 400, error: 'Select at least one item.' };

  const r = type === 'registration' ? reviewRegistrations(action, list, reviewer) : reviewScans(action, list, reviewer);
  const noun = type === 'registration' ? 'registration' : 'scan';
  if (r.done > 0) {
    require('../system/services').logEvent('SYNC',
      `${reviewer} ${action === 'approve' ? 'verified' : 'rejected'} ${r.done} ${noun}(s)${r.created && r.created.length ? ` → ${r.created.join(', ')}` : ''}`,
      action === 'approve' ? 'success' : 'warn');
  }
  const key = action === 'approve' ? 'approved' : 'rejected';
  return { ok: true, [key]: r.done, failed: r.failed, created: r.created };
}

// Records the end-of-session summary shown on the mobile "Background Sync
// Summary" screen — separate from the raw per-asset scan log, this is the
// human-facing session record (counts, notes, supervisor flags, signature).
function recordSyncSession(data) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO sync_sessions
      (room_id, scanned_by, total_scanned, missing_count, notify_supervisor, auto_sync, save_offline, notes, signature_data, device_source, device_ip, device_name)
    VALUES (@room_id, @scanned_by, @total_scanned, @missing_count, @notify_supervisor, @auto_sync, @save_offline, @notes, @signature_data, @device_source, @device_ip, @device_name)
  `).run({
    room_id: data.room_id || null,
    scanned_by: data.scanned_by || 'unknown',
    total_scanned: data.total_scanned || 0,
    missing_count: data.missing_count || 0,
    notify_supervisor: data.notify_supervisor ? 1 : 0,
    auto_sync: data.auto_sync ? 1 : 0,
    save_offline: data.save_offline ? 1 : 0,
    notes: data.notes || null,
    signature_data: data.signature_data || null,
    device_source: data.device_source || null,
    device_ip: data.device_ip || null,
    device_name: data.device_name || null
  });
  return { ok: true, id: info.lastInsertRowid };
}

function recentLogs(limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT l.*, a.name AS asset_name, a.asset_tag, r.name AS room_name
    FROM inventory_logs l
    LEFT JOIN assets a ON a.id = l.asset_id
    LEFT JOIN rooms r ON r.id = l.room_id
    ORDER BY l.scanned_at DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  recordSyncBatch, roomProgress, allRoomsProgress, recentLogs,
  markScanned, recordSyncSession, syncLog,
  pendingQueue, pendingCount, registrationDetail, scanDetail, reviewPending, registrationStatuses,
  queueMobileRegistration, queueMobileEdit
};
