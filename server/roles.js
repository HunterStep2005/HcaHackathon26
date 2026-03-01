// server/routes/roles.js — Role definitions CRUD
const express = require('express');
const getDb = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/roles — list all roles
router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const roles = db.prepare('SELECT * FROM roles ORDER BY is_default DESC, name ASC').all();
    // Parse JSON fields
    const parsed = roles.map(r => ({
      ...r,
      facilities: JSON.parse(r.facilities),
      metrics: JSON.parse(r.metrics),
      kpis: JSON.parse(r.kpis),
      is_default: !!r.is_default
    }));
    res.json(parsed);
  } catch (err) {
    console.error('Get roles error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/roles — create custom role (CEO only)
router.post('/', requireAuth, requireRole('CEO'), async (req, res) => {
  try {
    const db = await getDb();
    const { name, facilities, metrics, kpis } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });

    const result = db.prepare(
      'INSERT INTO roles (name, facilities, metrics, kpis, is_default) VALUES (?, ?, ?, ?, 0)'
    ).run(
      name,
      JSON.stringify(facilities || []),
      JSON.stringify(metrics || []),
      JSON.stringify(kpis || [])
    );

    res.status(201).json({ id: result.lastInsertRowid, name, facilities, metrics, kpis, is_default: false });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A role with this name already exists' });
    }
    console.error('Create role error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/roles/:id — update role
router.put('/:id', requireAuth, requireRole('CEO'), async (req, res) => {
  try {
    const db = await getDb();
    const { facilities, metrics, kpis } = req.body;
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    const fields = [];
    const values = [];

    if (facilities !== undefined) { fields.push('facilities = ?'); values.push(JSON.stringify(facilities)); }
    if (metrics !== undefined) { fields.push('metrics = ?'); values.push(JSON.stringify(metrics)); }
    if (kpis !== undefined) { fields.push('kpis = ?'); values.push(JSON.stringify(kpis)); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    db.prepare(`UPDATE roles SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    res.json({
      ...updated,
      facilities: JSON.parse(updated.facilities),
      metrics: JSON.parse(updated.metrics),
      kpis: JSON.parse(updated.kpis),
      is_default: !!updated.is_default
    });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/roles/:id — delete custom role (cannot delete defaults)
router.delete('/:id', requireAuth, requireRole('CEO'), async (req, res) => {
  try {
    const db = await getDb();
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_default) return res.status(403).json({ error: 'Cannot delete system roles' });

    db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete role error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
