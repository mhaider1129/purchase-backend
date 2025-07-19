// routes/adminTools.js
const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const reassignPendingApprovals = require('../controllers/utils/reassignPendingApprovals');
const { getAuditLog } = require('../controllers/auditLogController');
const { successResponse, errorResponse } = require('../utils/responseFormatter');

// 🔄 POST /api/admin-tools/reassign-approvals
router.post('/reassign-approvals', authenticateUser, async (req, res, next) => {
  const { role, name, id } = req.user;

  if (!['admin', 'SCM'].includes(role)) {
    console.warn(`🚫 Unauthorized reassignment attempt by ${name} (${role})`);
    return errorResponse(res, 403, 'Only Admin or SCM can trigger this action');
  }

  try {
    const results = await reassignPendingApprovals();

    console.info(`🔁 Reassignment triggered by ${name} (ID: ${id}, Role: ${role})`);
    console.info(`↪️ Reassigned: ${results.reassigned.length}, Auto-approved: ${results.autoApproved.length}`);

    return successResponse(res, '✅ Pending approvals reassigned successfully', {
      reassigned: results.reassigned.length,
      autoApproved: results.autoApproved.length,
      failed: results.failed.length
    });
  } catch (err) {
    console.error('❌ Failed to trigger manual reassignment:', err);
    return errorResponse(res, 500, 'Failed to reassign approvals');
  }
});

// 📜 GET /api/admin-tools/logs
router.get('/logs', authenticateUser, getAuditLog);

module.exports = router;
