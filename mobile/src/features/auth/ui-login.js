// mobile/features/auth/ui-login.js — login screen HTML template + logic.
import { login } from './services.js';
import { getBaseUrl } from '../../core/api-client.js';

export function renderLogin(onSuccess) {
  const el = document.createElement('div');
  el.className = 'm-screen m-login';

  // Default the Desktop URL field to wherever this page itself was loaded
  // from. That's almost always correct: if the phone opened this page over
  // a LAN IP, the API lives at that same LAN IP; if it opened this page
  // through a Cloudflare/ngrok tunnel URL, the API is proxied through that
  // same tunnel too (same Express server, same port). Typing in a
  // different address here — e.g. a LAN IP while the page itself was
  // reached over a public https tunnel — is the single most common cause
  // of "Login failed.": the browser silently blocks an http:// request
  // from an https:// page (mixed content), and a private LAN address
  // usually isn't reachable at all from outside that LAN anyway.
  const savedUrl = getBaseUrl();
  const defaultUrl = savedUrl || (window.location.origin !== 'null' ? window.location.origin : '');

  el.innerHTML = `
    <div class="m-panel">
      <div class="m-header">ASSETTRACK SCANNER</div>
      <form id="m-login-form">
        <label>DESKTOP URL</label>
        <input id="m-desktop-url" placeholder="http://192.168.1.42:3000" value="${defaultUrl}" required />
        <label>USERNAME</label>
        <input id="m-username" required />
        <label>PASSWORD</label>
        <input id="m-password" type="password" required />
        <button class="m-btn" type="submit">▶ CONNECT</button>
        <p id="m-login-error" class="m-error"></p>
      </form>
    </div>
  `;

  el.querySelector('#m-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const desktopUrl = el.querySelector('#m-desktop-url').value.trim();
    const username = el.querySelector('#m-username').value.trim();
    const password = el.querySelector('#m-password').value;
    const errorEl = el.querySelector('#m-login-error');

    const result = await login(desktopUrl, username, password);
    if (!result.ok) {
      errorEl.textContent = result.error || 'Login failed. Check the Desktop URL matches how you reached this page.';
      return;
    }
    onSuccess();
  });

  return el;
}
