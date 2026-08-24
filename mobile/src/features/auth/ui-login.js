// mobile/features/auth/ui-login.js — login screen HTML template + logic.
import { login } from './services.js';

export function renderLogin(onSuccess) {
  const el = document.createElement('div');
  el.className = 'm-screen m-login';
  el.innerHTML = `
    <div class="m-panel">
      <div class="m-header">ASSETTRACK SCANNER</div>
      <form id="m-login-form">
        <label>DESKTOP URL</label>
        <input id="m-desktop-url" placeholder="http://192.168.1.42:3000" required />
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
      errorEl.textContent = result.error || 'Login failed.';
      return;
    }
    onSuccess();
  });

  return el;
}
