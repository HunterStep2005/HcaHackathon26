// server/routes/divisions.js
const express = require('express');
const getDb = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const divisions = db.prepare('SELECT * FROM divisions ORDER BY name ASC').all();
    const result = divisions.map(d => {
      const facilities = db.prepare(
        'SELECT facility_id FROM division_facilities WHERE division_id = ?'
      ).all(d.id).map(f => f.facility_id);
      return { ...d, facilities };
    });
    res.json(result);
  } catch (err) {
    console.error('Get divisions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', requireAuth, requireRole('CEO', 'Division VP'), async (req, res) => {
  try {
    const db = await getDb();
    const division = db.prepare('SELECT * FROM divisions WHERE id = ?').get(req.params.id);
    if (!division) return res.status(404).json({ error: 'Division not found' });
    const { facilities } = req.body;
    if (!Array.isArray(facilities)) {
      return res.status(400).json({ error: 'facilities must be an array of facility IDs' });
    }
    const deleteStmt = db.prepare('DELETE FROM division_facilities WHERE division_id = ?');
    const insertStmt = db.prepare('INSERT INTO division_facilities (division_id, facility_id) VALUES (?, ?)');
    const updateDivision = db.transaction(() => {
      deleteStmt.run(req.params.id);
      for (const fid of facilities) {
        insertStmt.run(req.params.id, fid);
      }
    });
    updateDivision();
    const updatedFacilities = db.prepare(
      'SELECT facility_id FROM division_facilities WHERE division_id = ?'
    ).all(req.params.id).map(f => f.facility_id);
    res.json({ ...division, facilities: updatedFacilities });
  } catch (err) {
    console.error('Update division error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
