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

// The login screen stores the issued token as 'assettrack_mobile_token',
// but until now nothing ever read it back out again — every request after
// login went out with no Authorization header at all. That was invisible
// while the server had no auth check either; now that the server enforces
// requireAuth on every route, every mobile request needs this or it 401s.
function authHeaders() {
  const token = localStorage.getItem('assettrack_mobile_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// If the server says the token is invalid/expired, clear it so the app
// falls back to the login screen on next render instead of silently
// failing every request forever.
function handleAuthFailure(status) {
  if (status === 401) {
    localStorage.removeItem('assettrack_mobile_token');
    localStorage.removeItem('assettrack_mobile_user');
  }
}

async function apiPost(path, body) {
  const base = getBaseUrl();
  if (!base) return { ok: false, error: 'Desktop host not configured yet.' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body)
    });
    handleAuthFailure(res.status);
    return await res.json();
  } catch (err) {
    return { ok: false, offline: true, error: 'No connection to desktop host.' };
  }
}

async function apiGet(path) {
  const base = getBaseUrl();
  if (!base) return { ok: false, error: 'Desktop host not configured yet.' };
  try {
    const res = await fetch(`${base}${path}`, { headers: { ...authHeaders() } });
    handleAuthFailure(res.status);
    return await res.json();
  } catch (err) {
    return { ok: false, offline: true, error: 'No connection to desktop host.' };
  }
}

export { getBaseUrl, setBaseUrl, apiPost, apiGet };
