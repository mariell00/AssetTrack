// features/reports/services.js — joins assets + inventory_logs into a
// consolidated dataset for the report generators.
const { getDb } = require('../../core/database');

function auditData({ fromDate, toDate } = {}) {
  const db = getDb();
  let sql = `
    SELECT
      a.asset_tag, a.name, a.category, a.condition, a.value_php,
      r.name AS room_name,
      MAX(l.scanned_at) AS last_verified,
      (SELECT COUNT(*) FROM inventory_logs l2
        WHERE l2.asset_id = a.id AND l2.status = 'missing') AS missing_flags
    FROM assets a
    LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN inventory_logs l ON l.asset_id = a.id
      ${fromDate ? "AND date(l.scanned_at) >= date(@fromDate)" : ''}
      ${toDate ? "AND date(l.scanned_at) <= date(@toDate)" : ''}
    GROUP BY a.id
    ORDER BY r.name, a.name
  `;
  return db.prepare(sql).all({ fromDate, toDate });
}

module.exports = { auditData };
