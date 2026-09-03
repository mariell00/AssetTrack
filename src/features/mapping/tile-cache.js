// features/mapping/tile-cache.js — pre-downloads OpenStreetMap tiles for the
// configured bounding box and stores them as .png files under
// /src/static/map_tiles/{z}/{x}/{y}.png so Leaflet can run fully offline.
//
// Run manually (with internet access) BEFORE going fully offline:
//   npm run tiles:fetch
//
// This only needs to be run once per campus / per zoom-level set — after
// that the .db-style tile folder ships inside the portable app folder.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadConfig } = require('../../core/config');

const TILE_ROOT = path.join(__dirname, '..', '..', 'static', 'map_tiles');
const TILE_SERVER = 'https://tile.openstreetmap.org'; // swap for your own tile server if you have one

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}
function latToTileY(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

function downloadTile(z, x, y) {
  return new Promise((resolve, reject) => {
    const dir = path.join(TILE_ROOT, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${y}.png`);
    if (fs.existsSync(dest)) return resolve(); // already cached

    const url = `${TILE_SERVER}/${z}/${x}/${y}.png`;
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { 'User-Agent': 'AssetTrack-Offline-Cache/1.0' } }, (response) => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`Tile ${z}/${x}/${y} failed: HTTP ${response.statusCode}`));
        }
        response.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (err) => { file.close(); reject(err); });
  });
}

async function fetchBoundingBox(bbox) {
  const { minLat, minLng, maxLat, maxLng, zoomLevels } = bbox;
  let total = 0;

  for (const z of zoomLevels) {
    const xMin = lonToTileX(minLng, z);
    const xMax = lonToTileX(maxLng, z);
    const yMin = latToTileY(maxLat, z); // note: y is inverted vs latitude
    const yMax = latToTileY(minLat, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        try {
          await downloadTile(z, x, y);
          total++;
          if (total % 20 === 0) console.log(`[tile-cache] ${total} tiles cached...`);
        } catch (err) {
          console.warn(`[tile-cache] skipped ${z}/${x}/${y}: ${err.message}`);
        }
      }
    }
  }
  console.log(`[tile-cache] Done. ${total} tiles cached to ${TILE_ROOT}`);
}

if (require.main === module) {
  const config = loadConfig();
  fetchBoundingBox(config.mapBoundingBox).catch((err) => {
    console.error('[tile-cache] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { fetchBoundingBox, downloadTile };
