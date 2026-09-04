// features/reports/routes.js — GET /api/v1/reports/download?format=pdf|xlsx, GET /api/v1/reports/preview
const express = require('express');
const router = express.Router();
const { auditData, previewCounts } = require('./services');
const { generatePdfReport, generateExcelReport } = require('./generators');

router.get('/preview', (req, res) => {
  const { from, to, room, status } = req.query;
  res.json({ ok: true, preview: previewCounts({ fromDate: from || null, toDate: to || null, room, status }) });
});

router.get('/download', async (req, res) => {
  const { from, to, room, status, format } = req.query;
  const rows = auditData({ fromDate: from || null, toDate: to || null, room, status });

  try {
    require('../system/services').logEvent(
      'EXPORT', `${format === 'xlsx' ? 'Excel' : 'PDF'} report generated: ${rows.length} records`, 'success'
    );

    if (format === 'xlsx') {
      const buffer = await generateExcelReport(rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assettrack-audit.xlsx"');
      return res.send(buffer);
    }
    const buffer = await generatePdfReport(rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="assettrack-audit.pdf"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Report generation failed: ' + err.message });
  }
});

module.exports = router;
