// mobile/features/auth/services.js — login API call to the Desktop host.
import { apiPost, setBaseUrl } from '../../core/api-client.js';
import { clearLookupCache } from '../../core/lookups.js';

async function login(desktopUrl, username, password) {
  setBaseUrl(desktopUrl);
  const result = await apiPost('/api/v1/auth/login', { username, password });
  if (result.ok) {
    localStorage.setItem('assettrack_mobile_token', result.token);
    localStorage.setItem('assettrack_mobile_user', JSON.stringify(result.user));
  }
  return result;
}

function currentUser() {
  const raw = localStorage.getItem('assettrack_mobile_user');
  return raw ? JSON.parse(raw) : null;
}

function logout() {
  localStorage.removeItem('assettrack_mobile_token');
  localStorage.removeItem('assettrack_mobile_user');
  // Cached rooms/assignees belong to the desktop host this account used.
  clearLookupCache();
}

export { login, currentUser, logout };
