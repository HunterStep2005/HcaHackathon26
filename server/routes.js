// server/routes.js — All API routes, auth middleware, and rate limiting
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const getDb = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'hca-dashboard-hackathon-secret-2026';

// ── Middleware ──────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,
  message: { error: 'Rate limit exceeded. Please slow down.' }
});

function requireAuth(req, res, next) {
  let token = null;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) token = h.split(' ')[1];
  else if (req.cookies && req.cookies.token) token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

// ── Router ─────────────────────────────────────────────────

const router = express.Router();

// Rate limiting
router.use('/auth/login', authLimiter);
router.use('/auth/register', authLimiter);
router.use('/', apiLimiter);

// ── Auth ───────────────────────────────────────────────────

router.post('/auth/register', async (req, res) => {
  try {
    const db = await getDb();
    const { email, password, display_name } = req.body;
    if (!email || !password || !display_name) return res.status(400).json({ error: 'Email, password, and display name are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
    const hash = bcrypt.hashSync(password, 12);
    const result = db.prepare('INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run(email.toLowerCase(), hash, display_name, 'Hospital Admin');
    db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(result.lastInsertRowid);
    const token = jwt.sign({ userId: result.lastInsertRowid, email: email.toLowerCase(), role: 'Hospital Admin' }, JWT_SECRET, { expiresIn: '8h' });
    res.status(201).json({ token, user: { id: result.lastInsertRowid, email: email.toLowerCase(), display_name, role: 'Hospital Admin' } });
  } catch (err) { console.error('Register error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/auth/login', async (req, res) => {
  try {
    const db = await getDb();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role } });
  } catch (err) { console.error('Login error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const user = db.prepare('SELECT id, email, display_name, role, created_at FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { console.error('Me error:', err); res.status(500).json({ error: 'Server error' }); }
});

// ── Preferences ────────────────────────────────────────────

router.get('/preferences', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    let prefs = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.user.userId);
    if (!prefs) {
      db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(req.user.userId);
      prefs = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.user.userId);
    }
    res.json(prefs);
  } catch (err) { console.error('Get prefs error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/preferences', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { theme, default_view, default_facility, chart_range } = req.body;
    db.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)').run(req.user.userId);
    const fields = [], values = [];
    if (theme !== undefined) { fields.push('theme = ?'); values.push(theme); }
    if (default_view !== undefined) { fields.push('default_view = ?'); values.push(default_view); }
    if (default_facility !== undefined) { fields.push('default_facility = ?'); values.push(default_facility); }
    if (chart_range !== undefined) { fields.push('chart_range = ?'); values.push(chart_range); }
    if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.user.userId);
    db.prepare('UPDATE user_preferences SET ' + fields.join(', ') + ' WHERE user_id = ?').run(...values);
    const updated = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.user.userId);
    res.json(updated);
  } catch (err) { console.error('Update prefs error:', err); res.status(500).json({ error: 'Server error' }); }
});

// ── Roles ──────────────────────────────────────────────────

router.get('/roles', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const roles = db.prepare('SELECT * FROM roles ORDER BY is_default DESC, name ASC').all();
    res.json(roles.map(r => ({ ...r, facilities: JSON.parse(r.facilities), metrics: JSON.parse(r.metrics), kpis: JSON.parse(r.kpis), is_default: !!r.is_default })));
  } catch (err) { console.error('Get roles error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/roles', requireAuth, requireRole('CEO'), async (req, res) => {
  try {
    const db = await getDb();
    const { name, facilities, metrics, kpis } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });
    const result = db.prepare('INSERT INTO roles (name, facilities, metrics, kpis, is_default) VALUES (?, ?, ?, ?, 0)').run(name, JSON.stringify(facilities || []), JSON.stringify(metrics || []), JSON.stringify(kpis || []));
    res.status(201).json({ id: result.lastInsertRowid, name, facilities, metrics, kpis, is_default: false });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) return res.status(409).json({ error: 'A role with this name already exists' });
    console.error('Create role error:', err); res.status(500).json({ error: 'Server error' });
  }
});

router.put('/roles/:id', requireAuth, requireRole('CEO'), async (req, res) => {
  try {
    const db = await getDb();
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    const { facilities, metrics, kpis } = req.body;
    const fields = [], values = [];
    if (facilities !== undefined) { fields.push('facilities = ?'); values.push(JSON.stringify(facilities)); }
    if (metrics !== undefined) { fields.push('metrics = ?'); values.push(JSON.stringify(metrics)); }
    if (kpis !== undefined) { fields.push('kpis = ?'); values.push(JSON.stringify(kpis)); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id);
    db.prepare('UPDATE roles SET ' + fields.join(', ') + ' WHERE id = ?').run(...values);
    const updated = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    res.json({ ...updated, facilities: JSON.parse(updated.facilities), metrics: JSON.parse(updated.metrics), kpis: JSON.parse(updated.kpis), is_default: !!updated.is_default });
  } catch (err) { console.error('Update role error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/roles/:id', requireAuth, requireRole('CEO'), async (req, res) => {
  try {
    const db = await getDb();
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_default) return res.status(403).json({ error: 'Cannot delete system roles' });
    db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { console.error('Delete role error:', err); res.status(500).json({ error: 'Server error' }); }
});

// ── Alerts ─────────────────────────────────────────────────

router.get('/alerts', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    res.json(db.prepare('SELECT * FROM alert_rules WHERE user_id = ? ORDER BY created_at DESC').all(req.user.userId));
  } catch (err) { console.error('Get alerts error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/alerts', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { metric, operator, threshold, facility_id, enabled } = req.body;
    if (!metric || !operator || threshold === undefined) return res.status(400).json({ error: 'metric, operator, and threshold are required' });
    if (!['>', '<', '>=', '<=', '=='].includes(operator)) return res.status(400).json({ error: 'Invalid operator' });
    const result = db.prepare('INSERT INTO alert_rules (user_id, metric, operator, threshold, facility_id, enabled) VALUES (?, ?, ?, ?, ?, ?)').run(req.user.userId, metric, operator, threshold, facility_id || null, enabled !== undefined ? (enabled ? 1 : 0) : 1);
    res.status(201).json(db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) { console.error('Create alert error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/alerts/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const alert = db.prepare('SELECT * FROM alert_rules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!alert) return res.status(404).json({ error: 'Alert rule not found' });
    const { metric, operator, threshold, facility_id, enabled } = req.body;
    const fields = [], values = [];
    if (metric !== undefined) { fields.push('metric = ?'); values.push(metric); }
    if (operator !== undefined) { fields.push('operator = ?'); values.push(operator); }
    if (threshold !== undefined) { fields.push('threshold = ?'); values.push(threshold); }
    if (facility_id !== undefined) { fields.push('facility_id = ?'); values.push(facility_id); }
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(enabled ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id, req.user.userId);
    db.prepare('UPDATE alert_rules SET ' + fields.join(', ') + ' WHERE id = ? AND user_id = ?').run(...values);
    res.json(db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id));
  } catch (err) { console.error('Update alert error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/alerts/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.prepare('DELETE FROM alert_rules WHERE id = ? AND user_id = ?').run(req.params.id, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Alert rule not found' });
    res.json({ success: true });
  } catch (err) { console.error('Delete alert error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/alerts/:id/snooze', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const mins = req.body.minutes || 60;
    const alert = db.prepare('SELECT * FROM alert_rules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!alert) return res.status(404).json({ error: 'Alert rule not found' });
    const alertKey = 'alert_' + req.params.id;
    const snoozedUntil = new Date(Date.now() + mins * 60 * 1000).toISOString();
    db.prepare('INSERT OR REPLACE INTO snoozed_alerts (user_id, alert_key, snoozed_until) VALUES (?, ?, ?)').run(req.user.userId, alertKey, snoozedUntil);
    res.json({ alert_key: alertKey, snoozed_until: snoozedUntil });
  } catch (err) { console.error('Snooze error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/alerts/snoozed', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    db.prepare('DELETE FROM snoozed_alerts WHERE snoozed_until < datetime("now")').run();
    res.json(db.prepare('SELECT * FROM snoozed_alerts WHERE user_id = ?').all(req.user.userId));
  } catch (err) { console.error('Get snoozed error:', err); res.status(500).json({ error: 'Server error' }); }
});

// ── Divisions ──────────────────────────────────────────────

router.get('/divisions', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const divisions = db.prepare('SELECT * FROM divisions ORDER BY name ASC').all();
    res.json(divisions.map(d => ({
      ...d,
      facilities: db.prepare('SELECT facility_id FROM division_facilities WHERE division_id = ?').all(d.id).map(f => f.facility_id)
    })));
  } catch (err) { console.error('Get divisions error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/divisions/:id', requireAuth, requireRole('CEO', 'Division VP'), async (req, res) => {
  try {
    const db = await getDb();
    const division = db.prepare('SELECT * FROM divisions WHERE id = ?').get(req.params.id);
    if (!division) return res.status(404).json({ error: 'Division not found' });
    const { facilities } = req.body;
    if (!Array.isArray(facilities)) return res.status(400).json({ error: 'facilities must be an array' });
    const del = db.prepare('DELETE FROM division_facilities WHERE division_id = ?');
    const ins = db.prepare('INSERT INTO division_facilities (division_id, facility_id) VALUES (?, ?)');
    const update = db.transaction(() => { del.run(req.params.id); for (const f of facilities) ins.run(req.params.id, f); });
    update();
    const updated = db.prepare('SELECT facility_id FROM division_facilities WHERE division_id = ?').all(req.params.id).map(f => f.facility_id);
    res.json({ ...division, facilities: updated });
  } catch (err) { console.error('Update division error:', err); res.status(500).json({ error: 'Server error' }); }
});

// ── Share Links ────────────────────────────────────────────

router.post('/share', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { view_config, password, expires_in_hours } = req.body;
    if (!view_config) return res.status(400).json({ error: 'view_config is required' });
    const id = uuidv4();
    const pwHash = password ? bcrypt.hashSync(password, 10) : null;
    const expiresAt = expires_in_hours ? new Date(Date.now() + expires_in_hours * 3600000).toISOString() : null;
    db.prepare('INSERT INTO share_links (id, created_by, view_config, expires_at, password) VALUES (?, ?, ?, ?, ?)').run(id, req.user.userId, JSON.stringify(view_config), expiresAt, pwHash);
    res.status(201).json({ id, url: req.protocol + '://' + req.get('host') + '/?share=' + id, expires_at: expiresAt, has_password: !!password });
  } catch (err) { console.error('Create share error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/share/:token', async (req, res) => {
  try {
    const db = await getDb();
    const link = db.prepare('SELECT * FROM share_links WHERE id = ?').get(req.params.token);
    if (!link) return res.status(404).json({ error: 'Share link not found' });
    if (link.expires_at && new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'Share link has expired' });
    if (link.password) return res.json({ id: link.id, requires_password: true, expires_at: link.expires_at });
    res.json({ id: link.id, requires_password: false, view_config: JSON.parse(link.view_config), expires_at: link.expires_at });
  } catch (err) { console.error('Get share error:', err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/share/:token/verify', async (req, res) => {
  try {
    const db = await getDb();
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required' });
    const link = db.prepare('SELECT * FROM share_links WHERE id = ?').get(req.params.token);
    if (!link) return res.status(404).json({ error: 'Share link not found' });
    if (link.expires_at && new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'Share link has expired' });
    if (!link.password) return res.json({ id: link.id, view_config: JSON.parse(link.view_config) });
    if (!bcrypt.compareSync(password, link.password)) return res.status(401).json({ error: 'Incorrect password' });
    res.json({ id: link.id, view_config: JSON.parse(link.view_config) });
  } catch (err) { console.error('Verify share error:', err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
