// features/qr-distribution/ui.js — "QR Distribution" screen: the QR code
// itself, the raw server address (with copy button), a live network status
// readout, a download banner, and step-by-step connect instructions.
import { apiGet } from '../../js/api-client.js';

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-qr';
  el.innerHTML = `
    <div class="qr-layout">
      <div class="crt-panel qr-code-panel">
        <div class="qr-code-bar"></div>
        <div id="qr-holder" class="qr-holder">Generating code…</div>
        <button class="btn-retro qr-scan-btn">Scan to access</button>
        <p class="qr-caption">AssetTrack mobile client<br/><span id="qr-version">v2.4.1</span></p>
      </div>

      <div class="qr-side">
        <div class="crt-panel">
          <div class="panel-title">Server address</div>
          <div id="qr-url" class="server-url">loading…</div>
          <button class="btn-retro small outline" id="btn-copy-url">Copy URL</button>
        </div>

        <div class="crt-panel">
          <div class="panel-title">Network status</div>
          <div id="network-status" class="status-list">Loading…</div>
        </div>

        <div class="qr-download-banner">
          <div class="download-title">Getting the app on a phone</div>
          <div class="download-caption">Scanning the code opens a page that lets each admin choose to Install app (adds a home-screen icon) or Continue in browser — no separate download needed.</div>
        </div>

        <div class="crt-panel">
          <div class="panel-title">Access mode</div>
          <div id="access-mode-badge" class="status-row"><span>Mode</span><strong id="access-mode-value">checking…</strong></div>
        </div>

        <div class="crt-panel">
          <div class="panel-title">How to connect</div>
          <ol class="connect-steps" id="connect-steps">
            <li>Ensure device is on same WiFi network</li>
            <li>Open native camera or QR scanner app</li>
            <li>Point camera at QR code on left</li>
            <li>Tap the auto-detected link</li>
            <li>Log in with your mobile credentials</li>
          </ol>
        </div>
      </div>
    </div>
  `;

  let mobileUrl = '';
  let qrRetryTimer = null;

  function applyAccessMode(mode) {
    const badge = el.querySelector('#access-mode-value');
    const steps = el.querySelector('#connect-steps');
    if (mode === 'public') {
      badge.textContent = 'Public (internet)';
      badge.classList.add('status-green');
      steps.innerHTML = `
        <li>Works over any internet connection — same WiFi not required</li>
        <li>Open native camera or QR scanner app</li>
        <li>Point camera at QR code on left</li>
        <li>Tap the auto-detected link</li>
        <li>Choose Install app or Continue in browser</li>
        <li>Log in with your mobile credentials</li>
      `;
    } else {
      badge.textContent = 'Local network (secure)';
      badge.classList.remove('status-green');
      steps.innerHTML = `
        <li>Ensure device is on same WiFi network</li>
        <li>Open native camera or QR scanner app</li>
        <li>Point camera at QR code on left</li>
        <li>Tap the auto-detected link</li>
        <li><strong>First time only:</strong> the browser will warn "connection is not private" — tap Advanced → Proceed. This is expected: it's this server's own private LAN certificate, not a public website, and it's what makes the camera scanner work.</li>
        <li>Choose Install app or Continue in browser</li>
        <li>Log in with your mobile credentials</li>
      `;
    }
  }

  async function loadQr() {
    const result = await apiGet('/api/v1/qr/code');
    const holder = el.querySelector('#qr-holder');
    if (!result.ok) {
      holder.textContent = result.error || 'Unable to generate QR code.';
      clearTimeout(qrRetryTimer);
      qrRetryTimer = setTimeout(loadQr, 3000);
      return;
    }
    mobileUrl = result.url;
    holder.innerHTML = `<img src="${result.dataUrl}" alt="Scan to install AssetTrack mobile" width="220" height="220" />`;
    el.querySelector('#qr-url').textContent = result.url;
    applyAccessMode(result.mode);
  }

  async function loadNetworkStatus() {
    const result = await apiGet('/api/v1/system/status');
    const box = el.querySelector('#network-status');
    if (!result.ok) { box.textContent = 'Unable to load network status.'; return; }
    const s = result.status;
    box.innerHTML = `
      <div class="status-row"><span>Local IP</span><strong class="status-green">${s.localIp}</strong></div>
      <div class="status-row"><span>Admin port</span><strong>${s.port}</strong></div>
      <div class="status-row"><span>Mobile port (HTTPS)</span><strong>${s.mobilePort}</strong></div>
      <div class="status-row"><span>Protocol</span><strong>${s.protocol}</strong></div>
      <div class="status-row"><span>Subnet</span><strong>${s.subnet}</strong></div>
      <div class="status-row"><span>Clients connected</span><strong>${s.clientsConnected}</strong></div>
      <div class="status-row"><span>Requests/Min</span><strong>${s.requestsPerMin}</strong></div>
    `;
  }

  el.querySelector('#btn-copy-url').addEventListener('click', async () => {
    if (!mobileUrl) return;
    try {
      await navigator.clipboard.writeText(mobileUrl);
      const btn = el.querySelector('#btn-copy-url');
      const original = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch {
      alert(mobileUrl);
    }
  });

  loadQr();
  loadNetworkStatus();
  const poll = setInterval(loadNetworkStatus, 10000);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) { clearInterval(poll); clearTimeout(qrRetryTimer); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return el;
}
