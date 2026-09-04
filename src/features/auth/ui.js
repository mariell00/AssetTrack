// features/auth/ui.js — login screen + user management panel.
// Exports render() so the client router can inject this into #app.
import { apiPost, apiGet, apiPatch } from '../../js/api-client.js';

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-login';
  el.innerHTML = `
    <div class="crt-panel login-panel">
      <div class="login-avatar">
        <img src="assets/icons/crt-monitor.svg" alt="" width="36" height="36" />
      </div>
      <h2 class="login-title">Admin Portal &mdash; Secure Login</h2>
      <p class="login-subtitle">Authorized supply office staff only</p>
      <form id="login-form" class="retro-form">
        <label>USERNAME OR EMAIL</label>
        <input type="text" id="login-username" autocomplete="username" placeholder="e.g. admin" required />
        <label>PASSWORD</label>
        <input type="password" id="login-password" autocomplete="current-password" placeholder="••••••••" required />
        <button type="submit" class="btn-retro">▶ SIGN IN</button>
        <p id="login-error" class="form-error"></p>
      </form>
      <p class="login-footer">Lost access? Contact your system administrator.</p>
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

// Small dashboard-panel version — quick glance list on the Dashboard screen.
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

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

// Full "Manage User Accounts" screen: search, add-user modal, sortable
// table with role/status badges and per-row actions.
export function renderUserManagement() {
  const el = document.createElement('div');
  el.className = 'screen screen-users';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> MANAGE USER ACCOUNTS
        <div class="header-actions">
          <button id="btn-add-user" class="btn-retro small">+ ADD USER</button>
        </div>
      </div>
      <div class="users-toolbar">
        <input type="text" id="user-search" class="retro-input" placeholder="SEARCH USERNAME..." />
      </div>
      <table class="retro-table">
        <thead>
          <tr><th>USER</th><th>ROLE</th><th>ASSIGNED AREA</th><th>LAST ACTIVE</th><th>STATUS</th><th></th></tr>
        </thead>
        <tbody id="user-rows"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  async function loadUsers(search = '') {
    const result = await apiGet(`/api/v1/auth/users?search=${encodeURIComponent(search)}`);
    const tbody = el.querySelector('#user-rows');
    if (!result.ok) { tbody.innerHTML = `<tr><td colspan="6">Unable to load users. Admin access required.</td></tr>`; return; }
    if (result.users.length === 0) { tbody.innerHTML = `<tr><td colspan="6">No users found.</td></tr>`; return; }

    tbody.innerHTML = result.users.map((u) => `
      <tr data-id="${u.id}">
        <td class="user-cell"><span class="avatar-circle">${initials(u.username)}</span> ${u.username}</td>
        <td><span class="badge badge-role-${u.role}">${u.role}</span></td>
        <td>${u.assigned_area || '—'}</td>
        <td>${u.last_active ? u.last_active.replace('T', ' ') : 'never'}</td>
        <td><span class="badge badge-status-${u.status}">${u.status}</span></td>
        <td class="row-actions">
          <button class="btn-retro small btn-toggle-status" data-id="${u.id}" data-status="${u.status}">
            ${u.status === 'active' ? 'DEACTIVATE' : 'ACTIVATE'}
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-toggle-status').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newStatus = btn.dataset.status === 'active' ? 'inactive' : 'active';
        await apiPatch(`/api/v1/auth/users/${btn.dataset.id}/status`, { status: newStatus });
        loadUsers(el.querySelector('#user-search').value);
      });
    });
  }

  el.querySelector('#user-search').addEventListener('input', (e) => loadUsers(e.target.value));

  el.querySelector('#btn-add-user').addEventListener('click', async () => {
    const username = prompt('Username:');
    if (!username) return;
    const password = prompt('Temporary password:');
    if (!password) return;
    const role = confirm('Make this user an ADMIN? (Cancel = staff)') ? 'admin' : 'staff';
    const assigned_area = prompt('Assigned area (e.g. Main Building):', '') || null;
    const result = await apiPost('/api/v1/auth/users', { username, password, role, assigned_area });
    if (!result.ok) { alert(result.error || 'Could not create user.'); return; }
    loadUsers();
  });

  loadUsers();
  return el;
}
