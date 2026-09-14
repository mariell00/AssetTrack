// features/mapping/routes.js — data for the real Leaflet-based Cluster Map
// (GET /rooms), and setting a room's pin location by clicking the map
// (PUT /rooms/:id/location).
const express = require('express');
const router = express.Router();
const svc = require('./services');

router.get('/rooms', (req, res) => {
  res.json({ ok: true, rooms: svc.roomsWithAssets() });
});

router.put('/rooms/:id/location', (req, res) => {
  const { latitude, longitude } = req.body || {};
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ ok: false, error: 'latitude and longitude (numbers) are required.' });
  }
  res.json(svc.setRoomLocation(req.params.id, latitude, longitude));
});

module.exports = router;
