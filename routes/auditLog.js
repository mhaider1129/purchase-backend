//routes/auditLog.js
const express = require('express');
const router = express.Router();

const { getAuditLog } = require('../controllers/auditLogController');
const { authenticateUser } = require('../middleware/authMiddleware'); // ✅ Secure middleware

/**
 * @route   GET /api/audit-log
 * @desc    Fetch audit log entries (paginated, filterable by user, action, date)
 * @query   ?search=&from_date=&to_date=&page=1&limit=10
 * @access  Private (authenticated)
 */
router.get('/', authenticateUser, getAuditLog);

// 🔒 Reserved for future admin control
// router.post('/', authenticateUser, createAuditLog);         // Manually log something (admin only)
// router.delete('/:id', authenticateUser, deleteAuditEntry);  // Delete log (admin only)

module.exports = router;