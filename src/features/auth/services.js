// features/auth/services.js — login logic + role verification.
//
// Two roles, each tied to exactly one app:
//   superadmin — the single owner account. Signs in to the DESKTOP app only,
//                and only from the computer running it.
//   admin      — everyone else. Signs in to the MOBILE app only.
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

  // Right password, wrong app. Checked after the password so a stranger can't
  // use this message to find out which user names exist.
  const wrongApp = checkAppAccess(user.role, source, meta.isLocalDesktop);
  if (wrongApp) {
    logEvent('AUTH', `Blocked ${user.role} login for "${user.username}" (${source}): ${wrongApp}`, 'alert');
    return { ok: false, error: wrongApp };
  }

  db.prepare(
    "UPDATE users SET last_active = datetime('now'), last_login_source = ?, last_login_ip = ?, last_login_device = ? WHERE id = ?"
  ).run(source, ip, device, user.id);

  const label = source === 'mobile' ? 'Mobile login' : 'Superadmin login';
  logEvent('AUTH', `${label}: user=${user.username.toUpperCase()}${device ? ` · ${device}` : ''}${ip ? ` from ${ip}` : ''}`, 'success');

  const token = issueToken({ id: user.id, username: user.username, role: user.role, source });
  return {
    ok: true,
    token,
    user: {
      id: user.id, username: user.username, role: user.role, last_login_source: source,
      is_superadmin: user.role === 'superadmin'
    }
  };
}

// Returns an error message if this role may not sign in from this app, else null.
// `isLocalDesktop` = the request came from the Admin Hub window on this computer
// (loopback, no proxy) — the LAN and the public tunnel never count.
function checkAppAccess(role, source, isLocalDesktop) {
  if (role === 'superadmin') {
    if (source !== 'desktop' || !isLocalDesktop) {
      return 'The super admin signs in to the AssetTrack desktop app only, on the computer that runs it.';
    }
    return null;
  }
  if (source !== 'mobile') {
    return 'Admin accounts sign in from the AssetTrack mobile app only.';
  }
  return null;
}

// The superadmin is the one account with role 'superadmin' (the database
// allows only one — see the unique index in models.js).
function getSuperadminId() {
  const row = getDb().prepare("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1").get();
  return row ? Number(row.id) : null;
}

// `role` filter: 'superadmin' or 'admin'. Omit it for everyone (the Manage
// Admins list shows the superadmin first, then the admins).
function listUsers({ search, role } = {}) {
  const db = getDb();
  let sql = 'SELECT id, username, role, status, assigned_area, last_active, last_login_source, last_login_ip, last_login_device, created_at FROM users WHERE 1=1';
  const params = [];
  if (role === 'superadmin' || role === 'admin') { sql += ' AND role = ?'; params.push(role); }
  if (search) { sql += ' AND username LIKE ?'; params.push(`%${search}%`); }
  // Superadmin first, then A–Z.
  sql += ' ORDER BY username COLLATE NOCASE';
  const superId = getSuperadminId();
  const users = db.prepare(sql).all(...params).map((u) => ({ ...u, is_superadmin: Number(u.id) === superId }));
  return users.sort((a, b) => Number(b.is_superadmin) - Number(a.is_superadmin));
}

// Only admins can be created: the superadmin is the one seeded account.
function createUser(username, password, role = 'admin', assignedArea = null) {
  if (role !== 'admin') throw new Error("Only 'admin' accounts can be created.");
  const db = getDb();
  const hash = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, assigned_area) VALUES (?, ?, ?, ?)')
    .run(username, hash, role, assignedArea);
  return { id: info.lastInsertRowid, username, role, assigned_area: assignedArea, status: 'active' };
}

// The superadmin account can't be deactivated or deleted from the UI, and
// nobody can switch off or delete the account they're currently using —
// either would risk locking the owner out of the desktop app.
function guardAccount(id, actingUserId, verb) {
  const target = getDb().prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!target) return { ok: false, status: 404, error: 'Account not found.' };
  if (Number(target.id) === getSuperadminId()) {
    return { ok: false, status: 403, error: `The super admin account can't be ${verb}.` };
  }
  if (Number(target.id) === Number(actingUserId)) {
    return { ok: false, status: 403, error: `You can't ${verb.replace(/d$/, '')} your own account.` };
  }
  return null;
}

function setUserStatus(id, status, actingUserId) {
  if (status === 'inactive') {
    const blocked = guardAccount(id, actingUserId, 'deactivated');
    if (blocked) return blocked;
  }
  const db = getDb();
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  return { ok: true, id: Number(id), status };
}

function deleteUser(id, actingUserId) {
  const blocked = guardAccount(id, actingUserId, 'deleted');
  if (blocked) return blocked;
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { ok: true };
}

// requireRole now lives in core/security.js (it's used app-wide, not just
// by auth — re-exported here so auth/routes.js doesn't need to change).
const { requireRole } = require('../../core/security');

module.exports = { login, listUsers, createUser, setUserStatus, deleteUser, getSuperadminId, requireRole };
