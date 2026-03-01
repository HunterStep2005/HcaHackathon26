// server/seed.js — Seed default roles, divisions, and demo users
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const getDb = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  const db = await getDb();

  console.log('Seeding database...');

  // Seed default roles
  const seedRoles = db.prepare(
    'INSERT OR IGNORE INTO roles (name, facilities, metrics, kpis, alert_thresholds, is_default) VALUES (?, ?, ?, ?, ?, 1)'
  );

  const allMetrics = JSON.stringify(['Total Census', 'ICU Occupancy', 'Admissions', 'Discharges', 'Births']);
  const allKpis = JSON.stringify(['census', 'bedUtil', 'icuUtil', 'admissions', 'discharges']);
  const defaultThresholds = JSON.stringify({ bed: { enabled: true, warning: 85, critical: 95 }, icu: { enabled: true, warning: 80, critical: 90 } });

  seedRoles.run('CEO', '"__all__"', allMetrics, allKpis, defaultThresholds);
  seedRoles.run('Division VP', '[]', allMetrics, allKpis, defaultThresholds);
  seedRoles.run('Hospital Admin', '[]', allMetrics, allKpis, defaultThresholds);

  console.log('  ✓ Default roles seeded');

  // Seed default divisions
  const seedDivision = db.prepare('INSERT OR IGNORE INTO divisions (name) VALUES (?)');
  seedDivision.run('Division A');
  seedDivision.run('Division B');
  seedDivision.run('Division C');

  console.log('  ✓ Default divisions seeded');

  // Seed demo users
  const seedUser = db.prepare(
    'INSERT OR IGNORE INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)'
  );

  const seedPrefs = db.prepare(
    'INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)'
  );

  const demoUsers = [
    { email: 'ceo@hca.demo', password: 'demo123', name: 'Sam Hazen', role: 'CEO' },
    { email: 'vp@hca.demo', password: 'demo123', name: 'Division VP', role: 'Division VP' },
    { email: 'admin@hca.demo', password: 'demo123', name: 'Floor Admin', role: 'Hospital Admin' }
  ];

  for (const u of demoUsers) {
    const hash = bcrypt.hashSync(u.password, 12);
    const result = seedUser.run(u.email, hash, u.name, u.role);
    if (result.changes > 0) {
      seedPrefs.run(result.lastInsertRowid);
    }
  }

  console.log('  ✓ Demo users seeded');
  console.log('');
  console.log('Demo accounts:');
  console.log('  ceo@hca.demo      / demo123  (CEO)');
  console.log('  vp@hca.demo       / demo123  (Division VP)');
  console.log('  admin@hca.demo    / demo123  (Hospital Admin)');
  console.log('');
  console.log('Done!');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
