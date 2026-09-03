// features/auth/services.js — login logic + role verification.
// Imports the shared db singleton — never opens its own connection.
const { getDb } = require('../../core/database');
const { verifyPassword, issueToken, hashPassword } = require('../../core/security');

function login(username, password) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return { ok: false, error: 'Invalid username or password.' };

  const valid = verifyPassword(password, user.password_hash);
  if (!valid) return { ok: false, error: 'Invalid username or password.' };

  const token = issueToken({ id: user.id, username: user.username, role: user.role });
  return { ok: true, token, user: { id: user.id, username: user.username, role: user.role } };
}

function listUsers() {
  const db = getDb();
  return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
}

function createUser(username, password, role = 'staff') {
  const db = getDb();
  const hash = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, role);
  return { id: info.lastInsertRowid, username, role };
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

module.exports = { login, listUsers, createUser, requireRole };
