// mobile/src/core/api-client.js — plain fetch wrapper pointed at the
// Desktop's local IP (configured by the staff member on first launch,
// stored in localStorage so it survives app restarts).
function getBaseUrl() {
  return localStorage.getItem('assettrack_desktop_url') || '';
}

function setBaseUrl(url) {
  localStorage.setItem('assettrack_desktop_url', url.replace(/\/$/, ''));
}

async function apiPost(path, body) {
  const base = getBaseUrl();
  if (!base) return { ok: false, error: 'Desktop host not configured yet.' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    return { ok: false, offline: true, error: 'No connection to desktop host.' };
  }
}

async function apiGet(path) {
  const base = getBaseUrl();
  if (!base) return { ok: false, error: 'Desktop host not configured yet.' };
  try {
    const res = await fetch(`${base}${path}`);
    return await res.json();
  } catch (err) {
    return { ok: false, offline: true, error: 'No connection to desktop host.' };
  }
}

export { getBaseUrl, setBaseUrl, apiPost, apiGet };
