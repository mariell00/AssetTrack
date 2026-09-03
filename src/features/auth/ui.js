// features/auth/ui.js — login screen + user management panel.
// Exports render() so the client router can inject this into #app.
import { apiPost, apiGet } from '../../js/api-client.js';

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-login scanline';
  el.innerHTML = `
    <div class="crt-panel login-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> ASSETTRACK :: ADMIN LOGIN
      </div>
      <form id="login-form" class="retro-form">
        <label>USERNAME</label>
        <input type="text" id="login-username" autocomplete="username" required />
        <label>PASSWORD</label>
        <input type="password" id="login-password" autocomplete="current-password" required />
        <button type="submit" class="btn-retro">▶ LOG IN</button>
        <p id="login-error" class="form-error"></p>
      </form>
    </div>
  `;

  el.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = el.querySelector('#login-username').value.trim();
    const password = el.querySelector('#login-password').value;
    const errorEl = el.querySelector('#login-error');
    errorEl.textContent = '';

    const result = await apiPost('/api/v1/auth/login', { username, password });
    if (!result.ok) {
      errorEl.textContent = result.error || 'Login failed.';
      return;
    }
    localStorage.setItem('assettrack_token', result.token);
    localStorage.setItem('assettrack_user', JSON.stringify(result.user));
    window.location.hash = '#/dashboard';
  });

  return el;
}

export function renderUserPanel() {
  const el = document.createElement('div');
  el.className = 'panel user-panel';
  el.innerHTML = `<h3>USER ACCOUNTS</h3><div id="user-list" class="mono-list">Loading…</div>`;

  apiGet('/api/v1/auth/users').then((result) => {
    const list = el.querySelector('#user-list');
    if (!result.ok) { list.textContent = 'Unable to load users.'; return; }
    list.innerHTML = result.users
      .map((u) => `<div class="mono-row">${u.username} — ${u.role}</div>`)
      .join('');
  });

  return el;
}
