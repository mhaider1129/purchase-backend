const express = require('express');
const router = express.Router();
const {
  getDepartmentsWithSections,
  createDepartment,
  createSection,
} = require('../controllers/departmentsController');
const pool = require('../config/db');
const { authenticateUser } = require('../middleware/authMiddleware');
router.use(authenticateUser); // 🔐 Protect all department routes


router.get('/', getDepartmentsWithSections); // GET /api/departments
router.post('/', createDepartment); // POST /api/departments

// GET /api/departments/:id/sections
router.get('/:id/sections', async (req, res) => {
  const departmentId = req.params.id;

  try {
    if (Number.isInteger(req.user?.institute_id)) {
      const { rows } = await pool.query(
        'SELECT institute_id FROM departments WHERE id = $1',
        [departmentId]
      );
      const instituteId = rows[0]?.institute_id;
      if (!Number.isInteger(instituteId)) {
        return res.status(404).json({ message: 'Department not found.' });
      }
      if (instituteId !== req.user.institute_id) {
        return res.status(403).json({ message: 'Department is outside your institute.' });
      }
    }

    const { rows } = await pool.query(
      'SELECT id, name FROM sections WHERE department_id = $1',
      [departmentId]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching sections:', err);
    res.status(500).json({ message: 'Failed to load sections.' });
  }
});

router.get('/:id/requesters', async (req, res) => {
  const departmentId = Number.parseInt(req.params.id, 10);
  const sectionId = req.query.section_id ? Number.parseInt(req.query.section_id, 10) : null;

  if (!Number.isInteger(departmentId)) {
    return res.status(400).json({ message: 'Invalid department ID.' });
  }
  if (req.query.section_id && !Number.isInteger(sectionId)) {
    return res.status(400).json({ message: 'Invalid section ID.' });
  }

  try {
    if (Number.isInteger(req.user?.institute_id)) {
      const { rows } = await pool.query(
        'SELECT institute_id FROM departments WHERE id = $1',
        [departmentId]
      );
      const instituteId = rows[0]?.institute_id;
      if (!Number.isInteger(instituteId)) {
        return res.status(404).json({ message: 'Department not found.' });
      }
      if (instituteId !== req.user.institute_id) {
        return res.status(403).json({ message: 'Department is outside your institute.' });
      }
    }

    const query = sectionId
      ? `SELECT id, name, section_id
           FROM users
          WHERE is_active = TRUE
            AND LOWER(TRIM(role)) = 'requester'
            AND department_id = $1
            AND section_id = $2
          ORDER BY name`
      : `SELECT id, name, section_id
           FROM users
          WHERE is_active = TRUE
            AND LOWER(TRIM(role)) = 'requester'
            AND department_id = $1
          ORDER BY name`;

    const { rows } = await pool.query(query, sectionId ? [departmentId, sectionId] : [departmentId]);
    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching requesters:', err);
    res.status(500).json({ message: 'Failed to load requesters.' });
  }
});

router.post('/:id/sections', createSection); // POST /api/departments/:id/sections

module.exports = router;