'use strict';

const { sendEmail, buildApprovalActionLinks } = require('../utils/emailService');
const { assignApprover } = require('../controllers/requests/createRequestController');
const { applyAutoAssignmentForApprovedRequest } = require('./requestAutoAssignmentService');

/**
 * Continue a fully-satisfied approval level using the caller's transaction.
 *
 * The conditional UPDATEs are intentional: they make this authority safe to
 * call again after a ranking gate has already continued (or finalized) the
 * workflow.  Side effects are emitted only by the invocation which changes
 * workflow state.
 */
async function continueApprovalWorkflowAfterLevel({
  client, request, approval, actorId, routeDefinitions = [], routeDomain,
  technicianEmail = null, enqueueNotification = () => {},
}) {
  if (!client) throw new TypeError('An existing database client is required');

  const pending = await client.query(
    `SELECT COUNT(*) AS pending_count FROM approvals
      WHERE request_id=$1 AND approval_level=$2 AND status='Pending'`,
    [approval.request_id, approval.approval_level],
  );
  if (Number(pending.rows[0]?.pending_count || 0) !== 0) {
    return { state: 'LEVEL_PENDING', nextApprovals: [], requestStatus: null };
  }

  // Maintenance requester confirmation can create later route steps. Guarding
  // on both ownership and missing higher levels makes it retry-safe.
  if (request.request_type === 'Maintenance' && request.initiated_by_technician_id && Number(approval.approval_level) === 0) {
    const higher = await client.query('SELECT 1 FROM approvals WHERE request_id=$1 AND approval_level>0 LIMIT 1', [approval.request_id]);
    if (!higher.rowCount && Number(request.requester_id) !== Number(actorId)) {
      const changed = await client.query(
        'UPDATE requests SET requester_id=$1,updated_at=NOW() WHERE id=$2 AND requester_id IS DISTINCT FROM $1 RETURNING id',
        [actorId, approval.request_id],
      );
      if (changed.rowCount) {
        request.requester_id = actorId;
        await client.query("INSERT INTO request_logs(request_id,action,actor_id,comments) VALUES($1,'Requester confirmation recorded',$2,'Maintenance request ownership transferred to department requester')", [approval.request_id, actorId]);
        const email = await client.query('SELECT email FROM users WHERE id=$1', [actorId]);
        if (email.rows[0]?.email) request.requester_email = email.rows[0].email;
        const definitions = routeDefinitions.length ? routeDefinitions.filter(x => x.approval_level > approval.approval_level) : [{ role: 'SCM', approval_level: Number(approval.approval_level) + 1 }];
        for (const definition of definitions) {
          const exists = await client.query('SELECT 1 FROM approvals WHERE request_id=$1 AND approval_level=$2 LIMIT 1', [approval.request_id, definition.approval_level]);
          if (!exists.rowCount) await assignApprover(client, definition.role, request.department_id, approval.request_id, request.request_type, definition.approval_level, routeDomain, definition.warehouse_id ?? null);
        }
      }
    }
  }

  const next = await client.query(
    `UPDATE approvals SET is_active=TRUE
      WHERE request_id=$1 AND status='Pending' AND is_active=FALSE
        AND approval_level=(SELECT MIN(approval_level) FROM approvals WHERE request_id=$1 AND status='Pending' AND approval_level>$2)
      RETURNING id,approver_id,approval_level`,
    [approval.request_id, approval.approval_level],
  );
  if (next.rowCount) {
    const level = next.rows[0].approval_level;
    await client.query('INSERT INTO request_logs(request_id,action,actor_id,comments) VALUES($1,$2,$3,NULL)', [approval.request_id, `Level ${level} activated`, actorId]);
    for (const row of next.rows) {
      const message = `The ${request.request_type} request with ID ${approval.request_id} is ready for your approval.`;
      enqueueNotification({ userId: row.approver_id, title: 'Purchase Request Needs Your Review', message, link: `/requests/${approval.request_id}`, metadata: { requestId: approval.request_id, requestType: request.request_type, action: 'approval_required', level } });
      const email = await client.query('SELECT email FROM users WHERE id=$1', [row.approver_id]);
      if (email.rows[0]?.email) {
        const links = buildApprovalActionLinks({ approvalId: row.id, approverId: row.approver_id });
        await sendEmail(email.rows[0].email, 'Purchase Request Needs Your Review', `${message}\n\nQuick actions:\nApprove: ${links.approveUrl}\nReject: ${links.rejectUrl}\n\nIf you prefer, you can still log in to review the full details before deciding.`);
      }
    }
    return { state: 'NEXT_LEVEL_ACTIVE', nextApprovals: next.rows, requestStatus: null };
  }

  const incomplete = await client.query("SELECT 1 FROM approvals WHERE request_id=$1 AND status<>'Approved' LIMIT 1", [approval.request_id]);
  if (incomplete.rowCount) return { state: 'ALREADY_CONTINUED', nextApprovals: [], requestStatus: null };
  const approved = await client.query("UPDATE requests SET status='Approved',updated_at=NOW() WHERE id=$1 AND status NOT IN ('Approved','Rejected') RETURNING *", [approval.request_id]);
  if (!approved.rowCount) return { state: 'FINAL_APPROVED', nextApprovals: [], requestStatus: 'Approved', changed: false };

  await client.query("INSERT INTO request_logs(request_id,action,actor_id,comments) VALUES($1,'Request marked Approved',$2,NULL)", [approval.request_id, actorId]);
  const requesterMessage = `Your ${request.request_type} request (ID: ${approval.request_id}) has been approved.`;
  enqueueNotification({ userId: request.requester_id, title: `Request ${approval.request_id} approved`, message: requesterMessage, link: `/requests/${approval.request_id}`, metadata: { requestId: approval.request_id, requestType: request.request_type, action: 'request_approved' } });
  if (request.requester_email) await sendEmail(request.requester_email, `Your purchase request ${approval.request_id} has been Approved`, `${requesterMessage}\nLog in to view the full details.`);
  const autoAssignment = await applyAutoAssignmentForApprovedRequest(client, { ...request, id: approval.request_id }, actorId);
  if (autoAssignment?.assigned_request) request.assigned_to = autoAssignment.assigned_request.assigned_to;
  if (request.request_type === 'Maintenance' && request.initiated_by_technician_id && technicianEmail) {
    enqueueNotification({ userId: request.initiated_by_technician_id, title: `Maintenance request ${approval.request_id} approved`, message: `The maintenance request you initiated (ID: ${approval.request_id}) has been approved.`, link: `/requests/${approval.request_id}`, metadata: { requestId: approval.request_id, requestType: request.request_type, action: 'maintenance_approved' } });
    await sendEmail(technicianEmail, `Maintenance request ${approval.request_id} approved`, `The maintenance request you initiated (ID: ${approval.request_id}) has received final approval.\nYou can follow up with the requesting department for fulfillment.`);
  }
  const scm = await client.query("SELECT id,email FROM users WHERE role='SCM' AND is_active=true AND ($1::INT IS NULL OR department_id=$1)", [request.department_id || null]);
  const emails = scm.rows.map(x => x.email).filter(Boolean);
  if (emails.length) await sendEmail(emails, `Request ${approval.request_id} fully approved`, `All approvals for ${request.request_type} request ${approval.request_id} are complete.\nYou can proceed with procurement activities.`);
  scm.rows.forEach(row => enqueueNotification({ userId: row.id, title: `Request ${approval.request_id} fully approved`, message: `All approvals for ${request.request_type} request ${approval.request_id} are complete and ready for assignment.`, link: `/requests/${approval.request_id}`, metadata: { requestId: approval.request_id, requestType: request.request_type, action: 'request_ready_for_assignment' } }));
  return { state: 'FINAL_APPROVED', nextApprovals: [], requestStatus: 'Approved', changed: true };
}

module.exports = { continueApprovalWorkflowAfterLevel };