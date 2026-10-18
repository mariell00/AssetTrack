// features/mapping/tile-cache.js — downloads map tiles for the configured
// bounding box and stores them as .png files under
// /src/static/map_tiles/{z}/{x}/{y}.png so Leaflet can run fully offline.
//
// Run manually (with internet access) BEFORE going fully offline:
//   npm run tiles:fetch
//
// IMPORTANT — why this needs settings.json's tileProvider configured:
// This used to hit https://tile.openstreetmap.org directly in a bulk loop.
// That directly violates OpenStreetMap's tile usage policy (bulk/scripted
// downloading is explicitly banned — see
// https://operations.osmfoundation.org/policies/tiles/), and their servers
// detect it automatically. When they do, they don't just refuse with a
// clean HTTP error — they return a real (HTTP 200) image tile that visibly
// says "403 Access blocked", specifically so it keeps rendering in-map
// instead of failing loudly. That blocked-tile image is what this script
// was saving to disk as if it were a normal map tile, which is why the
// Cluster Map started showing rows of yellow-and-black "Access blocked"
// graphics instead of a real campus map.
//
// The fix: use a real tile provider meant for embedding in an app, with an
// API key (e.g. MapTiler's free tier — https://cloud.maptiler.com). Set
// tileProvider.urlTemplate and tileProvider.apiKey in settings.json first;
// this script refuses to run without them rather than silently falling
// back to the same bulk-scraping that got blocked before.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadConfig } = require('../../core/config');

const TILE_ROOT = path.join(__dirname, '..', '..', 'static', 'map_tiles');

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}
function latToTileY(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

function buildTileUrl(urlTemplate, apiKey, z, x, y) {
  return urlTemplate
    .replace('{z}', z).replace('{x}', x).replace('{y}', y)
    .replace('{key}', encodeURIComponent(apiKey || ''));
}

function downloadTile(urlTemplate, apiKey, z, x, y) {
  return new Promise((resolve, reject) => {
    const dir = path.join(TILE_ROOT, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${y}.png`);
    if (fs.existsSync(dest)) return resolve('cached'); // already have it

    const url = buildTileUrl(urlTemplate, apiKey, z, x, y);
    https
      .get(url, { headers: { 'User-Agent': 'AssetTrack-NBSC-Offline-Cache/1.0 (student capstone project)' } }, (response) => {
        if (response.statusCode !== 200) {
          response.resume(); // drain so the socket can close
          return reject(new Error(`Tile ${z}/${x}/${y} failed: HTTP ${response.statusCode}`));
        }
        const contentType = response.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
          response.resume();
          return reject(new Error(`Tile ${z}/${x}/${y} returned non-image content (${contentType}) — provider may have rejected the request.`));
        }
        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve('downloaded')));
        file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
      })
      .on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBoundingBox(bbox, tileProvider) {
  if (!tileProvider || !tileProvider.urlTemplate) {
    console.error(
      '[tile-cache] No tile provider configured in settings.json (tileProvider.urlTemplate is empty).\n' +
      '[tile-cache] Bulk-downloading straight from tile.openstreetmap.org is against their usage policy and\n' +
      '[tile-cache] gets your IP blocked (see the comment at the top of this file) — that\'s most likely why\n' +
      '[tile-cache] you\'re seeing "Access blocked" tile images on the Cluster Map right now.\n' +
      '[tile-cache] Sign up for a free key at https://cloud.maptiler.com, then set tileProvider.urlTemplate\n' +
      '[tile-cache] and tileProvider.apiKey in settings.json and re-run this.'
    );
    process.exitCode = 1;
    return;
  }

  const { minLat, minLng, maxLat, maxLng, zoomLevels } = bbox;
  let downloaded = 0;
  let cached = 0;
  let failed = 0;

  for (const z of zoomLevels) {
    const xMin = lonToTileX(minLng, z);
    const xMax = lonToTileX(maxLng, z);
    const yMin = latToTileY(maxLat, z); // note: y is inverted vs latitude
    const yMax = latToTileY(minLat, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        try {
          const outcome = await downloadTile(tileProvider.urlTemplate, tileProvider.apiKey, z, x, y);
          if (outcome === 'downloaded') {
            downloaded++;
            await sleep(150); // a little politeness between requests, even to a paid/keyed provider
          } else {
            cached++;
          }
          if ((downloaded + cached) % 20 === 0) console.log(`[tile-cache] ${downloaded + cached} tiles processed...`);
        } catch (err) {
          failed++;
          console.warn(`[tile-cache] skipped ${z}/${x}/${y}: ${err.message}`);
        }
      }
    }
  }
  console.log(`[tile-cache] Done. ${downloaded} downloaded, ${cached} already cached, ${failed} failed. Saved under ${TILE_ROOT}`);
  if (failed > 0) {
    console.log('[tile-cache] Some tiles failed — check your API key/quota with the provider if this number is large.');
  }
}

if (require.main === module) {
  const config = loadConfig();
  fetchBoundingBox(config.mapBoundingBox, config.tileProvider).catch((err) => {
    console.error('[tile-cache] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { fetchBoundingBox, downloadTile };
