//routes/approvals.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { writeAuditEvent } = require('../services/auditService');
const { createProcurementPriorityRepository } = require('../repositories/procurementPriorityRepository');
const { continueApprovalWorkflowAfterLevel } = require('../services/approvalContinuationService');
const { fetchApprovalRoutes, resolveRouteDomain } = require('../controllers/utils/approvalRoutes');
const { createNotifications } = require('../utils/notificationService');

const { authenticateUser } = require('../middleware/authMiddleware');
const {
  handleApprovalDecision,
  handleEmailApprovalAction,
  getApprovalDetailsForRequest,
  getApprovalSummary,
  updateApprovalItems,
  setApprovalHoldStatus,
  notifyCurrentApprovalByEmail,
} = require('../controllers/approvalsController');

// 📊 GET /api/approvals/summary
// → Get overall approval summary (e.g., by status, type, user, etc.)
router.get('/summary', authenticateUser, getApprovalSummary);

// 📝 GET /api/approvals/request/:request_id/approvals
// → Get all approvals for a specific request
router.get('/request/:request_id/approvals', authenticateUser, getApprovalDetailsForRequest);

// 🔔 POST /api/approvals/request/:request_id/remind-current
// → Email the current active approver to remind them about this request
router.post('/request/:request_id/remind-current', authenticateUser, notifyCurrentApprovalByEmail);

// ✅ PATCH /api/approvals/:id/decision
// → Submit an approval or rejection for a specific approval entry
router.patch('/:id/decision', authenticateUser, handleApprovalDecision);
router.post('/:id/department-ranking', authenticateUser, async (req, res, next) => {
  const client = await pool.connect();
  try {
    req.user.requirePermission('procurement-priority.rank-department');
    const orderedCaseIds = req.body?.ordered_case_ids;
    if (!Array.isArray(orderedCaseIds) || !orderedCaseIds.length || req.body?.version == null) {
      return res.status(400).json({ message: 'ordered_case_ids and version are required' });
    }
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT a.*,r.*,a.id AS id,a.request_id AS request_id,r.status AS request_status,
              u.role AS approver_role,requester.email AS requester_email
         FROM approvals a JOIN requests r ON r.id=a.request_id JOIN users u ON u.id=a.approver_id
         JOIN users requester ON requester.id=r.requester_id
        WHERE a.id=$1 FOR UPDATE OF a,r`, [req.params.id]);
    const approval = found.rows[0];
    if (!approval) throw Object.assign(new Error('Approval not found'), { statusCode: 404 });
    const routeDomain = await resolveRouteDomain({ client, departmentId: approval.department_id, explicitDomain: approval.request_domain, requestType: approval.request_type });
    const routeDefinitions = await fetchApprovalRoutes({ client, requestType: approval.request_type, departmentType: routeDomain, amount: Number(approval.estimated_cost) || 0 });
    const canonicalStep = routeDefinitions.find(step => Number(step.approval_level) === Number(approval.approval_level));
    if (String(canonicalStep?.role || approval.approver_role).toUpperCase() !== 'HOD' || Number(approval.approver_id) !== Number(req.user.id))
      throw Object.assign(new Error('Only the deciding HOD may complete this ranking gate'), { statusCode: 403 });
    if (String(approval.institute_id) !== String(req.user.institute_id) || String(approval.department_id) !== String(req.user.department_id))
      throw Object.assign(new Error('Approval ranking scope does not match your institute and department'), { statusCode: 403 });
    const pending = await client.query(`SELECT 1 FROM approvals WHERE request_id=$1 AND approval_level=$2 AND status='Pending' LIMIT 1`, [approval.request_id, approval.approval_level]);
    if (pending.rowCount) throw Object.assign(new Error('All required approvals at this level must finish before ranking'), { statusCode: 409 });
    const repo = createProcurementPriorityRepository(pool);
    const existingQueue = await repo.departmentQueue(req.user.institute_id, req.user.department_id, client);
    const existingOrder = existingQueue.filter(row => row.department_rank != null).map(row => String(row.procurement_case_id));
    const requestedOrder = orderedCaseIds.map(String);
    const isCompletedRetry = existingOrder.length === requestedOrder.length && existingOrder.every((id, index) => id === requestedOrder[index]);
    // The repository transaction is deliberately bypassed: ranking and continuation share this transaction.
    const queue = isCompletedRetry ? existingQueue : await repo.reorderDepartment({ instituteId: req.user.institute_id, departmentId: req.user.department_id,
      orderedCaseIds, version: req.body.version, actorId: req.user.id, client });
    if (!isCompletedRetry) await writeAuditEvent({ client, entityType: 'request', entityId: approval.request_id, action: 'HOD_RANKING_COMPLETED',
      actorUserId: req.user.id, instituteId: req.user.institute_id, requestId: approval.request_id,
      afterData: { orderedCaseIds }, metadata: { approvalId: approval.id, approvalLevel: approval.approval_level } });
    const notifications = [];
    let technicianEmail = null;
    if (approval.request_type === 'Maintenance' && approval.initiated_by_technician_id) {
      const technician = await client.query('SELECT email FROM users WHERE id=$1', [approval.initiated_by_technician_id]);
      technicianEmail = technician.rows[0]?.email || null;
    }
    const continuation = await continueApprovalWorkflowAfterLevel({
      client, request: approval, approval, actorId: req.user.id, routeDefinitions,
      routeDomain, technicianEmail, enqueueNotification: notification => notifications.push(notification),
    });
    if (notifications.length) await createNotifications(notifications, client);
    await client.query('COMMIT');
    res.json({ data: { workflowState: continuation.state, queue, nextApprovals: continuation.nextApprovals, requestStatus: continuation.requestStatus } });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});
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