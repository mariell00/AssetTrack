// js/api-client.js — thin fetch wrapper for calling the internal Express
// API, automatically attaching the JWT from localStorage when present.
function authHeaders() {
  const token = localStorage.getItem('assettrack_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// If the server errors out (an uncaught exception in a route handler, a
// crashed process, etc.) Express's default error handler sends back an
// HTML stack trace, not JSON. res.json() on that throws a SyntaxError —
// previously that exception had nowhere to go, so screens calling apiGet
// without their own try/catch (like Reports' preview panel) would just
// hang on "Loading…" forever with no visible error. Catching it here and
// returning a normal {ok:false, error} object means every screen's
// existing `if (!result.ok)` handling now actually fires.
//
// A 401 gets special handling: requireAuth on the server now rejects a
// deactivated account's very next request (see core/security.js), not
// just its next login — so this is also how a DEACTIVATE click in Manage
// Users actually takes effect on an already-open desktop session, instead
// of only blocking future logins. Clearing the session and bouncing to
// #/login here means it takes effect on the very next request, not
// whenever they happen to notice something's failing.
async function handleResponse(res) {
  // Skip the auto-logout-and-redirect behavior for the login endpoint
  // itself — a wrong password is also a 401, and redirecting/re-rendering
  // here would wipe the "Invalid username or password" message the login
  // form is about to show before the user ever sees it.
  const isLoginRequest = res.url.includes('/api/v1/auth/login');
  if (res.status === 401 && !isLoginRequest) {
    localStorage.removeItem('assettrack_token');
    localStorage.removeItem('assettrack_user');
    if (!window.location.hash.startsWith('#/login')) {
      window.location.hash = '#/login';
    }
  }
  try {
    return await res.json();
  } catch (_) {
    return {
      ok: false,
      error: `Server error (HTTP ${res.status}). Check the desktop app's console/logs for details.`
    };
  }
}

export async function apiGet(path) {
  const res = await fetch(path, { headers: { ...authHeaders() } });
  return handleResponse(res);
}

export async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  return handleResponse(res);
}

export async function apiPatch(path, body) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  return handleResponse(res);
}

export async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  return handleResponse(res);
}

export async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE', headers: { ...authHeaders() } });
  return handleResponse(res);
}
