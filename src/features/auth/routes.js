// features/auth/routes.js — POST /api/v1/auth/login, user management.
const express = require('express');
const router = express.Router();
const { login, listUsers, createUser, setUserStatus, deleteUser, requireRole } = require('./services');
const { simplifyUserAgent } = require('../../core/device');

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username and password are required.' });
  }
  // The mobile PWA's api-client sends 'X-Client-Type: mobile' on every
  // request; the Admin Hub sends none, so it falls back to 'desktop' in
  // login(). This is how one shared /auth/login route tells the two
  // clients apart for the activity log and the Manage Users screen.
  const source = (req.headers['x-client-type'] || '').toLowerCase() === 'mobile' ? 'mobile' : 'desktop';
  const device = simplifyUserAgent(req.headers['user-agent']);
  const result = login(username, password, { source, ip: req.ip, device });
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
