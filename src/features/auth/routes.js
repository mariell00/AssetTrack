// features/auth/routes.js — POST /api/v1/auth/login, user management.
const express = require('express');
const router = express.Router();
const { login, listUsers, createUser, requireRole } = require('./services');

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username and password are required.' });
  }
  const result = login(username, password);
  if (!result.ok) return res.status(401).json(result);
  res.json(result);
});

router.get('/users', requireRole('admin'), (req, res) => {
  res.json({ ok: true, users: listUsers() });
});

router.post('/users', requireRole('admin'), (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username and password are required.' });
  }
  const user = createUser(username, password, role || 'staff');
  res.status(201).json({ ok: true, user });
});

module.exports = router;
