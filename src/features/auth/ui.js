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
      .map((u) => {
        const icon = u.last_login_source === 'mobile' ? '📱' : '🖥';
        const device = u.last_login_device ? ` (${u.last_login_device})` : '';
        return `<div class="mono-row">${icon} ${u.username} — ${u.role}${device}</div>`;
      })
      .join('');
  });

  return el;
}

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

// Renders "when" plus a small badge showing which client the user last
// logged in from — the specific device (📱 IPHONE, 🖥 WINDOWS PC, etc.,
// from the User-Agent — see core/device.js) when it's recognizable, or a
// generic MOBILE/DESKTOP tag otherwise — so admins can tell staff are
// actually checking in from the field rather than guessing from the bare
// timestamp alone.
function lastLoginCell(u) {
  if (!u.last_active) return '<span class="last-login-empty">never</span>';
  const when = u.last_active.replace('T', ' ');
  const isMobile = u.last_login_source === 'mobile';
  const badgeClass = isMobile ? 'badge-source-mobile' : 'badge-source-desktop';
  const icon = isMobile ? '📱' : '🖥';
  const badgeLabel = `${icon} ${u.last_login_device ? u.last_login_device.toUpperCase() : (isMobile ? 'MOBILE' : 'DESKTOP')}`;
  const title = u.last_login_ip ? ` title="IP: ${u.last_login_ip}"` : '';
  return `
    <div class="last-login-cell"${title}>
      <span>${when}</span>
      <span class="badge ${badgeClass}">${badgeLabel}</span>
    </div>
  `;
}

// Add-user modal — replaces the old prompt()/confirm() chain with a proper
// form consistent with the rest of the app (see assets/ui.js's
// openAssetModal for the same pattern).
function openAddUserModal(root, onCreated) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box crt-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> ADD USER
        <button class="modal-close" id="user-modal-close">✕</button>
      </div>
      <form id="user-form" class="retro-form modal-form">
        <label>USERNAME
          <input type="text" id="u-username" class="retro-input" required />
        </label>
        <label>TEMPORARY PASSWORD
          <input type="text" id="u-password" class="retro-input" required />
        </label>
        <label>ROLE
          <select id="u-role" class="retro-input">
            <option value="staff" selected>STAFF</option>
            <option value="admin">ADMIN</option>
          </select>
        </label>
        <label>ASSIGNED AREA
          <input type="text" id="u-area" class="retro-input" placeholder="e.g. Main Building" />
        </label>
        <button type="submit" class="btn-retro">▶ CREATE ACCOUNT</button>
        <p id="user-modal-error" class="form-error"></p>
      </form>
    </div>
  `;
  root.appendChild(overlay);

  overlay.querySelector('#user-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = overlay.querySelector('#u-username').value.trim();
    const password = overlay.querySelector('#u-password').value;
    const role = overlay.querySelector('#u-role').value;
    const assigned_area = overlay.querySelector('#u-area').value.trim() || null;

    const result = await apiPost('/api/v1/auth/users', { username, password, role, assigned_area });
    if (!result.ok) {
      overlay.querySelector('#user-modal-error').textContent = result.error || 'Could not create user.';
      return;
    }
    overlay.remove();
    onCreated();
  });
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
          <tr><th>USER</th><th>ROLE</th><th>ASSIGNED AREA</th><th>LAST LOGIN</th><th>STATUS</th><th></th></tr>
        </thead>
        <tbody id="user-rows"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  async function loadUsers(search = '') {
    const result = await apiGet(`/api/v1/auth/users?search=${encodeURIComponent(search)}`);
    const tbody = el.querySelector('#user-rows');
    if (!result.ok) { tbody.innerHTML = `<tr><td colspan="6">${result.error || 'Unable to load users. Admin access required.'}</td></tr>`; return; }
    if (result.users.length === 0) { tbody.innerHTML = `<tr><td colspan="6">No users found.</td></tr>`; return; }

    tbody.innerHTML = result.users.map((u) => `
      <tr data-id="${u.id}">
        <td class="user-cell"><span class="avatar-circle">${initials(u.username)}</span> ${u.username}</td>
        <td><span class="badge badge-role-${u.role}">${u.role}</span></td>
        <td>${u.assigned_area || '—'}</td>
        <td>${lastLoginCell(u)}</td>
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

  el.querySelector('#btn-add-user').addEventListener('click', () => {
    openAddUserModal(el, () => loadUsers(el.querySelector('#user-search').value));
  });

  loadUsers();
  return el;
}
