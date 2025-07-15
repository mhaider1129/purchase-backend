const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const { getRoles, createRole } = require('../controllers/rolesController');

router.get('/', authenticateUser, getRoles);
router.post('/', authenticateUser, createRole);

module.exports = router;