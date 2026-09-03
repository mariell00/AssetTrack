// features/mapping/routes.js — GET /api/v1/map/geojson (spatial asset feed).
const express = require('express');
const router = express.Router();
const { getDb } = require('../../core/database');
const { clusterAssets } = require('./cluster');

router.get('/geojson', (req, res) => {
  const db = getDb();
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.latitude, r.longitude, COUNT(a.id) AS asset_count
    FROM rooms r
    LEFT JOIN assets a ON a.room_id = r.id
    WHERE r.latitude IS NOT NULL AND r.longitude IS NOT NULL
    GROUP BY r.id
  `).all();

  const zoom = Number(req.query.zoom) || 16;
  const clusters = clusterAssets(rooms, zoom);

  const geojson = {
    type: 'FeatureCollection',
    features: clusters.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
      properties: { count: c.count, rooms: c.assets.map((r) => r.name) }
    }))
  };

  res.json(geojson);
});

module.exports = router;
