// server/db.js — SQLite database + schema + seed data (all-in-one)
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'dashboard.db');

// Wrapper that mimics better-sqlite3's synchronous API on top of sql.js
class DB {
  constructor(sqlDb) { this._db = sqlDb; }

  _persist() { fs.writeFileSync(DB_PATH, Buffer.from(this._db.export())); }

  exec(sql) { this._db.run(sql); this._persist(); }

  pragma(val) { try { this._db.run('PRAGMA ' + val); } catch (e) {} }

  prepare(sql) {
    const db = this._db, self = this;
    return {
      get(...p) {
        const s = db.prepare(sql); s.bind(p);
        let row = null;
        if (s.step()) { const c = s.getColumnNames(), v = s.get(); row = {}; c.forEach((k, i) => row[k] = v[i]); }
        s.free(); return row;
      },
      all(...p) {
        const s = db.prepare(sql); s.bind(p); const rows = [];
        while (s.step()) { const c = s.getColumnNames(), v = s.get(), row = {}; c.forEach((k, i) => row[k] = v[i]); rows.push(row); }
        s.free(); return rows;
      },
      run(...p) {
        const s = db.prepare(sql); s.bind(p); s.step(); s.free();
        const changes = db.getRowsModified();
        const r = db.prepare('SELECT last_insert_rowid() as id'); r.step(); const lastInsertRowid = r.get()[0]; r.free();
        self._persist(); return { changes, lastInsertRowid };
      }
    };
  }

  transaction(fn) {
    const self = this;
    return (...args) => {
      self._db.run('BEGIN TRANSACTION');
      try { fn(...args); self._db.run('COMMIT'); self._persist(); }
      catch (e) { self._db.run('ROLLBACK'); throw e; }
    };
  }
}

// Schema
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Hospital Admin', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'light', default_view TEXT DEFAULT 'overview',
    default_facility TEXT, chart_range TEXT DEFAULT '7d', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
    facilities TEXT NOT NULL DEFAULT '[]', metrics TEXT NOT NULL DEFAULT '[]',
    kpis TEXT NOT NULL DEFAULT '[]', is_default INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS divisions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
  CREATE TABLE IF NOT EXISTS division_facilities (
    division_id INTEGER REFERENCES divisions(id) ON DELETE CASCADE,
    facility_id TEXT NOT NULL, PRIMARY KEY (division_id, facility_id)
  );
  CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    metric TEXT NOT NULL, operator TEXT NOT NULL, threshold REAL NOT NULL,
    facility_id TEXT, enabled INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS snoozed_alerts (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, alert_key TEXT NOT NULL,
    snoozed_until DATETIME NOT NULL, PRIMARY KEY (user_id, alert_key)
  );
  CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY, created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
    view_config TEXT NOT NULL, expires_at DATETIME, password TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

// Seed data — runs only if tables are empty
function seed(db) {
  const hasUsers = db.prepare('SELECT COUNT(*) as n FROM users').get();
  if (hasUsers && hasUsers.n > 0) {
    // Migration: ensure System Admin exists on existing DBs
    const hasSysAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('sysadmin@hca.demo');
    if (!hasSysAdmin) {
      console.log('Migrating: adding System Admin account...');
      const sr = db.prepare('INSERT OR IGNORE INTO roles (name, facilities, metrics, kpis, is_default) VALUES (?, ?, ?, ?, 1)');
      const m = JSON.stringify(['Total Census', 'ICU Occupancy', 'Admissions', 'Discharges', 'Births']);
      const k = JSON.stringify(['census', 'bedUtil', 'icuUtil', 'admissions', 'discharges']);
      sr.run('System Admin', '"__all__"', m, k);
      const r = db.prepare('INSERT OR IGNORE INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run('sysadmin@hca.demo', bcrypt.hashSync('demo123', 12), 'System Admin', 'System Admin');
      if (r.changes > 0) db.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)').run(r.lastInsertRowid);
    }
    return;
  }

  console.log('Seeding demo data...');
  const m = JSON.stringify(['Total Census', 'ICU Occupancy', 'Admissions', 'Discharges', 'Births']);
  const k = JSON.stringify(['census', 'bedUtil', 'icuUtil', 'admissions', 'discharges']);
  const sr = db.prepare('INSERT OR IGNORE INTO roles (name, facilities, metrics, kpis, is_default) VALUES (?, ?, ?, ?, 1)');
  sr.run('System Admin', '"__all__"', m, k);
  sr.run('CEO', '"__all__"', m, k);
  sr.run('Division VP', '[]', m, k);
  sr.run('Hospital Admin', '[]', m, k);

  const sd = db.prepare('INSERT OR IGNORE INTO divisions (name) VALUES (?)');
  sd.run('Division A'); sd.run('Division B'); sd.run('Division C');

  const su = db.prepare('INSERT OR IGNORE INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)');
  const sp = db.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)');
  [
    { email: 'sysadmin@hca.demo', name: 'System Admin', role: 'System Admin' },
    { email: 'ceo@hca.demo', name: 'Sam Hazen', role: 'CEO' },
    { email: 'vp@hca.demo', name: 'Division VP', role: 'Division VP' },
    { email: 'admin@hca.demo', name: 'Floor Admin', role: 'Hospital Admin' }
  ].forEach(u => {
    const r = su.run(u.email, bcrypt.hashSync('demo123', 12), u.name, u.role);
    if (r.changes > 0) sp.run(r.lastInsertRowid);
  });
  console.log('  Demo accounts: sysadmin@hca.demo / ceo@hca.demo / vp@hca.demo / admin@hca.demo (password: demo123)');
}

// Singleton
let _db = null;
async function getDb() {
  if (_db) return _db;
  const SQL = await initSqlJs();
  const sqlDb = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  _db = new DB(sqlDb);
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA);
  seed(_db);
  return _db;
}

module.exports = getDb;
