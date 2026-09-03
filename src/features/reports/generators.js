// features/reports/generators.js — exports the audit dataset as PDF (pdf-lib)
// or Excel (ExcelJS). Returns a Buffer; the caller decides how to deliver it
// (download in the renderer, or write to disk).
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const ExcelJS = require('exceljs');

async function generatePdfReport(rows, title = 'AssetTrack Audit Report') {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  const fontBold = await pdf.embedFont(StandardFonts.CourierBold);

  let page = pdf.addPage([612, 792]);
  let y = 740;

  page.drawText(title, { x: 40, y, size: 16, font: fontBold, color: rgb(0.07, 0.09, 0.27) });
  y -= 30;
  page.drawText('TAG        NAME                     ROOM            COND     LAST VERIFIED', {
    x: 40, y, size: 8, font: fontBold
  });
  y -= 14;

  for (const r of rows) {
    if (y < 60) { page = pdf.addPage([612, 792]); y = 740; }
    const line = [
      (r.asset_tag || '').padEnd(10),
      (r.name || '').slice(0, 24).padEnd(24),
      (r.room_name || '—').slice(0, 15).padEnd(15),
      (r.condition || '—').padEnd(8),
      (r.last_verified || 'never')
    ].join(' ');
    page.drawText(line, { x: 40, y, size: 8, font });
    y -= 12;
  }

  return Buffer.from(await pdf.save());
}

async function generateExcelReport(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Audit');
  sheet.columns = [
    { header: 'Asset Tag', key: 'asset_tag', width: 14 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Room', key: 'room_name', width: 18 },
    { header: 'Condition', key: 'condition', width: 12 },
    { header: 'Value (PHP)', key: 'value_php', width: 14 },
    { header: 'Last Verified', key: 'last_verified', width: 20 },
    { header: 'Missing Flags', key: 'missing_flags', width: 14 }
  ];
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  return workbook.xlsx.writeBuffer();
}

module.exports = { generatePdfReport, generateExcelReport };
