// features/auth/services.js — login logic + role verification.
// Imports the shared db singleton — never opens its own connection.
const { getDb } = require('../../core/database');
const { verifyPassword, issueToken, hashPassword } = require('../../core/security');

function login(username, password) {
  const db = getDb();
  const { logEvent } = require('../system/services');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) { logEvent('AUTH', `Failed login attempt for "${username}"`, 'alert'); return { ok: false, error: 'Invalid username or password.' }; }
  if (user.status === 'inactive') return { ok: false, error: 'This account has been deactivated.' };

  const valid = verifyPassword(password, user.password_hash);
  if (!valid) { logEvent('AUTH', `Failed login attempt for "${username}"`, 'alert'); return { ok: false, error: 'Invalid username or password.' }; }

  db.prepare("UPDATE users SET last_active = datetime('now') WHERE id = ?").run(user.id);
  logEvent('AUTH', `Admin login: user=${user.username.toUpperCase()}`, 'success');

  const token = issueToken({ id: user.id, username: user.username, role: user.role });
  return { ok: true, token, user: { id: user.id, username: user.username, role: user.role } };
}

function listUsers({ search } = {}) {
  const db = getDb();
  let sql = 'SELECT id, username, role, status, assigned_area, last_active, created_at FROM users';
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

function requireRole(role) {
  return (req, res, next) => {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    const { verifyToken } = require('../../core/security');
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    if (role && payload.role !== role && payload.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Forbidden.' });
    }
    req.user = payload;
    next();
  };
}

module.exports = { login, listUsers, createUser, setUserStatus, deleteUser, requireRole };
