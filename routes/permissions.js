const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  listPermissions,
  getUserPermissions,
  updateUserPermissions,
} = require('../controllers/permissionsController');

router.use(authenticateUser);

router.get('/', listPermissions);
router.get('/users/:userId', getUserPermissions);
router.put('/users/:userId', updateUserPermissions);

module.exports = router;