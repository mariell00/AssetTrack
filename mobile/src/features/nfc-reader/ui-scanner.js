// mobile/features/nfc-reader/ui-scanner.js — "Tap tag to phone" screen.
import { startNfcScan } from './services.js';

export function renderScanner(onTagRead) {
  const el = document.createElement('div');
  el.className = 'm-screen m-scanner';
  el.innerHTML = `
    <div class="m-panel m-scanner-panel">
      <div class="m-header">TAP TAG TO PHONE</div>
      <div class="m-nfc-icon">📡</div>
      <p id="m-scan-status" class="m-status">Hold your phone near the asset's NFC tag…</p>
    </div>
  `;

  const status = el.querySelector('#m-scan-status');
  startNfcScan(
    (uid) => { status.textContent = `Tag read: ${uid}`; onTagRead(uid); },
    (err) => { status.textContent = err; status.classList.add('m-error'); }
  );

  return el;
}
