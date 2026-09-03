// features/mapping/cluster.js — proximity grouping so the map doesn't render
// hundreds of overlapping pins; simple grid-based clustering + centroid math.
function clusterAssets(assets, zoom) {
  // Coarser grid at low zoom, finer grid as you zoom in.
  const gridSize = Math.max(0.0005, 0.02 / Math.pow(2, zoom - 14));
  const buckets = new Map();

  for (const a of assets) {
    if (a.latitude == null || a.longitude == null) continue;
    const gx = Math.round(a.latitude / gridSize);
    const gy = Math.round(a.longitude / gridSize);
    const key = `${gx}:${gy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(a);
  }

  const clusters = [];
  for (const group of buckets.values()) {
    const lat = group.reduce((sum, a) => sum + a.latitude, 0) / group.length;
    const lng = group.reduce((sum, a) => sum + a.longitude, 0) / group.length;
    clusters.push({ latitude: lat, longitude: lng, count: group.length, assets: group });
  }
  return clusters;
}

module.exports = { clusterAssets };
