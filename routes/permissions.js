const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  listPermissions,
  getRolePermissions,
  updateRolePermissions,
} = require('../controllers/permissionsController');

router.use(authenticateUser);

router.get('/', listPermissions);
router.get('/roles/:roleId', getRolePermissions);
router.put('/roles/:roleId', updateRolePermissions);

module.exports = router;