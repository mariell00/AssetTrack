// features/reports/services.js — joins assets + inventory_logs into a
// consolidated dataset for the report generators, plus a lightweight
// preview (counts only, no PDF/Excel work) for the Reports screen's
// live "Report Preview" panel.
const { getDb } = require('../../core/database');

// The Room field defaults to the literal text "ALL ROOMS" in the UI (not
// an empty string), and Status defaults to "ALL" — both mean "no filter".
function buildFilter({ room, status }) {
  const clauses = [];
  const params = {};
  if (room && room.trim() && room.trim().toUpperCase() !== 'ALL ROOMS') {
    clauses.push('r.name = @room');
    params.room = room.trim();
  }
  if (status && status !== 'ALL') {
    clauses.push('a.status = @status');
    params.status = status;
  }
  return { clauses, params };
}

function auditData({ fromDate, toDate, room, status } = {}) {
  const db = getDb();
  const { clauses, params } = buildFilter({ room, status });
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;

  const sql = `
    SELECT
      a.asset_tag, a.name, a.category, a.condition, a.value_php, a.status,
      r.name AS room_name,
      MAX(l.scanned_at) AS last_verified,
      (SELECT COUNT(*) FROM inventory_logs l2
        WHERE l2.asset_id = a.id AND l2.status = 'missing') AS missing_flags
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN inventory_logs l ON l.asset_id = a.id
      ${fromDate ? "AND date(l.scanned_at) >= date(@fromDate)" : ''}
      ${toDate ? "AND date(l.scanned_at) <= date(@toDate)" : ''}
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    GROUP BY a.id
    ORDER BY r.name, a.name
  `;
  return db.prepare(sql).all(params);
}

// Cheap summary used by the Report Preview panel — reuses auditData's
// filtering so the preview always matches what Generate PDF / Export
// Excel will actually produce.
function previewCounts({ fromDate, toDate, room, status } = {}) {
  const rows = auditData({ fromDate, toDate, room, status });
  const roomsCount = new Set(rows.map((r) => r.room_name).filter(Boolean)).size;

  let dateRangeDays = null;
  if (fromDate && toDate) {
    const days = Math.round((new Date(toDate) - new Date(fromDate)) / 86400000);
    dateRangeDays = Number.isFinite(days) ? Math.max(0, days) : null;
  }

  return {
    total_records: rows.length,
    date_range_days: dateRangeDays,
    rooms_count: roomsCount,
    status: status && status !== 'ALL' ? status.toUpperCase() : 'ALL'
  };
}

module.exports = { auditData, previewCounts };
