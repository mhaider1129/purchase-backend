const crypto = require('crypto');
const withTransaction = require('../utils/withTransaction');
const requestPolicy = require('../policies/requestPolicy');
const lifecycle = require('./requestLifecycleService');
const routeResolver = require('./approvalRouteResolver');
const approvalEngine = require('./approvalEngine');
const auditService = require('./auditService');
const outbox = require('./notificationOutboxService');
const { fetchApprovalRoutes, resolveRouteDomain } = require('../controllers/utils/approvalRoutes');

const REQUEST_TYPES = new Set(['Stock','Non-Stock','Medical Device','Medication','IT Item','Maintenance','Warehouse Supply','Printing Logbook']);
const failure = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });

async function reclassifyRequest(command, suppliedClient = null) {
  const { requestId, targetRequestType, actor, reason = 'Request type corrected', correlationId = crypto.randomUUID() } = command;
  if (!REQUEST_TYPES.has(targetRequestType)) throw failure(400, 'Invalid request type', 'INVALID_REQUEST_TYPE');
  return withTransaction(async client => {
    const locked = await client.query('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [requestId]);
    const before = locked.rows[0];
    if (!before) throw failure(404, 'Request not found', 'REQUEST_NOT_FOUND');
    await requestPolicy.assertCanTransition({ actor, request: before, permission: 'requests.reclassify' });
    if (before.request_type === targetRequestType) throw failure(400, 'The request already has this type', 'SAME_REQUEST_TYPE');
    const domain = await resolveRouteDomain({ client, departmentId: before.department_id, explicitDomain: before.request_domain, requestType: targetRequestType });
    const configured = await fetchApprovalRoutes({ client, requestType: targetRequestType, departmentType: domain, amount: before.estimated_cost || 0 });
    if (!configured.length) throw failure(422, 'No approval route is configured for the selected request type', 'MISSING_ROUTE');
    const resolved = [];
    for (const step of configured) {
      let approverId = step.approver_id;
      if (!approverId) {
        const user = await client.query(`SELECT id FROM users WHERE LOWER(role)=LOWER($1) AND is_active=TRUE
          AND ($2::int IS NULL OR department_id=$2 OR LOWER($1) IN ('scm','admin')) ORDER BY id LIMIT 1`, [step.role, before.department_id || null]);
        approverId = user.rows[0]?.id;
      }
      resolved.push({ ...step, approver_id: approverId });
    }
    const baseSnapshot = await routeResolver.resolveApprovalRoute({ client, configuredRoute: resolved, requestType: targetRequestType,
      classification: domain, departmentId: before.department_id, sectionId: before.section_id, instituteId: before.institute_id,
      cost: before.estimated_cost, requesterId: before.requester_id });
    const versionResult = await client.query('SELECT COALESCE(MAX(approval_route_version),0)+1 AS version FROM approvals WHERE request_id=$1', [requestId]);
    const snapshot = { ...baseSnapshot, version: Number(versionResult.rows[0].version) };
    const reset = await lifecycle.resetForReclassification({ requestId, actor, expectedStatus: before.status }, client);
    await approvalEngine.supersedeWorkflow({ requestId, actor, reason, replacementSnapshotId: snapshot.snapshotId }, client);
    await client.query('UPDATE requests SET request_type=$1,request_domain=$2,updated_at=NOW() WHERE id=$3', [targetRequestType, domain, requestId]);
    const created = await approvalEngine.createSteps({ requestId, routeSnapshot: snapshot, actor, correlationId }, client);
    await auditService.writeAuditEvent({ entityType: 'request', entityId: requestId, action: 'request.reclassified', actorUserId: actor.id,
      instituteId: before.institute_id, requestId, correlationId,
      beforeData: { requestType: before.request_type, requestDomain: before.request_domain, status: before.status, routeSnapshotId: before.approval_route_snapshot_id },
      afterData: { requestType: targetRequestType, requestDomain: domain, status: reset.after, routeSnapshotId: snapshot.snapshotId }, reason,
      metadata: { previousRouteVersion: before.approval_route_snapshot?.version || null, newRouteVersion: snapshot.version }, client });
    await outbox.enqueueNotification(client, { type: 'request.reclassified', entityType: 'request', entityId: requestId,
      userId: before.requester_id, correlationId, idempotencyKey: `request:${requestId}:reclassified:${snapshot.snapshotId}`,
      payload: { previousRequestType: before.request_type, requestType: targetRequestType, requestDomain: domain, reason } });
    return { request_id: requestId, request_type: targetRequestType, request_domain: domain, status: reset.after,
      route_snapshot_id: created.routeSnapshotId, correlation_id: correlationId };
  }, { client: suppliedClient });
}

module.exports = { REQUEST_TYPES, reclassifyRequest };