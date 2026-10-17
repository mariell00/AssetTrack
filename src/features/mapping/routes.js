// features/mapping/routes.js — Buildings + Rooms management (Locations
// screen) and the building-grouped data for the real Leaflet-based
// Cluster Map. Any authenticated user can read this (staff need the room
// list for scanning/registering assets); creating/editing/deleting
// buildings or rooms is admin-only, same pattern as Manage Users.
const express = require('express');
const router = express.Router();
const svc = require('./services');
const { requireRole } = require('../../core/security');

// ---- Buildings ----------------------------------------------------

router.get('/buildings', (req, res) => {
  res.json({ ok: true, buildings: svc.listBuildings() });
});

router.post('/buildings', requireRole('admin'), (req, res) => {
  const result = svc.createBuilding(req.body || {});
  res.status(result.ok ? 201 : 400).json(result);
});

router.put('/buildings/:id', requireRole('admin'), (req, res) => {
  res.json(svc.updateBuilding(req.params.id, req.body || {}));
});

router.put('/buildings/:id/location', requireRole('admin'), (req, res) => {
  const { latitude, longitude } = req.body || {};
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ ok: false, error: 'latitude and longitude (numbers) are required.' });
  }
  res.json(svc.setBuildingLocation(req.params.id, latitude, longitude));
});

router.delete('/buildings/:id', requireRole('admin'), (req, res) => {
  res.json(svc.deleteBuilding(req.params.id));
});

// ---- Rooms ----------------------------------------------------
// Lightweight list (id, name, floor, building) — used by the Locations
// screen table and by the Asset Registry / mobile ROOM dropdowns.

router.get('/rooms/list', (req, res) => {
  res.json({ ok: true, rooms: svc.listRooms() });
});

router.post('/rooms', requireRole('admin'), (req, res) => {
  const result = svc.createRoom(req.body || {});
  res.status(result.ok ? 201 : 400).json(result);
});

router.put('/rooms/:id', requireRole('admin'), (req, res) => {
  res.json(svc.updateRoom(req.params.id, req.body || {}));
});

router.delete('/rooms/:id', requireRole('admin'), (req, res) => {
  res.json(svc.deleteRoom(req.params.id));
});

// ---- Cluster Map ----------------------------------------------------
// One pin per building; each entry's `rooms` breaks its assets down by
// room for the hover tooltip / detail panel.

router.get('/buildings-map', (req, res) => {
  res.json({ ok: true, buildings: svc.buildingsForMap() });
});

router.get('/assets-map', (req, res) => {
  res.json({ ok: true, assets: svc.assetsForMap() });
});

module.exports = router;
