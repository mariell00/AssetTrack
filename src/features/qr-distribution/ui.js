// features/qr-distribution/ui.js — displays the live QR code for staff to scan.
import { apiGet } from '../../js/api-client.js';

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-qr scanline';
  el.innerHTML = `
    <div class="crt-panel qr-panel">
      <div class="crt-header"><span class="crt-dot"></span> MOBILE PWA DISTRIBUTION</div>
      <p class="qr-instructions">
        Scan with an Android phone's camera, open the link, then
        "Add to Home Screen" to install AssetTrack Scanner like a native app.
      </p>
      <div id="qr-holder" class="qr-holder">Generating code…</div>
      <p id="qr-url" class="mono-small"></p>
    </div>
  `;

  apiGet('/api/v1/qr/code').then((result) => {
    const holder = el.querySelector('#qr-holder');
    if (!result.ok) { holder.textContent = 'Unable to generate QR code.'; return; }
    holder.innerHTML = `<img src="${result.dataUrl}" alt="Scan to install AssetTrack mobile" width="240" height="240" />`;
    el.querySelector('#qr-url').textContent = result.url;
  });

  return el;
}
