// js/api-client.js — thin fetch wrapper for calling the internal Express
// API, automatically attaching the JWT from localStorage when present.
function authHeaders() {
  const token = localStorage.getItem('assettrack_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet(path) {
  const res = await fetch(path, { headers: { ...authHeaders() } });
  return res.json();
}

export async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  return res.json();
}

export async function apiPatch(path, body) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  return res.json();
}

export async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  return res.json();
}

export async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE', headers: { ...authHeaders() } });
  return res.json();
}
