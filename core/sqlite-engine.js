// core/sqlite-engine.js — a better-sqlite3-COMPATIBLE wrapper around sql.js
// (SQLite compiled to WebAssembly). Every feature's services.js file calls
// db.prepare(sql).all()/.get()/.run(), db.exec(), and db.transaction() —
// this class implements that exact same surface, so nothing else in the
// codebase needs to change. The payoff: sql.js is pure JS/WASM, so there is
// NO native compilation step. No Visual Studio, no node-gyp, no Python, no
// ABI mismatches between Node and Electron — it just works on any machine.
const fs = require('fs');
const initSqlJs = require('sql.js');

let SQL = null; // the sql.js WASM module, loaded once

async function loadEngine() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => require.resolve('sql.js/dist/' + file)
    });
  }
  return SQL;
}

// Converts a plain object of named params ({ asset_tag: 'X' }) into the
// '@'-prefixed form sql.js's bind() requires ({ '@asset_tag': 'X' }).
// All of this codebase's SQL uses '@name' style exclusively, so this is safe.
function toBindParams(param) {
  if (param === undefined) return undefined;
  if (Array.isArray(param)) return param;
  if (typeof param === 'object' && param !== null) {
    const out = {};
    for (const [k, v] of Object.entries(param)) {
      out[`@${k}`] = v === undefined ? null : v;
    }
    return out;
  }
  return [param];
}

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }

  all(...args) {
    const params = args.length === 1 ? toBindParams(args[0]) : args;
    const stmt = this.db._raw.prepare(this.sql);
    try {
      if (params !== undefined) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(...args) {
    const params = args.length === 1 ? toBindParams(args[0]) : args;
    const stmt = this.db._raw.prepare(this.sql);
    try {
      if (params !== undefined) stmt.bind(params);
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  run(...args) {
    const params = args.length === 1 ? toBindParams(args[0]) : args;
    const stmt = this.db._raw.prepare(this.sql);
    try {
      if (params !== undefined) stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = this.db._raw.getRowsModified();
    let lastInsertRowid = 0;
    if (/^\s*insert/i.test(this.sql)) {
      const res = this.db._raw.exec('SELECT last_insert_rowid() AS id');
      lastInsertRowid = res[0] ? res[0].values[0][0] : 0;
    }
    this.db._markDirty();
    return { changes, lastInsertRowid };
  }
}

class Database {
  constructor(raw, dbPath) {
    this._raw = raw;
    this._dbPath = dbPath;
    this._dirty = false;
  }

  pragma(str) {
    // journal_mode is meaningless for an in-memory WASM db (no WAL concept);
    // foreign_keys is real and matters, so still apply it.
    if (/foreign_keys/i.test(str)) {
      this._raw.run(`PRAGMA ${str}`);
    }
  }

  exec(sql) {
    this._raw.exec(sql);
    this._markDirty();
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  transaction(fn) {
    return (...args) => {
      this._raw.exec('BEGIN');
      try {
        const result = fn(...args);
        this._raw.exec('COMMIT');
        this._markDirty();
        return result;
      } catch (err) {
        this._raw.exec('ROLLBACK');
        throw err;
      }
    };
  }

  _markDirty() {
    this._dirty = true;
    this._schedulePersist();
  }

  _schedulePersist() {
    // Debounce: batch rapid-fire writes (e.g. a bulk import transaction)
    // into a single disk write shortly after they settle.
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => this.persist(), 150);
  }

  persist() {
    if (!this._dirty || !this._dbPath) return;
    const data = this._raw.export();
    fs.writeFileSync(this._dbPath, Buffer.from(data));
    this._dirty = false;
  }

  close() {
    this.persist();
    this._raw.close();
  }
}

async function openDatabase(dbPath) {
  const engine = await loadEngine();
  const fileBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
  const raw = new engine.Database(fileBuffer);
  const db = new Database(raw, dbPath);
  if (!fileBuffer) db.persist(); // create the file immediately on first run
  return db;
}

module.exports = { openDatabase };
