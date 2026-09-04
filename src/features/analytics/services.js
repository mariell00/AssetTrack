// features/analytics/services.js — aggregates inventory_logs + assets into
// the datasets the "Spatial Analytics" dashboard needs: headline stats, a
// per-building bar chart, and a this-week-vs-last-week activity heatmap.
const { getDb } = require('../../core/database');

function summaryStats() {
  const db = getDb();

  const totalScans7d = db.prepare(`
    SELECT COUNT(*) AS c FROM inventory_logs WHERE scanned_at >= datetime('now', '-7 days')
  `).get().c;

  const totalScansPrev7d = db.prepare(`
    SELECT COUNT(*) AS c FROM inventory_logs
    WHERE scanned_at >= datetime('now', '-14 days') AND scanned_at < datetime('now', '-7 days')
  `).get().c;

  const avgPerDay = Math.round((totalScans7d / 7) * 10) / 10;

  const missingFlags = db.prepare(`
    SELECT COUNT(*) AS c FROM inventory_logs
    WHERE status = 'missing' AND scanned_at >= datetime('now', '-7 days')
  `).get().c;

  const changePct = totalScansPrev7d === 0
    ? (totalScans7d > 0 ? 100 : 0)
    : Math.round(((totalScans7d - totalScansPrev7d) / totalScansPrev7d) * 100);

  return [
    { label: 'Scans (7 days)', value: String(totalScans7d) },
    { label: 'Avg scans / day', value: String(avgPerDay) },
    { label: 'Missing flags', value: String(missingFlags) },
    { label: 'vs. last week', value: `${changePct >= 0 ? '+' : ''}${changePct}%` }
  ];
}

// Bar chart: total scans in the last 7 days, grouped by building.
function scansByBuilding() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT COALESCE(r.building, 'Unassigned') AS building, COUNT(l.id) AS scans
    FROM inventory_logs l
    LEFT JOIN rooms r ON r.id = l.room_id
    WHERE l.scanned_at >= datetime('now', '-7 days')
    GROUP BY building
    ORDER BY scans DESC
    LIMIT 8
  `).all();
  return rows;
}

// Heatmap: this-week vs last-week scan counts per building (2 rows x N columns,
// matching the wireframe's grid).
function activityHeatmap() {
  const db = getDb();
  const buildings = db.prepare(`
    SELECT DISTINCT COALESCE(building, 'Unassigned') AS building FROM rooms
    UNION SELECT 'Unassigned' WHERE NOT EXISTS (SELECT 1 FROM rooms)
    LIMIT 8
  `).all().map((r) => r.building);

  const countFor = (building, fromDays, toDays) => db.prepare(`
    SELECT COUNT(*) AS c FROM inventory_logs l
    LEFT JOIN rooms r ON r.id = l.room_id
    WHERE COALESCE(r.building, 'Unassigned') = ?
      AND l.scanned_at >= datetime('now', ?)
      AND l.scanned_at < datetime('now', ?)
  `).get(building, `-${fromDays} days`, `-${toDays} days`).c;

  const thisWeek = buildings.map((b) => countFor(b, 7, 0));
  const lastWeek = buildings.map((b) => countFor(b, 14, 7));

  return { buildings, rows: [{ label: 'This week', values: thisWeek }, { label: 'Last week', values: lastWeek }] };
}

module.exports = { summaryStats, scansByBuilding, activityHeatmap };
