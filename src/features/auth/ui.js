// features/auth/ui.js — login screen + user management panel.
// Exports render() so the client router can inject this into #app.
import { apiPost, apiGet, apiPatch } from '../../js/api-client.js';

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-login';
  // "blue" = school palette (cobalt #0033FF / navy #0A1A3F / white). Use 'red' for the old charcoal + red look.
  el.dataset.accent = 'blue';
  el.innerHTML = `
    <div class="lg-ghost" aria-hidden="true">nbsc supply office nbsc supply office nbsc supply office nbsc supply office nbsc supply office nbsc supply office</div>
    <div class="lg-card">
      <header class="lg-head">
        <div>
          <h1 class="lg-nbsc">NBSC</h1>
          <p class="lg-college">Northern Bukidnon State College</p>
        </div>
        <h2 class="lg-office">supply office</h2>
      </header>

      <div class="lg-marks" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13" cy="13" r="8"/><path d="M13 1v8M13 17v8M1 13h8M17 13h8"/></svg>
        <span class="lg-bar"></span>
        <span class="lg-dots"></span>
        <span class="lg-code">asset registry</span>
      </div>

      <div class="lg-body">
        <figure class="lg-figure">
          <!-- Placeholder photo: replace assets/login/placeholder.jpg with the real campus image. -->
          <img src="assets/login/placeholder.jpg" alt="" />
          <figcaption class="lg-figcap">photo placeholder</figcaption>
        </figure>

        <form id="login-form" class="lg-form" novalidate>
          <div class="lg-field" id="field-username">
            <div class="lg-field-head">
              <label for="login-username">user name</label>
              <span class="lg-flag" id="flag-username" aria-live="polite"></span>
            </div>
            <input type="text" id="login-username" autocomplete="username" required />
          </div>
          <div class="lg-field" id="field-password">
            <div class="lg-field-head">
              <label for="login-password">password</label>
              <span class="lg-flag" id="flag-password" aria-live="polite"></span>
            </div>
            <input type="password" id="login-password" autocomplete="current-password" required />
          </div>
          <button type="submit" class="lg-submit" id="login-submit">Login</button>
          <p id="login-error" class="lg-status" role="alert"></p>
          <button type="button" class="lg-forgot" id="login-forgot">forget password?</button>
        </form>
      </div>

      <div class="lg-foot">
        <div class="lg-desc-wrap">
          <svg class="lg-globe" width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="32" cy="32" r="28"/><ellipse cx="32" cy="32" rx="12" ry="28"/><ellipse cx="32" cy="32" rx="22" ry="28"/>
            <path d="M32 4v56M4 32h56M8 20h48M8 44h48"/>
          </svg>
          <p class="lg-desc">Track, tag and verify every college asset, even without a connection. Authorized supply office staff only.</p>
        </div>
        <div class="lg-checker" aria-hidden="true"></div>
      </div>
    </div>

    <dialog class="lg-modal" id="forgot-dialog" aria-labelledby="forgot-title">
      <div class="lg-modal-box">
        <div class="lg-modal-bar">
          <span class="lg-modal-code">superadmin recovery</span>
          <button type="button" class="lg-modal-x" id="forgot-x" aria-label="Close">&times;</button>
        </div>
        <div class="lg-modal-body">
          <h3 class="lg-modal-title" id="forgot-title">forget password?</h3>

          <section class="lg-step" data-step="request">
            <p class="lg-modal-text">A one-time code will be emailed to the system administrator &mdash; the person who set up AssetTrack. With that code you can set a new user name and password for the superadmin account.</p>
            <p class="lg-status lg-modal-status" id="forgot-status" role="alert"></p>
            <button type="button" class="lg-submit lg-modal-ok" id="forgot-send">Send code</button>
            <div class="lg-modal-links"><button type="button" class="lg-linkbtn" id="forgot-have-code">I already have a code</button></div>
          </section>

          <form class="lg-step" data-step="reset" id="reset-form" novalidate hidden>
            <p class="lg-modal-text" id="reset-hint"></p>
            <div class="lg-field" id="field-code">
              <div class="lg-field-head"><label for="reset-code">one-time code</label><span class="lg-flag" id="flag-code" aria-live="polite"></span></div>
              <input type="text" id="reset-code" class="lg-code-input" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="XXXX-XXXX" />
            </div>
            <div class="lg-field" id="field-newuser">
              <div class="lg-field-head"><label for="reset-user">new user name</label><span class="lg-flag" id="flag-newuser" aria-live="polite"></span></div>
              <input type="text" id="reset-user" autocomplete="username" spellcheck="false" />
            </div>
            <div class="lg-field" id="field-newpass">
              <div class="lg-field-head"><label for="reset-pass">new password</label><span class="lg-flag" id="flag-newpass" aria-live="polite"></span></div>
              <input type="password" id="reset-pass" autocomplete="new-password" />
            </div>
            <div class="lg-field" id="field-newpass2">
              <div class="lg-field-head"><label for="reset-pass2">confirm password</label><span class="lg-flag" id="flag-newpass2" aria-live="polite"></span></div>
              <input type="password" id="reset-pass2" autocomplete="new-password" />
            </div>
            <p class="lg-status lg-modal-status" id="reset-status" role="alert"></p>
            <button type="submit" class="lg-submit lg-modal-ok" id="reset-submit">Reset superadmin</button>
            <div class="lg-modal-links">
              <button type="button" class="lg-linkbtn" id="reset-resend">send a new code</button>
              <button type="button" class="lg-linkbtn" id="reset-back">back</button>
            </div>
          </form>

          <section class="lg-step" data-step="done" hidden>
            <p class="lg-modal-text" id="done-text"></p>
            <button type="button" class="lg-submit lg-modal-ok" id="done-ok">Back to login</button>
          </section>
        </div>
      </div>
    </dialog>
  `;

  const form = el.querySelector('#login-form');
  const errorEl = el.querySelector('#login-error');
  const submitBtn = el.querySelector('#login-submit');

  function setStatus(message, kind = 'error') {
    errorEl.textContent = message;
    errorEl.dataset.kind = kind;
  }

  // Red-field feedback: the field turns red and a short flag ("incorrect" /
  // "required") appears beside its label. Editing a field clears its flag.
  const fieldIds = {
    username: ['field-username', 'login-username', 'flag-username'],
    password: ['field-password', 'login-password', 'flag-password'],
    code:     ['field-code', 'reset-code', 'flag-code'],
    newUser:  ['field-newuser', 'reset-user', 'flag-newuser'],
    newPass:  ['field-newpass', 'reset-pass', 'flag-newpass'],
    newPass2: ['field-newpass2', 'reset-pass2', 'flag-newpass2']
  };
  const fields = {};
  for (const [name, [wrap, input, flag]] of Object.entries(fieldIds)) {
    fields[name] = { wrap: el.querySelector('#' + wrap), input: el.querySelector('#' + input), flag: el.querySelector('#' + flag) };
  }
  const LOGIN_FIELDS = ['username', 'password'];
  const RESET_FIELDS = ['code', 'newUser', 'newPass', 'newPass2'];
  function flagField(name, text) {
    const f = fields[name];
    f.wrap.dataset.invalid = 'true';
    f.input.setAttribute('aria-invalid', 'true');
    f.flag.textContent = text;
  }
  function clearFlag(name) {
    const f = fields[name];
    delete f.wrap.dataset.invalid;
    f.input.removeAttribute('aria-invalid');
    f.flag.textContent = '';
  }
  Object.keys(fields).forEach((name) => fields[name].input.addEventListener('input', () => clearFlag(name)));

  // ---- "forget password?" — emailed one-time code → new superadmin credentials ----
  // Native <dialog>: overlays the screen (no layout shift), Esc closes it, and
  // focus returns to the "forget password?" button afterwards. Steps: request →
  // reset → done. The code itself is only ever emailed, never shown here.
  const forgotDialog = el.querySelector('#forgot-dialog');
  const stepEls = [...forgotDialog.querySelectorAll('.lg-step')];
  const forgotTitle = el.querySelector('#forgot-title');
  const STEP_TITLES = { request: 'forget password?', reset: 'enter your code', done: 'all set' };
  const sendBtn = el.querySelector('#forgot-send');
  const requestStatus = el.querySelector('#forgot-status');
  const resetForm = el.querySelector('#reset-form');
  const resetStatus = el.querySelector('#reset-status');
  const resetHint = el.querySelector('#reset-hint');
  const resendBtn = el.querySelector('#reset-resend');
  const resetSubmit = el.querySelector('#reset-submit');
  let currentStep = 'request';
  let resendTimer = null;
  let resendUntil = 0;
  let recoveredUsername = '';

  function inlineStatus(node, message, kind = 'error') {
    node.textContent = message;
    node.dataset.kind = kind;
  }
  function showStep(name, { focus = true } = {}) {
    currentStep = name;
    stepEls.forEach((step) => { step.hidden = step.dataset.step !== name; });
    forgotTitle.textContent = STEP_TITLES[name];
    if (focus) {
      const first = forgotDialog.querySelector(`.lg-step[data-step="${name}"] input, .lg-step[data-step="${name}"] button`);
      if (first) first.focus();
    }
  }
  function startResendCooldown(seconds) {
    clearInterval(resendTimer);
    resendUntil = Date.now() + seconds * 1000;
    const tick = () => {
      const left = Math.ceil((resendUntil - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(resendTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'send a new code';
        return;
      }
      resendBtn.disabled = true;
      resendBtn.textContent = `send a new code (${left}s)`;
    };
    tick();
    resendTimer = setInterval(tick, 500);
  }

  // Asks the server to email a fresh code. `statusNode` is where any problem is shown.
  async function requestCode(button, statusNode) {
    inlineStatus(statusNode, '');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending…';
    let result;
    try {
      result = await apiPost('/api/v1/auth/recovery/request', {});
    } catch (_) {
      result = { ok: false, error: 'Could not reach the AssetTrack server.' };
    }
    button.textContent = label;
    button.disabled = false;
    if (!result.ok) {
      inlineStatus(statusNode, result.error || 'Could not send the code. Please try again.');
      return;
    }
    resetHint.textContent = `Code sent to ${result.maskedEmail}. It expires in ${result.expiresInMinutes} minutes and works once.`;
    startResendCooldown(result.cooldownSeconds || 60);
    showStep('reset');
  }

  el.querySelector('#login-forgot').addEventListener('click', () => {
    showStep('request', { focus: false });
    forgotDialog.showModal();
  });
  sendBtn.addEventListener('click', () => requestCode(sendBtn, requestStatus));
  resendBtn.addEventListener('click', () => requestCode(resendBtn, resetStatus));
  el.querySelector('#forgot-have-code').addEventListener('click', () => {
    inlineStatus(requestStatus, '');
    resetHint.textContent = 'Enter the code from the email sent to the system administrator.';
    showStep('reset');
  });
  el.querySelector('#reset-back').addEventListener('click', () => showStep('request'));
  el.querySelector('#forgot-x').addEventListener('click', () => forgotDialog.close());
  el.querySelector('#done-ok').addEventListener('click', () => forgotDialog.close());
  // Backdrop click closes — except mid-form, where a stray click would throw away what was typed.
  forgotDialog.addEventListener('click', (e) => {
    if (e.target === forgotDialog && currentStep !== 'reset') forgotDialog.close();
  });
  // However it closed (×, Esc, button): wipe anything typed, go back to step 1.
  forgotDialog.addEventListener('close', () => {
    clearInterval(resendTimer);
    resendBtn.disabled = false;
    resendBtn.textContent = 'send a new code';
    RESET_FIELDS.forEach((name) => { fields[name].input.value = ''; clearFlag(name); });
    inlineStatus(requestStatus, '');
    inlineStatus(resetStatus, '');
    showStep('request', { focus: false });
    if (recoveredUsername) {
      // Hand the new user name to the login form so only the password is left to type.
      LOGIN_FIELDS.forEach(clearFlag);
      fields.username.input.value = recoveredUsername;
      fields.password.input.value = '';
      fields.password.input.focus();
      recoveredUsername = '';
    }
  });

  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    inlineStatus(resetStatus, '');
    RESET_FIELDS.forEach(clearFlag);
    const code = fields.code.input.value.trim();
    const user = fields.newUser.input.value.trim();
    const pass = fields.newPass.input.value;
    const pass2 = fields.newPass2.input.value;

    let missing = false;
    if (!code) { flagField('code', 'required'); missing = true; }
    if (!user) { flagField('newUser', 'required'); missing = true; }
    if (!pass) { flagField('newPass', 'required'); missing = true; }
    if (!pass2) { flagField('newPass2', 'required'); missing = true; }
    else if (pass && pass !== pass2) { flagField('newPass2', 'no match'); missing = true; }
    if (missing) return;

    resetSubmit.disabled = true;
    resetSubmit.textContent = 'Resetting…';
    let result;
    try {
      result = await apiPost('/api/v1/auth/recovery/reset', { code, username: user, password: pass });
    } catch (_) {
      result = { ok: false, error: 'Could not reach the AssetTrack server.' };
    }
    resetSubmit.disabled = false;
    resetSubmit.textContent = 'Reset superadmin';

    if (!result.ok) {
      if (result.code === 'invalid_code') flagField('code', 'incorrect');
      if (result.fields && result.fields.username) flagField('newUser', result.fields.username.flag);
      if (result.fields && result.fields.password) flagField('newPass', result.fields.password.flag);
      const detail = result.fields
        ? Object.values(result.fields).map((f) => f.message).join(' ')
        : result.error;
      inlineStatus(resetStatus, detail || 'Could not reset the account. Please try again.');
      return;
    }

    recoveredUsername = result.username;
    ['code', 'newPass', 'newPass2'].forEach((name) => { fields[name].input.value = ''; }); // don't leave secrets in the DOM
    el.querySelector('#done-text').textContent =
      `Superadmin credentials updated. Log in as “${result.username}” with your new password.`;
    showStep('done');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = el.querySelector('#login-username').value.trim();
    const password = el.querySelector('#login-password').value;
    setStatus('');
    LOGIN_FIELDS.forEach(clearFlag);

    if (!username || !password) {
      if (!username) flagField('username', 'required');
      if (!password) flagField('password', 'required');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Checking';
    const result = await apiPost('/api/v1/auth/login', { username, password });
    submitBtn.disabled = false;
    submitBtn.textContent = 'Login';

    if (!result.ok) {
      if (/invalid username or password/i.test(result.error || '')) {
        // Wrong credentials: turn both fields red. (The server doesn't say which
        // one was wrong, on purpose.) Other failures — deactivated account, server
        // error — aren't "incorrect", so those still get a written message.
        flagField('username', 'incorrect');
        flagField('password', 'incorrect');
      } else {
        setStatus(result.error || 'Login failed. Please try again.');
      }
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
