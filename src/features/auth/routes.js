// features/auth/routes.js — POST /api/v1/auth/login, user management.
const express = require('express');
const router = express.Router();
const { login, listUsers, createUser, setUserStatus, deleteUser, requireRole } = require('./services');
const { simplifyUserAgent } = require('../../core/device');
const recovery = require('./recovery');

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
  // The superadmin may only sign in from the Admin Hub window on this computer.
  const isLocalDesktop = source === 'desktop' && recovery.isDesktopRequest(req);
  const result = login(username, password, { source, ip: req.ip, device, isLocalDesktop });
  if (!result.ok) return res.status(401).json(result);
  res.json(result);
});

// ---- Superadmin recovery (emailed one-time code) --------------------------
// These two are reachable WITHOUT a token (that's the point — you're locked
// out), so they're restricted to the Admin Hub window on this computer: the
// LAN, the mobile app and the public tunnel all get a 403. See recovery.js.
function desktopOnly(req, res, next) {
  if (!recovery.isDesktopRequest(req)) {
    return res.status(403).json({ ok: false, error: 'Password recovery is only available on the computer running AssetTrack.' });
  }
  next();
}
function sendRecoveryResult(res, result) {
  const { status, ...body } = result;
  res.status(status || 200).json(body);
}

router.post('/recovery/request', desktopOnly, async (req, res) => {
  try {
    sendRecoveryResult(res, await recovery.requestCode({ ip: req.ip }));
  } catch (err) {
    console.error('[auth] recovery request failed:', err);
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

router.post('/recovery/reset', desktopOnly, (req, res) => {
  try {
    const { code, username, password } = req.body || {};
    sendRecoveryResult(res, recovery.resetWithCode({ code, username, password }));
  } catch (err) {
    console.error('[auth] recovery reset failed:', err);
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

// Account management belongs to the superadmin (desktop app) alone.
router.get('/users', requireRole('superadmin'), (req, res) => {
  res.json({ ok: true, users: listUsers({ search: req.query.search, role: req.query.role }) });
});

router.post('/users', requireRole('superadmin'), (req, res) => {
  const { username, password, role, assigned_area } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username and password are required.' });
  }
  if (role && role !== 'admin') {
    return res.status(400).json({ ok: false, error: "Only 'admin' accounts can be created." });
  }
  try {
    const user = createUser(String(username).trim(), password, 'admin', assigned_area || null);
    res.status(201).json({ ok: true, user });
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) return res.status(409).json({ ok: false, error: `The user name “${username}” is already taken.` });
    throw err;
  }
});

router.patch('/users/:id/status', requireRole('superadmin'), (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ ok: false, error: "status must be 'active' or 'inactive'." });
  }
  const result = setUserStatus(req.params.id, status, req.user.id);
  res.status(result.ok ? 200 : (result.status || 400)).json(result);
});

router.delete('/users/:id', requireRole('superadmin'), (req, res) => {
  const result = deleteUser(req.params.id, req.user.id);
  res.status(result.ok ? 200 : (result.status || 400)).json(result);
});

module.exports = router;
