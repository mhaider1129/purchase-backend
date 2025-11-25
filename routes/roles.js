const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const { getRoles, createRole, updateRole, deleteRole } = require('../controllers/rolesController');

router.get('/', authenticateUser, getRoles);
router.post('/', authenticateUser, createRole);
router.put('/:id', authenticateUser, updateRole);
router.delete('/:id', authenticateUser, deleteRole);

module.exports = router;