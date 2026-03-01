// server/routes/share.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const getDb = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { view_config, password, expires_in_hours } = req.body;
    if (!view_config) return res.status(400).json({ error: 'view_config is required' });
    const id = uuidv4();
    let passwordHash = null;
    let expiresAt = null;
    if (password) passwordHash = bcrypt.hashSync(password, 10);
    if (expires_in_hours) expiresAt = new Date(Date.now() + expires_in_hours * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO share_links (id, created_by, view_config, expires_at, password) VALUES (?, ?, ?, ?, ?)'
    ).run(id, req.user.userId, JSON.stringify(view_config), expiresAt, passwordHash);
    res.status(201).json({
      id,
      url: req.protocol + '://' + req.get('host') + '/?share=' + id,
      expires_at: expiresAt,
      has_password: !!password
    });
  } catch (err) {
    console.error('Create share link error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:token', async (req, res) => {
  try {
    const db = await getDb();
    const link = db.prepare('SELECT * FROM share_links WHERE id = ?').get(req.params.token);
    if (!link) return res.status(404).json({ error: 'Share link not found' });
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }
    if (link.password) {
      return res.json({ id: link.id, requires_password: true, expires_at: link.expires_at });
    }
    res.json({
      id: link.id,
      requires_password: false,
      view_config: JSON.parse(link.view_config),
      expires_at: link.expires_at
    });
  } catch (err) {
    console.error('Get share link error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:token/verify', async (req, res) => {
  try {
    const db = await getDb();
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required' });
    const link = db.prepare('SELECT * FROM share_links WHERE id = ?').get(req.params.token);
    if (!link) return res.status(404).json({ error: 'Share link not found' });
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }
    if (!link.password) {
      return res.json({ id: link.id, view_config: JSON.parse(link.view_config) });
    }
    const valid = bcrypt.compareSync(password, link.password);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });
    res.json({ id: link.id, view_config: JSON.parse(link.view_config) });
  } catch (err) {
    console.error('Verify share link error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
