// mobile/features/qr-reader/ui-scanner.js — "Point camera at QR code" screen.
import { startQrScan } from './services.js';

export function renderScanner(onCodeRead) {
  const el = document.createElement('div');
  el.className = 'm-screen m-scanner';
  el.innerHTML = `
    <div class="m-panel m-scanner-panel">
      <div class="m-header">SCAN ASSET QR CODE</div>
      <video id="m-qr-video" class="m-qr-video" playsinline muted></video>
      <p id="m-scan-status" class="m-status">Point the camera at the asset's QR label…</p>
      <button id="m-scan-retry" class="m-btn" style="display:none;" type="button">▶ RETRY CAMERA</button>
    </div>
  `;

  const status = el.querySelector('#m-scan-status');
  const video = el.querySelector('#m-qr-video');
  const retryBtn = el.querySelector('#m-scan-retry');
  let session = null;
  let stopped = false;

  function start() {
    retryBtn.style.display = 'none';
    status.textContent = 'Starting camera…';
    status.classList.remove('m-error');
    startQrScan(
      video,
      (value) => { status.textContent = `Code read: ${value}`; status.classList.remove('m-error'); onCodeRead(value); },
      (err) => {
        status.textContent = err;
        status.classList.add('m-error');
        if (!stopped) retryBtn.style.display = 'block';
      }
    ).then((s) => { if (!stopped) session = s; else s?.stop(); });
  }

  retryBtn.addEventListener('click', start);
  start();

  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      stopped = true;
      session?.stop();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return el;
}
