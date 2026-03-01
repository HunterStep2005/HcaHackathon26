// server/routes/alerts.js
const express = require('express');
const getDb = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const alerts = db.prepare('SELECT * FROM alert_rules WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user.userId);
    res.json(alerts);
  } catch (err) {
    console.error('Get alerts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { metric, operator, threshold, facility_id, enabled } = req.body;
    if (!metric || !operator || threshold === undefined) {
      return res.status(400).json({ error: 'metric, operator, and threshold are required' });
    }
    const validOps = ['>', '<', '>=', '<=', '=='];
    if (!validOps.includes(operator)) {
      return res.status(400).json({ error: 'Invalid operator. Use: >, <, >=, <=, ==' });
    }
    const result = db.prepare(
      'INSERT INTO alert_rules (user_id, metric, operator, threshold, facility_id, enabled) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.user.userId, metric, operator, threshold, facility_id || null, enabled !== undefined ? (enabled ? 1 : 0) : 1);
    const alert = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(alert);
  } catch (err) {
    console.error('Create alert error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const alert = db.prepare('SELECT * FROM alert_rules WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.userId);
    if (!alert) return res.status(404).json({ error: 'Alert rule not found' });
    const { metric, operator, threshold, facility_id, enabled } = req.body;
    const fields = [];
    const values = [];
    if (metric !== undefined) { fields.push('metric = ?'); values.push(metric); }
    if (operator !== undefined) { fields.push('operator = ?'); values.push(operator); }
    if (threshold !== undefined) { fields.push('threshold = ?'); values.push(threshold); }
    if (facility_id !== undefined) { fields.push('facility_id = ?'); values.push(facility_id); }
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(enabled ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id, req.user.userId);
    db.prepare('UPDATE alert_rules SET ' + fields.join(', ') + ' WHERE id = ? AND user_id = ?').run(...values);
    const updated = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Update alert error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.prepare('DELETE FROM alert_rules WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Alert rule not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete alert error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/snooze', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { minutes } = req.body;
    const mins = minutes || 60;
    const alert = db.prepare('SELECT * FROM alert_rules WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.userId);
    if (!alert) return res.status(404).json({ error: 'Alert rule not found' });
    const alertKey = 'alert_' + req.params.id;
    const snoozedUntil = new Date(Date.now() + mins * 60 * 1000).toISOString();
    db.prepare(
      'INSERT OR REPLACE INTO snoozed_alerts (user_id, alert_key, snoozed_until) VALUES (?, ?, ?)'
    ).run(req.user.userId, alertKey, snoozedUntil);
    res.json({ alert_key: alertKey, snoozed_until: snoozedUntil });
  } catch (err) {
    console.error('Snooze alert error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/snoozed', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    db.prepare('DELETE FROM snoozed_alerts WHERE snoozed_until < datetime("now")').run();
    const snoozed = db.prepare('SELECT * FROM snoozed_alerts WHERE user_id = ?').all(req.user.userId);
    res.json(snoozed);
  } catch (err) {
    console.error('Get snoozed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
