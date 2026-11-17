// features/assignees/names.js — decides whether two spellings are the same PERSON.
//
//   "ACUESA, MARY KOREN WITTING"  (surname first, comma)
//   "Mary Koren W. Acuesa"        (given names first, surname last)
//
// are one person: only the order and the capitalisation differ. Used whenever an asset is
// assigned to a name (registry form, phone, CSV import) so the asset lands on the assignee
// who is already on the list instead of creating a second one.
const TITLES = new Set(['DR', 'DRA', 'MR', 'MS', 'MRS', 'MX', 'ENGR', 'ENGINEER', 'ATTY', 'PROF', 'SIR', 'MAAM', 'PHD', 'MD', 'EDD', 'DBA', 'MBA', 'MS', 'MA', 'MSC', 'RN', 'CPA']);

const strip = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Niño -> Nino

// { surname, given: [..] } — or null when there is nothing usable
function parseName(raw) {
  const text = strip(raw).toUpperCase().replace(/\([^)]*\)/g, ' ');
  const hasComma = text.includes(',');
  const clean = (s) => s.replace(/[.]/g, ' ').replace(/[^A-Z0-9' ]/g, ' ').split(/\s+/).filter((t) => t && !TITLES.has(t));
  let surname; let given;
  if (hasComma) {
    const [before, ...after] = text.split(',');
    const s = clean(before);
    surname = s.join(' ');
    given = clean(after.join(' '));
  } else {
    const tokens = clean(text);
    if (tokens.length < 2) return tokens.length ? { surname: tokens[0], given: [], single: true } : null;
    surname = tokens[tokens.length - 1];
    given = tokens.slice(0, -1);
  }
  if (!surname) return null;
  return { surname, given };
}

const same = (a, b) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));

// every token of the shorter list appears, in order, in the longer one (an initial matches its full name)
function givenCompatible(a, b) {
  if (a.length === 0 || b.length === 0) return false;
  if (!same(a[0], b[0])) return false; // first names must agree (or be an initial of each other)
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let j = 0;
  for (const t of short) {
    while (j < long.length && !same(t, long[j])) j++;
    if (j === long.length) return false;
    j++;
  }
  return true;
}

function sameTokenSet(a, b) {
  if (a.length !== b.length) return false;
  const rest = [...b];
  for (const t of a) {
    const i = rest.findIndex((x) => same(t, x));
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
}

// Are these two spellings the same person?
function samePerson(x, y) {
  const a = parseName(x);
  const b = parseName(y);
  if (!a || !b) return false;
  if (a.single || b.single) return String(strip(x)).trim().toUpperCase() === String(strip(y)).trim().toUpperCase();
  if (a.surname === b.surname && givenCompatible(a.given, b.given)) return true;
  // order unknown (e.g. "Acuesa Mary Koren W." with no comma): compare the words as a set
  return sameTokenSet([a.surname, ...a.given].join(' ').split(' '), [b.surname, ...b.given].join(' ').split(' '));
}

// "ACUESA, MARY KOREN WITTING" -> "Mary Koren Witting Acuesa" (for display only)
function givenFirst(raw) {
  const p = parseName(raw);
  if (!p || p.single) return String(raw || '').trim();
  const title = (w) => w.charAt(0) + w.slice(1).toLowerCase();
  return [...p.given, p.surname].map((w) => w.split(' ').map(title).join(' ')).join(' ');
}

module.exports = { parseName, samePerson, givenFirst };
