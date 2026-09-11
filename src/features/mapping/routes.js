// features/mapping/routes.js — GET /api/v1/map/geojson (spatial asset feed),
// GET /api/v1/map/config (campus center/bounds, so the frontend never
// hardcodes coordinates — settings.json's mapBoundingBox stays the single
// source of truth).
const express = require('express');
const router = express.Router();
const { getDb } = require('../../core/database');
const { clusterAssets } = require('./cluster');
const { loadConfig } = require('../../core/config');

router.get('/geojson', (req, res) => {
  const db = getDb();
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.latitude, r.longitude, COUNT(a.id) AS asset_count
    FROM rooms r
    LEFT JOIN assets a ON a.room_id = r.id
    WHERE r.latitude IS NOT NULL AND r.longitude IS NOT NULL
    GROUP BY r.id
  `).all();

  // Attach each room's verification % (same figure the Inventory screen
  // shows — see inventory/services.js#roomProgress) so clusters on the map
  // can use the same green/amber/red tiers as the rest of the app, instead
  // of a second, disconnected definition of "synced."
  const { roomProgress } = require('../inventory/services');
  const roomsWithProgress = rooms.map((r) => ({ ...r, pct: roomProgress(r.id).pct }));

  const zoom = Number(req.query.zoom) || 16;
  const clusters = clusterAssets(roomsWithProgress, zoom);

  const geojson = {
    type: 'FeatureCollection',
    features: clusters.map((c) => {
      const avgPct = Math.round(c.assets.reduce((sum, r) => sum + r.pct, 0) / c.assets.length);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
        properties: {
          count: c.count,
          pct: avgPct,
          rooms: c.assets.map((r) => ({ id: r.id, name: r.name, asset_count: r.asset_count, pct: r.pct }))
        }
      };
    })
  };

  res.json(geojson);
});

router.get('/config', (req, res) => {
  const config = loadConfig();
  const bb = config.mapBoundingBox || {};
  const center = {
    lat: ((bb.minLat ?? 0) + (bb.maxLat ?? 0)) / 2,
    lng: ((bb.minLng ?? 0) + (bb.maxLng ?? 0)) / 2
  };
  const zoomLevels = bb.zoomLevels && bb.zoomLevels.length ? bb.zoomLevels : [15, 16, 17, 18];
  res.json({
    ok: true,
    center,
    bounds: [[bb.minLat, bb.minLng], [bb.maxLat, bb.maxLng]],
    minZoom: zoomLevels[0],
    maxZoom: zoomLevels[zoomLevels.length - 1],
    defaultZoom: zoomLevels[Math.floor(zoomLevels.length / 2)]
  });
});

module.exports = router;
