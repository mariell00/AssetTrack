// mobile/src/core/api-client.js — plain fetch wrapper pointed at the
// Desktop host (configured on first launch — either the desktop's LAN IP,
// or a public tunnel URL from the QR code — stored in localStorage so it
// survives app restarts).
function getBaseUrl() {
  return localStorage.getItem('assettrack_desktop_url') || '';
}

function setBaseUrl(url) {
  localStorage.setItem('assettrack_desktop_url', url.replace(/\/$/, ''));
}

// Marks every request as coming from the mobile PWA (as opposed to the
// Admin Hub, which sends no such header) so the server can tell the two
// clients apart — see auth/routes.js. Used to record "logged in from
// mobile" on the Admin Hub's Manage Users screen and activity log.
function clientHeaders() {
  return { 'X-Client-Type': 'mobile' };
}

function authHeaders() {
  const token = localStorage.getItem('assettrack_mobile_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// If the server says the token is invalid/expired — or the account behind
// it was just deactivated from Manage Users, which requireAuth now checks
// on every request, not just at login — clear it and tell the rest of the
// app so it falls back to the login screen right away, instead of
// silently failing every request until the staff member happens to hit
// LOG OUT themselves.
//
// Skipped for the login endpoint itself: a wrong password is also a 401,
// and firing this would immediately re-render the whole app (back to this
// same login screen) before ui-login.js's own submit handler gets a
// chance to show "Invalid username or password" on it — the message would
// get wiped by the re-render before anyone saw it.
function handleAuthFailure(status, path) {
  if (status === 401 && path !== '/api/v1/auth/login') {
    localStorage.removeItem('assettrack_mobile_token');
    localStorage.removeItem('assettrack_mobile_user');
    window.dispatchEvent(new CustomEvent('assettrack:session-expired'));
  }
}

async function apiPost(path, body) {
  const base = getBaseUrl();
  if (!base) return { ok: false, error: 'Desktop host not configured yet.' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...clientHeaders(), ...authHeaders() },
      body: JSON.stringify(body)
    });
    handleAuthFailure(res.status, path);
    return await res.json();
  } catch (err) {
    return { ok: false, offline: true, error: 'No connection to desktop host.' };
  }
}

async function apiGet(path) {
  const base = getBaseUrl();
  if (!base) return { ok: false, error: 'Desktop host not configured yet.' };
  try {
    const res = await fetch(`${base}${path}`, { headers: { ...clientHeaders(), ...authHeaders() } });
    handleAuthFailure(res.status, path);
    return await res.json();
  } catch (err) {
    return { ok: false, offline: true, error: 'No connection to desktop host.' };
  }
}

async function apiPut(path, body) {
  const base = getBaseUrl();
  if (!base) return { ok: false, error: 'Desktop host not configured yet.' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...clientHeaders(), ...authHeaders() },
      body: JSON.stringify(body)
    });
    handleAuthFailure(res.status, path);
    return await res.json();
  } catch (err) {
    return { ok: false, offline: true, error: 'No connection to desktop host.' };
  }
}

export { getBaseUrl, setBaseUrl, apiPost, apiGet, apiPut };
