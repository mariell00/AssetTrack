// mobile/src/core/indexed-db.js — lightweight IndexedDB wrapper for offline
// storage. One store:
//   pending_scans — the outbox: scans (with the counts and edits made at scan time) and
//                   edits that wait here until the sync feature can flush them to the
//                   Desktop over Wi-Fi.
// (Earlier versions also kept a `my_registrations` store — phones can no longer register
// assets, so version 3 removes it.)
const DB_NAME = 'assettrack-mobile';
const DB_VERSION = 3;
const STORE = 'pending_scans';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'localId', autoIncrement: true });
      }
      // Retired in version 3. Only the registrations list goes — the outbox is left untouched.
      if (db.objectStoreNames.contains('my_registrations')) db.deleteObjectStore('my_registrations');
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

// The store holds everything waiting for the next SYNC: scans and edits made on
// the phone (see `type` on each item). Resolves with the new item's key so a
// later edit can be attached to the same scan.
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

export { addPendingScan, updatePendingItem, getAllPendingScans, removePendingItems, clearPendingScans };
