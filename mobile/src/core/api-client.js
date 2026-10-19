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
// desktop app, which sends no such header) so the server can tell the two
// clients apart — see auth/routes.js. The server only lets `admin` accounts
// in when this header is present.
function clientHeaders() {
  return { 'X-Client-Type': 'mobile' };
}

function authHeaders() {
  const token = localStorage.getItem('assettrack_mobile_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// If the server says the token is invalid/expired — or the account behind
// it was just deactivated, which requireAuth checks on every request — clear
// it and tell the rest of the app so it falls back to the login screen right
// away.
//
// Skipped for the login endpoint itself: a wrong password is also a 401,
// and firing this would re-render the login screen before ui-login.js's own
// submit handler could show "Invalid username or password" on it.
function handleAuthFailure(status, path) {
  if (status === 401 && path !== '/api/v1/auth/login') {
    localStorage.removeItem('assettrack_mobile_token');
    localStorage.removeItem('assettrack_mobile_user');
    window.dispatchEvent(new CustomEvent('assettrack:session-expired'));
  }
}

// One request path for every verb. Three outcomes, kept distinct on purpose:
//   - the host can't be reached        → { ok:false, offline:true }
//   - it answered, but not with JSON    → { ok:false, error } (a server fault,
//     NOT "offline" — this used to be reported as "No connection")
//   - it answered with JSON             → that JSON, as-is
async function request(method, path, body) {
  const base = getBaseUrl();
  if (!base) return { ok: false, error: 'Desktop host not configured yet.' };

  let res;
  try {
    const hasBody = body !== undefined;
    res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...clientHeaders(), ...authHeaders() },
      body: hasBody ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    return { ok: false, offline: true, error: 'No connection to desktop host.' };
  }

  handleAuthFailure(res.status, path);
  try {
    return await res.json();
  } catch (err) {
    return { ok: false, error: `The desktop host sent an unexpected reply (HTTP ${res.status}).` };
  }
}

const apiPost = (path, body) => request('POST', path, body);
const apiGet = (path) => request('GET', path);
const apiPut = (path, body) => request('PUT', path, body);

export { getBaseUrl, setBaseUrl, apiPost, apiGet, apiPut };
