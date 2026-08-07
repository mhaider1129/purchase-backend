const withTransaction = require('../utils/withTransaction');
const { validateApprovalDecision, DECISIONS } = require('../validators/approvalDecisionValidator');
const approvalPolicy = require('../policies/approvalPolicy');
const auditService = require('./auditService');
const outbox = require('./notificationOutboxService');
const lifecycleDefault = require('./requestLifecycleService');

class ApprovalEngineError extends Error { constructor(message, code, statusCode = 409) { super(message); this.name = 'ApprovalEngineError'; this.code = code; this.statusCode = statusCode; } }

function createApprovalEngine(dependencies = {}) {
  const policy = dependencies.policy || approvalPolicy.assertCanDecide;
  const audit = dependencies.audit || auditService.writeAuditEvent;
  const notify = dependencies.notify || outbox.enqueueNotification;
  const lifecycle = dependencies.lifecycle || lifecycleDefault;

  async function createSteps({ requestId, routeSnapshot, actor, correlationId }, suppliedClient = null) {
    return withTransaction(async client => {
      const lockedRequest = await client.query('SELECT id FROM requests WHERE id=$1 FOR UPDATE', [requestId]);
      if (!lockedRequest.rows[0]) throw new ApprovalEngineError('Request not found', 'REQUEST_NOT_FOUND', 404);
      await client.query(
        `UPDATE requests
            SET approval_route_snapshot=$1::jsonb,
                approval_route_snapshot_id=$2,
                updated_at=NOW()
          WHERE id=$3`,
        [JSON.stringify(routeSnapshot), routeSnapshot.snapshotId, requestId],
      );
      const created = [];
      for (const step of routeSnapshot.steps) {
        const result = await client.query(
          `INSERT INTO approvals (request_id,approver_id,approval_level,status,is_active,route_snapshot_id)
           VALUES ($1,$2,$3,'Pending',FALSE,$4) ON CONFLICT (request_id,route_snapshot_id,approval_level) DO NOTHING RETURNING *`,
          [requestId, step.approverId, step.level, routeSnapshot.snapshotId]);
        if (result.rows[0]) created.push(result.rows[0]);
      }
      const active = await activateNext(client, requestId);
      await audit({ entityType: 'request', entityId: requestId, action: 'approval.route_created', actorUserId: actor?.id, requestId, correlationId, afterData: routeSnapshot, metadata: { routeSnapshotId: routeSnapshot.snapshotId }, client });
      if (active) await notificationForActive(client, active, correlationId);
      return { created, active, routeSnapshotId: routeSnapshot.snapshotId };
    }, { client: suppliedClient });
  }

  async function activateNext(client, requestId) {
    const existing = await client.query("SELECT * FROM approvals WHERE request_id=$1 AND is_active=TRUE AND status='Pending' FOR UPDATE", [requestId]);
    if (existing.rowCount > 1) throw new ApprovalEngineError('Multiple active approvals detected', 'DUPLICATE_ACTIVE_APPROVAL');
    if (existing.rowCount === 1) return existing.rows[0];
    const next = await client.query("SELECT * FROM approvals WHERE request_id=$1 AND status='Pending' ORDER BY approval_level,id LIMIT 1 FOR UPDATE", [requestId]);
    if (!next.rows[0]) return null;
    if (!next.rows[0].approver_id) throw new ApprovalEngineError('The next approval has no assigned approver', 'MISSING_NEXT_APPROVER');
    const activated = await client.query("UPDATE approvals SET is_active=TRUE WHERE id=$1 AND status='Pending' AND is_active=FALSE RETURNING *", [next.rows[0].id]);
    if (activated.rowCount !== 1) throw new ApprovalEngineError('Approval activation conflict', 'ACTIVATION_CONFLICT');
    return activated.rows[0];
  }

  const notificationForActive = (client, approval, correlationId) => notify(client, { type: 'approval.action_required', entityType: 'approval', entityId: approval.id, userId: approval.approver_id, correlationId, idempotencyKey: `approval:${approval.id}:active`, payload: { requestId: approval.request_id, approvalLevel: approval.approval_level } });

  async function decide(command, suppliedClient = null) {
    const input = validateApprovalDecision(command);
    return withTransaction(async client => {
      const approvalResult = await client.query('SELECT * FROM approvals WHERE id=$1 FOR UPDATE', [input.approvalId]);
      const approval = approvalResult.rows[0];
      if (!approval) throw new ApprovalEngineError('Approval not found', 'APPROVAL_NOT_FOUND', 404);
      const requestResult = await client.query('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [approval.request_id]);
      const request = requestResult.rows[0];
      if (!request) throw new ApprovalEngineError('Request not found', 'REQUEST_NOT_FOUND', 404);
      if (approval.status !== 'Pending' || !approval.is_active) throw new ApprovalEngineError('Approval is inactive or already decided', 'APPROVAL_NOT_ACTIVE');
      await policy({ actor: input.actor, request, approval, allowSelfApproval: input.allowSelfApproval });
      const updated = await client.query(
        `UPDATE approvals SET status=$1,comments=$2,
            approved_at=CASE WHEN $1='Approved' THEN NOW() ELSE NULL END,
            decided_at=NOW(), rejected_at=CASE WHEN $1='Rejected' THEN NOW() ELSE NULL END,
            is_active=FALSE
         WHERE id=$3 AND status='Pending' AND is_active=TRUE RETURNING *`, [input.decision, input.reason, approval.id]);
      if (updated.rowCount !== 1) throw new ApprovalEngineError('Concurrent approval decision detected', 'CONCURRENT_DECISION');
      const correlationId = input.correlationId || input.idempotencyKey || null;
      await audit({ entityType: 'approval', entityId: approval.id, action: `approval.${input.decision.toLowerCase()}`, actorUserId: input.actor?.id, instituteId: request.institute_id, requestId: request.id, correlationId, beforeData: { status: approval.status, isActive: approval.is_active }, afterData: { status: input.decision, isActive: false }, reason: input.reason, metadata: { approvalStepId: approval.id, routeSnapshotId: approval.route_snapshot_id }, client });
      let next = null; let requestTransition = null;
      if (input.decision === DECISIONS.APPROVE) {
        next = await activateNext(client, request.id);
        if (next) await notificationForActive(client, next, correlationId);
        else requestTransition = await lifecycle.transition({ requestId: request.id, toStatus: 'Approved', expectedStatus: request.status, actor: input.actor, permission: 'approvals.decide', correlationId, idempotencyKey: input.idempotencyKey, metadata: { approvalStepId: approval.id, routeSnapshotId: approval.route_snapshot_id } }, client);
      } else {
        await client.query("UPDATE approvals SET is_active=FALSE WHERE request_id=$1 AND status='Pending'", [request.id]);
        requestTransition = await lifecycle.transition({ requestId: request.id, toStatus: input.decision, expectedStatus: request.status, actor: input.actor, permission: 'approvals.decide', reason: input.reason, correlationId, idempotencyKey: input.idempotencyKey, metadata: { approvalStepId: approval.id, routeSnapshotId: approval.route_snapshot_id } }, client);
      }
      await notify(client, { type: 'approval.decided', entityType: 'approval', entityId: approval.id, userId: request.requester_id, correlationId, idempotencyKey: `approval:${approval.id}:decision:${input.decision}:${input.idempotencyKey || updated.rows[0].decided_at || 'decided'}`, payload: { requestId: request.id, decision: input.decision, reason: input.reason } });
      return { approval: updated.rows[0], nextApproval: next, requestTransition };
    }, { client: suppliedClient });
  }

  async function reassign({ approvalId, newApproverId, actor, reason, correlationId }, suppliedClient = null) {
    if (!reason?.trim()) throw new ApprovalEngineError('A reassignment reason is required', 'REASON_REQUIRED', 400);
    return withTransaction(async client => {
      const { rows } = await client.query("SELECT * FROM approvals WHERE id=$1 FOR UPDATE", [approvalId]); const before = rows[0];
      if (!before || before.status !== 'Pending') throw new ApprovalEngineError('Only pending approvals can be reassigned', 'APPROVAL_NOT_PENDING');
      const { rows: afterRows } = await client.query("UPDATE approvals SET approver_id=$1 WHERE id=$2 AND status='Pending' RETURNING *", [newApproverId, approvalId]);
      await audit({ entityType: 'approval', entityId: approvalId, action: 'approval.reassigned', actorUserId: actor?.id, requestId: before.request_id, correlationId, beforeData: { approverId: before.approver_id }, afterData: { approverId: newApproverId }, reason, client });
      if (afterRows[0].is_active) await notificationForActive(client, afterRows[0], correlationId);
      return afterRows[0];
    }, { client: suppliedClient });
  }
  return { createSteps, decide, reassign, activateNext };
}

module.exports = { createApprovalEngine, ApprovalEngineError, ...createApprovalEngine() };