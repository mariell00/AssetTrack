// features/auth/routes.js — POST /api/v1/auth/login, user management.
const express = require('express');
const router = express.Router();
const { login, listUsers, createUser, setUserStatus, deleteUser, requireRole } = require('./services');

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
  res.json({ ok: true, users: listUsers({ search: req.query.search }) });
});

router.post('/users', requireRole('admin'), (req, res) => {
  const { username, password, role, assigned_area } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username and password are required.' });
  }
  const user = createUser(username, password, role || 'staff', assigned_area || null);
  res.status(201).json({ ok: true, user });
});

router.patch('/users/:id/status', requireRole('admin'), (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ ok: false, error: "status must be 'active' or 'inactive'." });
  }
  res.json(setUserStatus(req.params.id, status));
});

router.delete('/users/:id', requireRole('admin'), (req, res) => {
  res.json(deleteUser(req.params.id));
});

module.exports = router;
