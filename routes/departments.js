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

router.post('/:id/sections', createSection); // POST /api/departments/:id/sections

module.exports = router;