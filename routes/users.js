//routes/users.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const createHttpError = require('http-errors');
const { authenticateUser } = require('../middleware/authMiddleware');
const { deactivateUser, assignUser } = require('../controllers/usersController');


// 🔒 GET /api/users/me — Authenticated user's own info
router.get('/me', authenticateUser, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role,
              u.department_id, d.name AS department_name,
              u.section_id, s.name AS section_name,
              u.can_request_medication
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN sections s ON u.section_id = s.id
        WHERE u.id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return next(createHttpError(404, 'User not found'));
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(createHttpError(500, 'Failed to fetch user'));
  }
});

router.patch('/:id/deactivate', authenticateUser, deactivateUser);
router.patch('/:id/assign', authenticateUser, assignUser);

// 🔒 GET /api/users — List all users (Admin/SCM only)
router.get('/', authenticateUser, async (req, res, next) => {
  const role = req.user.role;
  if (!['admin', 'SCM'].includes(role)) {
    return next(createHttpError(403, 'Access denied'));
  }

  try {
    const result = await pool.query(
      'SELECT id, name, email, role, department_id, section_id, is_active, can_request_medication FROM users ORDER BY role, name'
    );
    res.json(result.rows);
  } catch (err) {
    next(createHttpError(500, 'Failed to fetch users'));
  }
});

module.exports = router;
