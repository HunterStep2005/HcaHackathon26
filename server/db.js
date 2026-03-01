// server/db.js — SQLite setup using sql.js (pure JS, no native compilation)
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'dashboard.db');

// sql.js wrapper that mimics better-sqlite3 API
// so route files need zero changes
class DBWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  // Save DB to disk after writes
  _persist() {
    const data = this._db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  exec(sql) {
    this._db.run(sql);
    this._persist();
  }

  pragma(val) {
    try { this._db.run(`PRAGMA ${val}`); } catch (e) { /* ignore pragma errors */ }
  }

  prepare(sql) {
    const db = this._db;
    const self = this;

    return {
      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        let row = null;
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          row = {};
          cols.forEach((c, i) => { row[c] = vals[i]; });
        }
        stmt.free();
        return row;
      },

      all(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => { row[c] = vals[i]; });
          rows.push(row);
        }
        stmt.free();
        return rows;
      },

      run(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        stmt.step();
        stmt.free();
        const changes = db.getRowsModified();
        // Get last insert rowid
        const ridStmt = db.prepare('SELECT last_insert_rowid() as id');
        ridStmt.step();
        const lastInsertRowid = ridStmt.get()[0];
        ridStmt.free();
        self._persist();
        return { changes, lastInsertRowid };
      }
    };
  }

  // Transaction helper
  transaction(fn) {
    const self = this;
    return function (...args) {
      self._db.run('BEGIN TRANSACTION');
      try {
        fn(...args);
        self._db.run('COMMIT');
        self._persist();
      } catch (e) {
        self._db.run('ROLLBACK');
        throw e;
      }
    };
  }
}

// Async init — returns a promise that resolves to the wrapper
let _dbInstance = null;

async function getDb() {
  if (_dbInstance) return _dbInstance;

  const SQL = await initSqlJs();

  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }

  _dbInstance = new DBWrapper(sqlDb);

  // Enable foreign keys
  _dbInstance.pragma('foreign_keys = ON');

  // Run migrations
  _dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'Hospital Admin',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme            TEXT DEFAULT 'light',
      default_view     TEXT DEFAULT 'overview',
      default_facility TEXT,
      chart_range      TEXT DEFAULT '7d',
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS roles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT UNIQUE NOT NULL,
      facilities  TEXT NOT NULL DEFAULT '[]',
      metrics     TEXT NOT NULL DEFAULT '[]',
      kpis        TEXT NOT NULL DEFAULT '[]',
      alert_thresholds TEXT NOT NULL DEFAULT '{}',
      is_default  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS divisions (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS division_facilities (
      division_id  INTEGER REFERENCES divisions(id) ON DELETE CASCADE,
      facility_id  TEXT NOT NULL,
      PRIMARY KEY (division_id, facility_id)
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      metric       TEXT NOT NULL,
      operator     TEXT NOT NULL,
      threshold    REAL NOT NULL,
      facility_id  TEXT,
      enabled      INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS snoozed_alerts (
      user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
      alert_key     TEXT NOT NULL,
      snoozed_until DATETIME NOT NULL,
      PRIMARY KEY (user_id, alert_key)
    );

    CREATE TABLE IF NOT EXISTS share_links (
      id          TEXT PRIMARY KEY,
      created_by  INTEGER REFERENCES users(id) ON DELETE CASCADE,
      view_config TEXT NOT NULL,
      expires_at  DATETIME,
      password    TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: add alert_thresholds column if missing
  try {
    _dbInstance.exec(`ALTER TABLE roles ADD COLUMN alert_thresholds TEXT NOT NULL DEFAULT '{}'`);
  } catch (e) {
    // Column already exists — ignore
  }

  return _dbInstance;
}

module.exports = getDb;
