// features/assets/importer.js — reads an uploaded .csv / .xlsx and turns every row into a
// registry record WITHOUT losing what the file says.
//
// Built around the property custodian sheet ("ACUESA ... as of Sept 9"):
//   Date Acquired | ICS No. | Property No. | Item Description | Eul | Qty. | End-User | Amount
// but any file whose headers resemble the registry's own fields works as well.
//
// Principles
//   * Nothing is dropped. A column the registry has no field for is kept in `remarks`
//     ("Header: value"); a value that cannot be read (an unreadable date, a non-numeric
//     amount) is kept in `remarks` exactly as written, never silently discarded.
//   * CSV text is parsed here (not by the spreadsheet library) so every cell stays text:
//     no 'Property No.' turned into a number, no scientific notation, no guessed dates.
//   * The file's encoding is detected (UTF-8 / UTF-8 with BOM / UTF-16 / Windows-1252).
//   * Every row gets a stable id made from its own content, so uploading the same file
//     again recognises the rows instead of adding them twice.
const crypto = require('crypto');

// ---------------------------------------------------------------- reading the file

function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return buffer.slice(3).toString('utf8');
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) return buffer.slice(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const swapped = Buffer.from(buffer.slice(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { /* not UTF-8 */ }
  return new TextDecoder('windows-1252').decode(buffer); // what Excel's "CSV (Comma delimited)" writes
}

// RFC-4180 parser: quotes, doubled quotes, delimiters and line breaks inside a quoted cell.
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === delimiter) { pushCell(); i++; continue; }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; pushRow(); i++; continue; }
    if (ch === '\n') { pushRow(); i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) pushRow();
  return rows;
}

// Comma, semicolon (many Excel locales), tab or pipe — whichever the first lines use most.
function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  let best = ',';
  let bestCount = -1;
  for (const d of [',', ';', '\t', '|']) {
    let count = 0;
    let inQuotes = false;
    for (const ch of sample) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === d) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

// -> array of rows, each an array of cell values (strings for CSV; strings/numbers/Dates for xlsx)
function readGrid(buffer) {
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B;          // .xlsx / .xlsm
  const isOle = buffer.length > 4 && buffer[0] === 0xD0 && buffer[1] === 0xCF;          // old .xls
  if (isZip || isOle) {
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    let best = null;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
      const score = findHeaderRow(grid).score;
      if (!best || score > best.score) best = { grid, score, name, dateCode: XLSX.SSF && XLSX.SSF.parse_date_code };
    }
    return { grid: best ? best.grid : [], sheetName: best && best.name, format: 'xlsx', dateCode: best && best.dateCode };
  }
  const text = decodeText(buffer);
  return { grid: parseDelimited(text, detectDelimiter(text)), sheetName: null, format: 'csv' };
}

// ---------------------------------------------------------------- column mapping

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const FIELD_ALIASES = {
  asset_tag:     ['assettag', 'assetid', 'tag', 'id', 'assetno', 'assetnumber', 'assetcode'],
  name:          ['name', 'assetname', 'itemname', 'item', 'article'],
  description:   ['description', 'itemdescription', 'particulars', 'specification', 'specifications', 'details', 'notes'],
  category:      ['category', 'type', 'assettype', 'class'],
  condition:     ['condition'],
  room_name:     ['room', 'location', 'office', 'roomname'],
  assigned_to:   ['assignedto', 'assigned', 'assignee', 'enduser', 'accountableofficer', 'custodian', 'user', 'issuedto', 'receivedby'],
  status:        ['status'],
  acquired_date: ['dateacquired', 'acquired', 'acquisitiondate', 'dateofacquisition', 'purchasedate', 'dateofpurchase', 'date'],
  ics_no:        ['icsno', 'ics', 'icsnumber', 'icsnum', 'inventorycustodianslip'],
  property_no:   ['propertyno', 'propertynumber', 'propno', 'propertyid', 'propertycode', 'parno'],
  serial_no:     ['serialno', 'serialnumber', 'serial', 'sn', 'serialnum'],
  useful_life:   ['eul', 'estimatedusefullife', 'usefullife', 'lifespan', 'life'],
  quantity:      ['qty', 'quantity', 'noofunits', 'units', 'qnty'],
  value_php:     ['amount', 'value', 'valuephp', 'unitcost', 'cost', 'price', 'acquisitioncost', 'totalcost'],
  remarks:       ['remarks', 'remark', 'comments', 'comment']
};

function mapHeader(header) {
  const n = norm(header);
  if (!n) return null;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) if (aliases.includes(n)) return field;
  return null;
}

// The real header may sit under a title block ("ACUESA — as of Sept 9"); pick the row in the
// first 15 that matches the most known column names.
function findHeaderRow(grid) {
  let best = { index: 0, score: 0 };
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const fields = new Set((grid[i] || []).map(mapHeader).filter(Boolean));
    if (fields.size > best.score) best = { index: i, score: fields.size };
  }
  return best;
}

// ---------------------------------------------------------------- cleaning single values

const clean = (v) => String(v ?? '').replace(/[\u00A0\u2007\u202F\u200B]/g, ' ').replace(/\s+/g, ' ').trim();
const isBlank = (v) => v === null || v === undefined || clean(v) === '';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const validYmd = (y, m, d) => {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Reads a date in any form the sheet uses. Returns { value: 'YYYY-MM-DD' | null, note }.
// `hintYear` (the year the Property No. starts with) settles a mistyped year such as 20224.
function parseDate(raw, hintYear, dateCode) {
  if (isBlank(raw)) return { value: null };

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { value: iso(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()) };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // an Excel date serial (45418 = 2024-05-14)
    if (raw > 20000 && raw < 80000) {
      const p = dateCode ? dateCode(raw) : null;
      if (p && validYmd(p.y, p.m, p.d)) return { value: iso(p.y, p.m, p.d) };
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000);
      return { value: iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) };
    }
    return { value: null, note: String(raw) };
  }

  const text = clean(raw);
  let m;
  // 2024-07-08 / 2024-07-08 00:00:00 / 2024/7/8
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/))) {
    if (validYmd(+m[1], +m[2], +m[3])) return { value: iso(+m[1], +m[2], +m[3]) };
  }
  // November 6, 2024 / Nov 6 2024 / October 11,2024 / 6 November 2024
  if ((m = text.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4,5})$/))) {
    return monthDate(m[1], +m[2], m[3], hintYear, text);
  }
  if ((m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{4,5})$/))) {
    return monthDate(m[2], +m[1], m[3], hintYear, text);
  }
  // 11/6/2024 — month first (Excel's US order); a first number above 12 can only be the day
  if ((m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    let a = +m[1]; let b = +m[2]; let y = +m[3];
    if (m[3].length === 2) y += 2000;
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    if (validYmd(y, mo, d)) return { value: iso(y, mo, d) };
  }
  // Excel serial that arrived as text (CSV)
  if (/^\d{5}(\.\d+)?$/.test(text)) return parseDate(Number(text), hintYear, dateCode);

  return { value: null, note: text }; // unreadable: the caller keeps it in remarks
}

const FULL_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
// 1..12 for a month name, tolerating a typo of up to 2 letters in a full name ("Ocotber"); 0 if none.
function monthNumber(word) {
  const w = word.toLowerCase();
  if (FULL_MONTHS.includes(w)) return { mo: FULL_MONTHS.indexOf(w) + 1, fuzzy: false };
  if (MONTHS[w]) return { mo: MONTHS[w], fuzzy: false };
  if (w.length < 5) return { mo: 0 };
  const scored = FULL_MONTHS.map((name, i) => ({ mo: i + 1, name, dist: editDistance(w, name) })).sort((a, b) => a.dist - b.dist);
  return scored[0].dist <= 2 && (scored[1].dist > scored[0].dist) ? { mo: scored[0].mo, fuzzy: true, name: scored[0].name } : { mo: 0 };
}

function monthDate(monthWord, day, yearText, hintYear, original) {
  const found = monthNumber(monthWord);
  const mo = found.mo;
  if (!mo) return { value: null, note: original };
  let year = +yearText;
  let note;
  if (yearText.length === 5) {
    // "September 3, 20224": one digit too many. Try dropping each digit; keep a plausible year,
    // preferring the year the Property No. starts with.
    const options = [...new Set([...yearText].map((_, i) => +(yearText.slice(0, i) + yearText.slice(i + 1))))]
      .filter((y) => y >= 1990 && y <= new Date().getFullYear() + 1);
    year = options.includes(hintYear) ? hintYear : (options.length === 1 ? options[0] : null);
    if (year === null) return { value: null, note: original };
    note = `Date Acquired was typed "${original}" in the file; read as ${year}.`;
  }
  if (found.fuzzy) note = `${note ? `${note} ` : ''}Date Acquired was typed "${original}" in the file; read as ${found.name.charAt(0).toUpperCase()}${found.name.slice(1)} ${day}, ${year}.`;
  return validYmd(year, mo, day) ? { value: iso(year, mo, day), note } : { value: null, note: original };
}

// "₱ 41,000.50" / "41000" / "(1,200)" / "1.234,50" -> number. null when it isn't a number.
function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = clean(raw).replace(/^(php|₱|p|\$)\s*/i, '').replace(/\s*(php|pesos?)$/i, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { negative = true; s = s.slice(1); }
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');      // 1.234,50
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');                                // 12,5
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

// "5 Years" / "4 years" / "5 YEARS" / 5 -> 5.   "18 months" -> 2 (rounded, original kept in remarks).
function parseUsefulLife(raw) {
  if (typeof raw === 'number') return { years: Math.round(raw), exact: Number.isInteger(raw) };
  const text = clean(raw).toLowerCase();
  const m = text.match(/^(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?)?\.?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] && /^m/.test(m[2])) return { years: Math.max(1, Math.round(n / 12)), exact: n % 12 === 0 };
  return { years: Math.round(n), exact: Number.isInteger(n) };
}

// "ICS No : SPHV-2024-08-0258" / "ICS No.2024-02-0249" / "ICS No. SPLV-2025-03-0083A" -> the number
function cleanIcs(raw) {
  const s = clean(raw).replace(/^ics\s*(no|number|#)?\s*[.:#-]*\s*/i, '').trim();
  return s || null;
}

// The serial number is written inside the description ("... Serial Number: 5CD4130DHJ 1 of 1").
function extractSerial(description) {
  const m = description.match(/\b(?:serial\s*(?:number|no\.?|#)?|s\/n|sn)\s*[:#.-]*\s*([A-Za-z0-9][A-Za-z0-9\-_/.]{3,}[A-Za-z0-9])/i);
  return m ? m[1] : null;
}

// A short, readable name from the long description: "HP Laptop 15s-fq5347TU Grey, Intel Core i5 ..." -> "HP Laptop 15s-fq5347TU Grey"
function shortName(description) {
  let s = description.split(/\b(?:serial\s*(?:number|no\.?)?|s\/n|sn)\s*[:#]|\s[-–]\s*(?:s\/n|serial|model|brand|color)\b/i)[0];
  s = s.split(/[,;]/)[0];
  s = s.replace(/\s+\d+\s*of\s*\d+.*$/i, '');
  if (s.length > 80) {
    const cut = s.slice(0, 80);
    s = cut.slice(0, Math.max(cut.lastIndexOf(' '), 40));
  }
  // drop leftovers of a cut: "1-3 of", a dangling "with"/"-", an unclosed "("
  s = s.replace(/\s*\([^)]*$/, '').replace(/\s+\d+(?:\s*-\s*\d+)?\s*of\b.*$/i, '').replace(/(?:\s+(?:with|and|of|for|-|–))+$/i, '');
  s = s.replace(/[\s,;:\-–]+$/, '').trim();
  return s || description.slice(0, 80);
}

// ---------------------------------------------------------------- category guess (only when the file has none)

const CATEGORY_RULES = [
  ['Laptop', /\blaptop\b|\bnotebook\b|macbook|chromebook/i],
  ['Tablet', /\btablet\b|\bipad\b|galaxy tab/i],
  ['Desktop (All-in-One)', /all[\s-]*in[\s-]*one\s+(desktop|pc)|\baio\b|desktop\s*(computer|pc)/i],
  ['Printer', /\bprinter\b/i],
  ['Projector', /\bprojector\b/i],
  ['Scanner', /\bscanner\b/i],
  ['Camera / Drone', /\bcamera\b|\bdrone\b|\bgopro\b|webcam|dslr/i],
  ['Recorder', /\brecorder\b|\bnvr\b|\bdvr\b/i],
  ['Display / TV', /\bsmart tv\b|\btelevision\b|\bled tv\b|\buhdtv\b|\bmonitor\b/i],
  ['External Storage', /external\s+(hard|hdd|ssd|drive|storage)|portable\s*(hard\s*)?(drive|disk)|hard\s*drive|harddrive|flash\s*drive|usb\s*drive|memory card|\bsd card\b/i],
  ['Network / Security', /\brouter\b|access point|\bcctv\b|network switch|\bups\b|\bfirewall\b|\bmodem\b/i],
  ['Appliance', /aircon|air[\s-]*condition|refrigerator|\bfan\b|water dispenser|microwave|rice cooker|kettle|vacuum|coffee\s*maker|\boven\b|\bstove\b/i],
  ['Furniture', /\bchair\b|\btable\b|\bdesk\b|cabinet|shelf|shelves|\brack\b|\bstandee\b|\bpodium\b|\bsofa\b|\bsala set\b|\bseater\b|\bbench\b|\bmonobloc\b|executive|high\s*back/i],
  ['Audio / Visual', /speaker|microphone|\bmic\b|audio|amplifier|\bmixer\b|headset|headphone|xlr|\bhdmi\b|\bcable\b|extension wire|lapel/i],
  ['Office Equipment', /\bshredder\b|laminat|\bstapler\b|calculator|\bbinding\b|paper cutter|\btypewriter\b|\bphotocopier\b/i]
];
function guessCategory(text) {
  for (const [label, re] of CATEGORY_RULES) if (re.test(text)) return label;
  return null;
}

// ---------------------------------------------------------------- end-user names

// "ACUESA, MARY KOREN WITTING - RESEARCH (from Sir Aldwin)"
//  -> { name: 'ACUESA, MARY KOREN WITTING', unit: 'Research', note: 'from Sir Aldwin' }
function splitEndUser(raw) {
  let s = clean(raw);
  if (!s) return { name: null, unit: null, note: null };
  const notes = [];
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => { if (clean(inner)) notes.push(clean(inner)); return ' '; }).trim();
  let name = s;
  let unit = null;
  const m = s.match(/^(.*?[A-Za-z.])\s*[-–—]\s*([A-Za-z][A-Za-z &/]{1,30})$/);
  if (m && !m[2].includes(',')) { name = clean(m[1]); unit = clean(m[2]); }
  return { name, unit: unit ? tidyUnit(unit) : null, note: notes.join('; ') || null };
}

// RESEARCH / Research / research -> Research; short acronyms (IGP) stay upper-case.
function tidyUnit(unit) {
  return unit.split(' ').map((w) => (w.length <= 4 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

const nameTokens = (name) => clean(name).toUpperCase().replace(/[.,]/g, ' ').split(' ').filter((t) => t && !['PHD', 'DR', 'MR', 'MS', 'MRS', 'ENGR', 'PROF'].includes(t));
const sameToken = (a, b) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));

// "…KOREN W." and "…KOREN WITTING" are the same person: one name per person, the fullest spelling.
function canonicalNames(names) {
  const groups = []; // { tokens, variants: Map(name -> count) }
  for (const name of names) {
    if (!name) continue;
    const tokens = nameTokens(name);
    let g = groups.find((x) => x.tokens.length > 0 && tokens.length > 0 && x.tokens[0] === tokens[0]
      && Math.min(x.tokens.length, tokens.length) >= 2
      && Array.from({ length: Math.min(x.tokens.length, tokens.length) }, (_, i) => sameToken(x.tokens[i], tokens[i])).every(Boolean));
    if (!g) { g = { tokens, variants: new Map() }; groups.push(g); }
    g.variants.set(name, (g.variants.get(name) || 0) + 1);
    if (tokens.join('').length > g.tokens.join('').length) g.tokens = tokens;
  }
  const map = new Map();
  for (const g of groups) {
    // fullest spelling wins; ties go to the most frequent one. Titles (PhD) and dots are dropped.
    const best = [...g.variants.entries()].sort((a, b) => nameTokens(b[0]).join('').length - nameTokens(a[0]).join('').length || b[1] - a[1])[0][0];
    const display = clean(best).replace(/\bPh\.?D\.?\b/i, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/[\s,-]+$/, '').trim();
    for (const v of g.variants.keys()) map.set(v, display);
  }
  return map;
}

// ---------------------------------------------------------------- turning rows into records

function stableUuid(key) {
  const h = crypto.createHash('sha1').update(key).digest('hex');
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const VALID_STATUSES = new Set(['active', 'pending', 'maintenance', 'offline']);

function buildRecords(grid, { dateCode } = {}) {
  const header = findHeaderRow(grid);
  const headers = (grid[header.index] || []).map((h) => clean(h));
  const colField = headers.map((h) => mapHeader(h));
  const mapped = [];
  const unmapped = [];
  headers.forEach((h, i) => { if (!h) return; (colField[i] ? mapped : unmapped).push(h); });

  const result = { records: [], skipped: [], mappedColumns: mapped, unmappedColumns: unmapped, totalRows: 0 };
  if (header.score === 0) {
    result.error = 'No column headers were recognised. Expected something like: Date Acquired, ICS No., Property No., Item Description, Eul, Qty., End-User, Amount.';
    return result;
  }

  // 1) raw -> cells keyed by registry field, plus extras
  const entries = [];
  for (let r = header.index + 1; r < grid.length; r++) {
    const cells = grid[r] || [];
    if (cells.every((c) => isBlank(c))) continue;
    result.totalRows++;
    const f = {};
    const extras = [];
    cells.forEach((value, i) => {
      if (isBlank(value)) return;
      const field = colField[i];
      if (field && f[field] === undefined) f[field] = value;
      else if (headers[i]) extras.push(`${headers[i]}: ${clean(value)}`);
    });
    entries.push({ line: r + 1, f, extras });
  }

  // 2) one name per person across the whole file
  const parsedUsers = entries.map((e) => (e.f.assigned_to === undefined ? null : splitEndUser(e.f.assigned_to)));
  const nameMap = canonicalNames(parsedUsers.map((u) => u && u.name));

  // 3) each row
  const seen = new Map();
  entries.forEach((e, idx) => {
    const { f } = e;
    const remarks = [];
    const description = f.description === undefined ? null : clean(f.description);
    const nameCell = f.name === undefined ? null : clean(f.name);
    const name = nameCell || (description ? shortName(description) : null);
    if (!name) { result.skipped.push({ row: e.line, reason: 'No item name or description.' }); return; }

    const propertyNo = f.property_no === undefined ? null : clean(f.property_no) || null;
    const hintYear = propertyNo && /^\d{4}/.test(propertyNo) ? +propertyNo.slice(0, 4) : null;

    const date = parseDate(f.acquired_date, hintYear, dateCode);
    if (date.note && date.value) remarks.push(date.note);
    else if (date.note) remarks.push(`Date Acquired (as written in the file): ${date.note}`);

    let value = null;
    if (f.value_php !== undefined) {
      value = parseAmount(f.value_php);
      if (value === null) remarks.push(`Amount (as written in the file): ${clean(f.value_php)}`);
    }

    let quantity = 1;
    if (f.quantity !== undefined) {
      const q = parseAmount(f.quantity);
      if (q !== null && q >= 1 && Number.isInteger(q)) quantity = q;
      else remarks.push(`Qty. (as written in the file): ${clean(f.quantity)}`);
    }

    let usefulLife = null;
    if (f.useful_life !== undefined) {
      const life = parseUsefulLife(f.useful_life);
      if (life) { usefulLife = life.years; if (!life.exact) remarks.push(`Estimated useful life (as written in the file): ${clean(f.useful_life)}`); }
      else remarks.push(`Estimated useful life (as written in the file): ${clean(f.useful_life)}`);
    }

    const user = parsedUsers[idx];
    const assignedTo = user && user.name && user.name.toLowerCase() !== 'unassigned' ? (nameMap.get(user.name) || user.name) : null;
    if (user && user.note) remarks.push(`End-User note: ${user.note}`);
    if (user && user.name && user.name !== assignedTo && assignedTo && clean(user.name).toUpperCase() !== assignedTo.toUpperCase()
      && !nameTokens(user.name).every((t) => nameTokens(assignedTo).some((x) => sameToken(t, x)))) {
      remarks.push(`End-User (as written in the file): ${clean(f.assigned_to)}`);
    }

    const explicitSerial = f.serial_no === undefined ? null : clean(f.serial_no) || null;
    const serial = explicitSerial || (description ? extractSerial(description) : null);

    const categoryCell = f.category === undefined ? null : clean(f.category);
    const category = categoryCell || guessCategory(`${name} ${description || ''}`);

    const statusRaw = f.status === undefined ? '' : clean(f.status).toLowerCase();
    const status = VALID_STATUSES.has(statusRaw) ? statusRaw : 'active';
    if (statusRaw && !VALID_STATUSES.has(statusRaw)) remarks.push(`Status (as written in the file): ${clean(f.status)}`);

    if (f.remarks !== undefined) remarks.unshift(clean(f.remarks));
    remarks.push(...e.extras); // columns the registry has no field for: kept, not dropped

    const record = {
      asset_tag: f.asset_tag === undefined ? null : clean(f.asset_tag) || null,
      name,
      category: categoryCell || category,
      description: description || null, // the full text, exactly as written (whitespace tidied)
      condition: f.condition === undefined ? 'good' : clean(f.condition).toLowerCase() || 'good',
      status,
      room_name: f.room_name === undefined ? null : clean(f.room_name) || null,
      assigned_to: assignedTo,
      end_user_unit: user ? user.unit : null,
      acquired_date: date.value,
      value_php: value,
      quantity,
      useful_life: usefulLife,
      property_no: propertyNo,
      ics_no: f.ics_no === undefined ? null : cleanIcs(f.ics_no),
      serial_no: serial,
      remarks: remarks.filter(Boolean).join('\n') || null
    };

    // A stable id from the row's own content (+ how many identical rows came before it), so the
    // same file uploaded twice is recognised, while two genuinely identical rows both survive.
    const key = JSON.stringify([record.asset_tag, record.property_no, record.ics_no, record.name, record.description, record.serial_no,
      record.acquired_date, record.value_php, record.quantity, record.assigned_to]);
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    record.client_uuid = stableUuid(`${key}#${n}`);
    result.records.push(record);
  });
  return result;
}

function parseUpload(buffer) {
  const { grid, sheetName, format, dateCode } = readGrid(buffer);
  const built = buildRecords(grid, { dateCode });
  return { ...built, sheetName, format };
}

module.exports = {
  parseUpload, buildRecords, parseDelimited, detectDelimiter, decodeText,
  parseDate, parseAmount, parseUsefulLife, cleanIcs, extractSerial, shortName, splitEndUser, canonicalNames, guessCategory
};
