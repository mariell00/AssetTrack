// features/assignees/routes.js — /api/v1/assignees
// Reading the list is open to any signed-in user (mobile admins need it for
// the Assigned To dropdown); changing it is superadmin-only, like Locations.
const express = require('express');
const router = express.Router();
const svc = require('./services');
const { requireRole } = require('../../core/security');

const send = (res, result, okStatus = 200) => {
  const { status, ...body } = result;
  res.status(result.ok ? okStatus : (status || 400)).json(body);
};

router.get('/', (req, res) => {
  res.json({ ok: true, assignees: svc.listAssignees({ search: req.query.search, status: req.query.status }) });
});

router.post('/', requireRole('superadmin'), (req, res) => send(res, svc.createAssignee(req.body || {}), 201));
router.put('/:id', requireRole('superadmin'), (req, res) => send(res, svc.updateAssignee(req.params.id, req.body || {})));
router.delete('/:id', requireRole('superadmin'), (req, res) => send(res, svc.deleteAssignee(req.params.id)));

module.exports = router;
