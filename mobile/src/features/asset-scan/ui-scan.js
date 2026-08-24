// mobile/features/asset-scan/ui-scan.js — list view showing verified/unverified
// assets for the room currently being inventoried.
import { renderScanner } from '../nfc-reader/ui-scanner.js';
import { recordScan } from './services.js';

export function renderAssetScan(roomId) {
  const el = document.createElement('div');
  el.className = 'm-screen m-asset-scan';
  el.innerHTML = `<div id="m-scanned-list" class="m-scanned-list"></div>`;

  const list = el.querySelector('#m-scanned-list');
  const scanned = [];

  function refreshList() {
    list.innerHTML = scanned
      .map((uid) => `<div class="m-row">✔ ${uid}</div>`)
      .join('') || '<p class="m-status">No tags scanned yet in this session.</p>';
  }

  const scannerEl = renderScanner(async (uid) => {
    if (scanned.includes(uid)) return;
    scanned.push(uid);
    await recordScan(uid, roomId, 'verified');
    refreshList();
  });

  el.prepend(scannerEl);
  refreshList();
  return el;
}
