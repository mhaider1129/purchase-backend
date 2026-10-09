const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/requirePermission');
const controller = require('../controllers/maintenanceApprovalReportingPolicyController');
const router = express.Router();
router.use(authenticateUser);
router.get('/', controller.get);
router.put('/', requirePermission('permissions.manage'), controller.update);
module.exports = router;
