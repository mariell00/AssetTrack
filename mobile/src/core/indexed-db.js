// mobile/src/core/indexed-db.js — lightweight IndexedDB wrapper for offline
// storage. Two stores:
//   pending_scans    — the outbox: scans, edits and new-asset registrations that
//                      wait here until the sync feature can flush them to the
//                      Desktop over Wi-Fi.
//   my_registrations — one small record per registration this phone made, kept
//                      AFTER it is sent, so the phone can show where it stands
//                      (waiting for verification → verified as AST-0007).
const DB_NAME = 'assettrack-mobile';
const DB_VERSION = 2;
const STORE = 'pending_scans';
const REG_STORE = 'my_registrations';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'localId', autoIncrement: true });
      }
      // Added in version 2; existing phones get it on their next launch, their queue untouched.
      if (!db.objectStoreNames.contains(REG_STORE)) {
        db.createObjectStore(REG_STORE, { keyPath: 'client_uuid' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab/window of the app needs to upgrade the database, step aside instead of
      // blocking it (an open old connection would otherwise make every later open hang).
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

// The store holds everything waiting for the next SYNC: scans, edits made on
// the phone and new-asset registrations (see `type` on each item). Resolves
// with the new item's key so a later edit can be attached to the same scan.
async function addPendingScan(scan) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({ ...scan, queued_at: new Date().toISOString() });
    let key = null;
    req.onsuccess = () => { key = req.result; };
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error);
  });
}

// Merge extra fields into a queued item (used to attach edits to the scan they belong to).
async function updatePendingItem(localId, patch) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(localId);
    get.onsuccess = () => {
      if (!get.result) { resolve(false); return; }
      store.put({ ...get.result, ...patch });
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllPendingScans() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Removes only the items that were actually sent and acknowledged. (It used to
// clear the whole store, which also threw away anything queued while the sync
// request was still in flight.)
async function removePendingItems(localIds) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of localIds) store.delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function clearPendingScans() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ---- my_registrations ----
// { client_uuid, name, created_at, state, asset_tag }
//   state: 'queued'   saved on the phone, not sent yet
//          'pending'  the desktop has it, waiting for the super admin to verify
//          'approved' verified — `asset_tag` is the Asset ID it became
//          'rejected' the super admin turned it down
//          'failed'   the desktop couldn't use it (e.g. missing name)
async function saveRegistrationRecord(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REG_STORE, 'readwrite');
    tx.objectStore(REG_STORE).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function updateRegistrationRecord(clientUuid, patch) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REG_STORE, 'readwrite');
    const store = tx.objectStore(REG_STORE);
    const get = store.get(clientUuid);
    get.onsuccess = () => { if (get.result) store.put({ ...get.result, ...patch }); };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function getRegistrationRecords() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REG_STORE, 'readonly');
    const req = tx.objectStore(REG_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
    req.onerror = () => reject(req.error);
  });
}

// Keeps the list short: everything still in progress, plus the newest few that are finished.
async function trimRegistrationRecords(keepFinished = 20) {
  const all = await getRegistrationRecords(); // newest first
  const finished = all.filter((r) => r.state === 'approved' || r.state === 'rejected' || r.state === 'failed');
  const drop = finished.slice(keepFinished);
  if (!drop.length) return;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(REG_STORE, 'readwrite');
    for (const r of drop) tx.objectStore(REG_STORE).delete(r.client_uuid);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export {
  addPendingScan, updatePendingItem, getAllPendingScans, removePendingItems, clearPendingScans,
  saveRegistrationRecord, updateRegistrationRecord, getRegistrationRecords, trimRegistrationRecords
};
