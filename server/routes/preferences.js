// server/routes/preferences.js
const express = require('express');
const getDb = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    let prefs = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.user.userId);
    if (!prefs) {
      db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(req.user.userId);
      prefs = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.user.userId);
    }
    res.json(prefs);
  } catch (err) {
    console.error('Get preferences error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { theme, default_view, default_facility, chart_range } = req.body;
    db.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)').run(req.user.userId);
    const fields = [];
    const values = [];
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
  } catch (err) {
    console.error('Update preferences error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
