// features/auth/services.js — login logic + role verification.
// Imports the shared db singleton — never opens its own connection.
const { getDb } = require('../../core/database');
const { verifyPassword, issueToken, hashPassword } = require('../../core/security');

// `meta.source` is 'mobile' or 'desktop', `meta.device` a short label like
// "iPhone" or "Windows PC" (see core/device.js) — both passed in by
// routes.js based on the request itself (the mobile PWA and the Admin Hub
// share this one login route). Defaults to 'desktop' so old clients /
// direct API calls that don't send the header still behave exactly as
// before.
function login(username, password, meta = {}) {
  const source = meta.source === 'mobile' ? 'mobile' : 'desktop';
  const ip = meta.ip || null;
  const device = meta.device || null;
  const db = getDb();
  const { logEvent } = require('../system/services');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) { logEvent('AUTH', `Failed login attempt for "${username}" (${source})`, 'alert'); return { ok: false, error: 'Invalid username or password.' }; }
  if (user.status === 'inactive') return { ok: false, error: 'This account has been deactivated.' };

  const valid = verifyPassword(password, user.password_hash);
  if (!valid) { logEvent('AUTH', `Failed login attempt for "${username}" (${source})`, 'alert'); return { ok: false, error: 'Invalid username or password.' }; }

  db.prepare(
    "UPDATE users SET last_active = datetime('now'), last_login_source = ?, last_login_ip = ?, last_login_device = ? WHERE id = ?"
  ).run(source, ip, device, user.id);

  const label = source === 'mobile' ? 'Mobile login' : 'Admin login';
  logEvent('AUTH', `${label}: user=${user.username.toUpperCase()}${device ? ` · ${device}` : ''}${ip ? ` from ${ip}` : ''}`, 'success');

  const token = issueToken({ id: user.id, username: user.username, role: user.role, source });
  return {
    ok: true,
    token,
    user: { id: user.id, username: user.username, role: user.role, last_login_source: source }
  };
}

function listUsers({ search } = {}) {
  const db = getDb();
  let sql = 'SELECT id, username, role, status, assigned_area, last_active, last_login_source, last_login_ip, last_login_device, created_at FROM users';
  const params = [];
  if (search) { sql += ' WHERE username LIKE ?'; params.push(`%${search}%`); }
  sql += ' ORDER BY username';
  return db.prepare(sql).all(...params);
}

function createUser(username, password, role = 'staff', assignedArea = null) {
  const db = getDb();
  const hash = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, assigned_area) VALUES (?, ?, ?, ?)')
    .run(username, hash, role, assignedArea);
  return { id: info.lastInsertRowid, username, role, assigned_area: assignedArea, status: 'active' };
}

function setUserStatus(id, status) {
  const db = getDb();
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  return { ok: true, id: Number(id), status };
}

function deleteUser(id) {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { ok: true };
}

// requireRole now lives in core/security.js (it's used app-wide, not just
// by auth — re-exported here so auth/routes.js doesn't need to change).
const { requireRole } = require('../../core/security');

module.exports = { login, listUsers, createUser, setUserStatus, deleteUser, requireRole };
