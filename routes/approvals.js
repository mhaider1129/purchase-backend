//routes/approvals.js
const express = require('express');
const router = express.Router();

const { authenticateUser } = require('../middleware/authMiddleware');
const {
  handleApprovalDecision,
  getApprovalDetailsForRequest,
  getApprovalSummary
} = require('../controllers/approvalsController');

// 📊 GET /api/approvals/summary
// → Get overall approval summary (e.g., by status, type, user, etc.)
router.get('/summary', authenticateUser, getApprovalSummary);

// 📝 GET /api/approvals/request/:request_id/approvals
// → Get all approvals for a specific request
router.get('/request/:request_id/approvals', authenticateUser, getApprovalDetailsForRequest);

// ✅ PATCH /api/approvals/:id/decision
// → Submit an approval or rejection for a specific approval entry
router.patch('/:id/decision', authenticateUser, handleApprovalDecision);

// Optionally:
// router.get('/summary/statistics', authenticateUser, getApprovalSummary); // alternate route

module.exports = router;
