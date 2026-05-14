//routes/approvals.js
const express = require('express');
const router = express.Router();

const { authenticateUser } = require('../middleware/authMiddleware');
const {
  handleApprovalDecision,
  handleEmailApprovalAction,
  getApprovalDetailsForRequest,
  getApprovalSummary,
  updateApprovalItems,
  setApprovalHoldStatus,
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
router.get('/email-action', handleEmailApprovalAction);

// ⏸️ PATCH /api/approvals/:id/hold
// → Place an approval on hold or resume it
router.patch('/:id/hold', authenticateUser, setApprovalHoldStatus);

// ✅ PATCH /api/approvals/:id/items
// → Record approval decisions for selected items under an approval
router.patch('/:id/items', authenticateUser, updateApprovalItems);

// Optionally:
// router.get('/summary/statistics', authenticateUser, getApprovalSummary); // alternate route

module.exports = router;