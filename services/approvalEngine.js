const withTransaction = require('../utils/withTransaction');
const { validateApprovalDecision, DECISIONS } = require('../validators/approvalDecisionValidator');
const approvalPolicy = require('../policies/approvalPolicy');
const auditService = require('./auditService');
const outbox = require('./notificationOutboxService');
const lifecycleDefault = require('./requestLifecycleService');
const repositoryDefault = require('../repositories/approvalRepository');

class ApprovalEngineError extends Error {
  constructor(message, code, statusCode = 409) { super(message); this.name = 'ApprovalEngineError'; this.code = code; this.statusCode = statusCode; }
}

const snapshotSteps = snapshot => {
  if (Array.isArray(snapshot?.levels)) {
    return snapshot.levels.flatMap(group => (group.members || []).map(member => ({ ...member, level: Number(group.level) })));
  }
  return Array.isArray(snapshot?.steps) ? snapshot.steps : [];
};

const workflowScope = approval => ({
  requestId: approval.request_id,
  approvalRouteVersion: approval.approval_route_version,
  routeSnapshotId: approval.route_snapshot_id,
});

function createApprovalEngine(dependencies = {}) {
  const policy = dependencies.policy || approvalPolicy.assertCanDecide;
  const audit = dependencies.audit || auditService.writeAuditEvent;
  const notify = dependencies.notify || outbox.enqueueNotification;
  const lifecycle = dependencies.lifecycle || lifecycleDefault;
  const repository = dependencies.repository || repositoryDefault;

  const notificationForActive = (client, approval, correlationId) => notify(client, {
    type: 'approval.action_required', entityType: 'approval', entityId: approval.id,
    userId: approval.approver_id, correlationId,
    idempotencyKey: `approval:${approval.id}:active:${approval.approval_route_version ?? 'legacy'}`,
    payload: { requestId: approval.request_id, approvalLevel: approval.approval_level },
  });

  async function activateLevel(client, scope, level, correlationId = null) {
    const activated = await repository.activateLevel(client, scope, level);
    await Promise.all(activated.map(approval => notificationForActive(client, approval, correlationId)));
    return activated;
  }

  async function activateNext(client, requestId, options = {}) {
    const scope = { requestId, approvalRouteVersion: options.approvalRouteVersion ?? null, routeSnapshotId: options.routeSnapshotId ?? null };
    const level = await repository.getCurrentLevel(client, scope);
    if (level == null) return [];
    return activateLevel(client, scope, level, options.correlationId);
  }

  async function supersedeWorkflow({ requestId, actor, reason, replacementSnapshotId }, suppliedClient = null) {
    return withTransaction(async client => {
      await repository.lockRequest(client, requestId);
      const result = await client.query(
        `UPDATE approvals SET is_active=FALSE,is_superseded=TRUE,superseded_at=NOW(),
           superseded_by_user_id=$2,superseded_reason=$3
         WHERE request_id=$1 AND COALESCE(is_superseded,FALSE)=FALSE RETURNING *`,
        [requestId, actor?.id || null, reason]);
      return { approvals: result.rows, replacementSnapshotId };
    }, { client: suppliedClient });
  }

  async function createSteps({ requestId, routeSnapshot, actor, correlationId, inheritedDecisions = [] }, suppliedClient = null) {
    return withTransaction(async client => {
      const request = await repository.lockRequest(client, requestId);
      if (!request) throw new ApprovalEngineError('Request not found', 'REQUEST_NOT_FOUND', 404);
      await client.query(
        `UPDATE requests SET approval_route_snapshot=$1::jsonb,approval_route_snapshot_id=$2,updated_at=NOW() WHERE id=$3`,
        [JSON.stringify(routeSnapshot), routeSnapshot.snapshotId, requestId]);
      const created = [];
      const inheritedByApprover = new Map(inheritedDecisions
        .filter(decision => decision.status === DECISIONS.APPROVE)
        .map(decision => [Number(decision.approver_id), decision]));
      for (const step of snapshotSteps(routeSnapshot)) {
        if (!step.approverId) throw new ApprovalEngineError('Every canonical route member must resolve to a user', 'MISSING_APPROVER');
        const inherited = inheritedByApprover.get(Number(step.approverId));
        // The request lock serializes workflow creation for this request.  Use an
        // explicit existence check so reclassification also works on installations
        // where the route-member unique index has not yet been added.
        const result = await client.query(
          `INSERT INTO approvals (request_id,approver_id,approval_level,status,is_active,route_snapshot_id,approval_route_version,
                                  comments,approved_at,decided_at)
           SELECT $1,$2,$3,$6,FALSE,$4,$5,$7,$8,$9
           WHERE NOT EXISTS (
             SELECT 1 FROM approvals
              WHERE request_id=$1
                AND approval_route_version=$5
                AND approval_level=$3
                AND approver_id=$2
           )
           RETURNING *`,
          [requestId, step.approverId, step.level, routeSnapshot.snapshotId, routeSnapshot.version,
            inherited ? DECISIONS.APPROVE : 'Pending', inherited?.comments || null,
            inherited?.approved_at || inherited?.decided_at || null, inherited?.decided_at || inherited?.approved_at || null]);
        if (result.rows[0]) created.push(result.rows[0]);
      }
      const scope = { requestId, approvalRouteVersion: routeSnapshot.version, routeSnapshotId: routeSnapshot.snapshotId };
      const firstLevel = await repository.getCurrentLevel(client, scope);
      const active = firstLevel == null ? [] : await activateLevel(client, scope, firstLevel, correlationId);
      await audit({ entityType: 'request', entityId: requestId, action: 'approval.route_created', actorUserId: actor?.id, requestId, correlationId, afterData: routeSnapshot, metadata: { routeSnapshotId: routeSnapshot.snapshotId, routeVersion: routeSnapshot.version, firstLevel, memberCount: created.length }, client });
      return { created, active, routeSnapshotId: routeSnapshot.snapshotId };
    }, { client: suppliedClient });
  }

  async function decide(command, suppliedClient = null) {
    const input = validateApprovalDecision(command);
    return withTransaction(async client => {
      // Discover identity without a lock, then always lock request -> workflow rows by id.
      const discovered = await repository.findApproval(client, input.approvalId);
      if (!discovered) throw new ApprovalEngineError('Approval not found', 'APPROVAL_NOT_FOUND', 404);
      if (discovered.is_superseded === true) throw new ApprovalEngineError('Superseded approvals cannot be decided', 'APPROVAL_SUPERSEDED');
      const request = await repository.lockRequest(client, discovered.request_id);
      if (!request) throw new ApprovalEngineError('Request not found', 'REQUEST_NOT_FOUND', 404);
      const scope = workflowScope(discovered);
      const workflow = await repository.lockWorkflow(client, scope);
      const approval = workflow.find(row => Number(row.id) === input.approvalId);
      if (!approval) throw new ApprovalEngineError('Approval is not part of the current route version', 'APPROVAL_NOT_CURRENT');
      if (approval.is_superseded === true) throw new ApprovalEngineError('Superseded approvals cannot be decided', 'APPROVAL_SUPERSEDED');
      if (approval.status !== 'Pending' || !approval.is_active) throw new ApprovalEngineError('Approval is inactive or already decided', 'APPROVAL_NOT_ACTIVE');
      await policy({ actor: input.actor, request, approval, allowSelfApproval: input.allowSelfApproval });
      const updated = await client.query(
        `UPDATE approvals SET status=$1,comments=$2,approved_at=CASE WHEN $1='Approved' THEN NOW() ELSE NULL END,
            decided_at=NOW(),rejected_at=CASE WHEN $1='Rejected' THEN NOW() ELSE NULL END,is_active=FALSE
         WHERE id=$3 AND status='Pending' AND is_active=TRUE AND COALESCE(is_superseded,FALSE)=FALSE RETURNING *`,
        [input.decision, input.reason, approval.id]);
      if (updated.rowCount !== 1) throw new ApprovalEngineError('Concurrent approval decision detected', 'CONCURRENT_DECISION');
      const correlationId = input.correlationId || input.idempotencyKey || null;
      const summary = await repository.getLevelDecisionSummary(client, scope, approval.approval_level);
      await audit({ entityType: 'approval', entityId: approval.id, action: `approval.${input.decision.toLowerCase()}`, actorUserId: input.actor?.id, instituteId: request.institute_id, requestId: request.id, correlationId, beforeData: { status: approval.status, isActive: approval.is_active }, afterData: { status: input.decision, isActive: false }, reason: input.reason, metadata: { approvalStepId: approval.id, routeSnapshotId: approval.route_snapshot_id, routeVersion: approval.approval_route_version, approvalLevel: approval.approval_level, ...summary }, client });

      let nextApprovals = []; let requestTransition = null; let nextLevel = null;
      if (input.decision === DECISIONS.APPROVE && summary.pendingCount === 0 && summary.rejectedCount === 0 && summary.returnedCount === 0) {
        nextLevel = await repository.getNextLevel(client, scope, approval.approval_level);
        if (nextLevel == null) {
          requestTransition = await lifecycle.transition({ requestId: request.id, toStatus: 'Approved', expectedStatus: request.status, actor: input.actor, permission: 'approvals.decide', correlationId, idempotencyKey: input.idempotencyKey, metadata: { approvalStepId: approval.id, routeSnapshotId: approval.route_snapshot_id, routeVersion: approval.approval_route_version, approvalLevel: approval.approval_level, ...summary } }, client);
        } else nextApprovals = await activateLevel(client, scope, nextLevel, correlationId);
        await audit({ entityType: 'request', entityId: request.id, action: 'approval.level_completed', actorUserId: input.actor?.id, instituteId: request.institute_id, requestId: request.id, correlationId, metadata: { requestId: request.id, routeVersion: approval.approval_route_version, routeSnapshotId: approval.route_snapshot_id, approvalLevel: approval.approval_level, ...summary, nextLevel }, client });
      } else if (input.decision !== DECISIONS.APPROVE) {
        await repository.deactivatePendingLevel(client, scope, approval.approval_level);
        requestTransition = await lifecycle.transition({ requestId: request.id, toStatus: input.decision, expectedStatus: request.status, actor: input.actor, permission: 'approvals.decide', reason: input.reason, correlationId, idempotencyKey: input.idempotencyKey, metadata: { approvalStepId: approval.id, routeSnapshotId: approval.route_snapshot_id, routeVersion: approval.approval_route_version, approvalLevel: approval.approval_level, ...summary } }, client);
      }
      await notify(client, { type: 'approval.decided', entityType: 'approval', entityId: approval.id, userId: request.requester_id, correlationId, idempotencyKey: `approval:${approval.id}:decision:${input.decision}:${input.idempotencyKey || updated.rows[0].decided_at || 'decided'}`, payload: { requestId: request.id, decision: input.decision, reason: input.reason } });
      return { approval: updated.rows[0], currentLevelState: summary, nextApprovals, nextApproval: nextApprovals[0] || null, requestTransition };
    }, { client: suppliedClient });
  }

  async function reassign({ approvalId, newApproverId, actor, reason, correlationId }, suppliedClient = null) {
    if (!reason?.trim()) throw new ApprovalEngineError('A reassignment reason is required', 'REASON_REQUIRED', 400);
    return withTransaction(async client => {
      const discovered = await repository.findApproval(client, approvalId);
      if (!discovered) throw new ApprovalEngineError('Approval not found', 'APPROVAL_NOT_FOUND', 404);
      if (discovered.is_superseded === true) throw new ApprovalEngineError('Superseded approvals cannot be reassigned', 'APPROVAL_SUPERSEDED');
      await repository.lockRequest(client, discovered.request_id);
      const workflow = await repository.lockWorkflow(client, workflowScope(discovered));
      const before = workflow.find(row => Number(row.id) === Number(approvalId));
      if (!before || before.status !== 'Pending') throw new ApprovalEngineError('Only pending approvals can be reassigned', 'APPROVAL_NOT_PENDING');
      if (before.is_superseded === true) throw new ApprovalEngineError('Superseded approvals cannot be reassigned', 'APPROVAL_SUPERSEDED');
      if (workflow.some(row => row.id !== before.id && Number(row.approval_level) === Number(before.approval_level) && Number(row.approver_id) === Number(newApproverId))) throw new ApprovalEngineError('The new approver is already a member of this level', 'DUPLICATE_APPROVAL_MEMBER', 409);
      let result;
      try {
        result = await client.query("UPDATE approvals SET approver_id=$1 WHERE id=$2 AND status='Pending' AND COALESCE(is_superseded,FALSE)=FALSE RETURNING *", [newApproverId, approvalId]);
      } catch (error) {
        if (error.code === '23505') throw new ApprovalEngineError('The new approver is already a member of this level', 'DUPLICATE_APPROVAL_MEMBER', 409);
        throw error;
      }
      if (!result.rows[0]) throw new ApprovalEngineError('Concurrent approval reassignment detected', 'CONCURRENT_REASSIGNMENT');
      await audit({ entityType: 'approval', entityId: approvalId, action: 'approval.reassigned', actorUserId: actor?.id, requestId: before.request_id, correlationId, beforeData: { approverId: before.approver_id }, afterData: { approverId: newApproverId }, reason, metadata: { approvalLevel: before.approval_level, routeVersion: before.approval_route_version, routeSnapshotId: before.route_snapshot_id }, client });
      if (result.rows[0].is_active) await notificationForActive(client, result.rows[0], correlationId);
      return result.rows[0];
    }, { client: suppliedClient });
  }

  return { createSteps, decide, reassign, activateNext, activateLevel, supersedeWorkflow };
}

module.exports = { createApprovalEngine, ApprovalEngineError, ...createApprovalEngine() };