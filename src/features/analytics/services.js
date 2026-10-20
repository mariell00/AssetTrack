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

// ---- Dashboard (header screen) ----------------------------------------
// Everything the redesigned Dashboard needs in one round trip:
//   monthly - distinct assets verified per calendar month, last 12 months
//             (months with no scans are returned as 0 so the chart has no gaps)
//   status  - asset counts for the progress bars. pendingSync uses the same
//             definition as assets/services.js dashboardStats(): assets not
//             verified yet today. active/maintenance/offline are the asset's
//             own status field.
//   logs    - latest scans as spreadsheet rows (where, which asset, result,
//             who it is assigned to, who scanned it)
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthlyVerified(months = 12) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', scanned_at) AS ym, COUNT(DISTINCT asset_id) AS verified
    FROM inventory_logs
    WHERE status = 'verified' AND scanned_at >= datetime('now', 'start of month', ?)
    GROUP BY ym
  `).all(`-${months - 1} months`);
  const byMonth = new Map(rows.map((r) => [r.ym, r.verified]));

  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ month: ym, label: MONTH_LABELS[d.getUTCMonth()], year: d.getUTCFullYear(), verified: byMonth.get(ym) || 0 });
  }
  return out;
}

function statusBreakdown() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) AS c FROM assets').get().c;
  const verifiedToday = db.prepare(`
    SELECT COUNT(DISTINCT asset_id) AS c FROM inventory_logs
    WHERE status = 'verified' AND date(scanned_at) = date('now')
  `).get().c;
  const counts = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS c FROM assets GROUP BY status').all().map((r) => [r.status, r.c])
  );
  return {
    total,
    verifiedToday,
    pendingSync: Math.max(0, total - verifiedToday),
    awaitingReview:
      db.prepare("SELECT COUNT(*) AS c FROM pending_scans WHERE review_status = 'pending'").get().c +
      db.prepare("SELECT COUNT(*) AS c FROM pending_registrations WHERE review_status = 'pending'").get().c,
    active: counts.active || 0,
    maintenance: counts.maintenance || 0,
    offline: counts.offline || 0
  };
}

function recentScanRows(limit = 100) {
  const db = getDb();
  return db.prepare(`
    SELECT l.id, l.scanned_at, l.status AS scan_status, l.scanned_by,
           a.asset_tag, a.name AS asset_name, a.status AS asset_status, a.assigned_to,
           COALESCE(b.name, r.building) AS building, r.name AS room
    FROM inventory_logs l
    JOIN assets a ON a.id = l.asset_id
    LEFT JOIN rooms r ON r.id = COALESCE(l.room_id, a.room_id)
    LEFT JOIN buildings b ON b.id = r.building_id
    ORDER BY l.id DESC
    LIMIT ?
  `).all(limit);
}

function dashboardSummary() {
  return { monthly: monthlyVerified(12), status: statusBreakdown(), logs: recentScanRows(100) };
}

module.exports = { summaryStats, scansByBuilding, activityHeatmap, dashboardSummary };
