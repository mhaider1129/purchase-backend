const withTransaction = require('../utils/withTransaction');
const { ENTITY_TYPES } = require('../domain/statusConstants');
const { createRequestTransitionService } = require('../domain/statusTransitionService');
const { validateLifecycleCommand } = require('../validators/requestLifecycleValidator');
const requestPolicy = require('../policies/requestPolicy');
const auditService = require('./auditService');
const outbox = require('./notificationOutboxService');
const { ensureCaseForRequestedItem } = require('./procurementPerformance/procurementCaseService');
const { createProcurementPerformanceRepository } = require('../repositories/procurementPerformanceRepository');

class RequestLifecycleError extends Error { constructor(message, code, statusCode = 409) { super(message); this.name = 'RequestLifecycleError'; this.code = code; this.statusCode = statusCode; } }

function createRequestLifecycleService(dependencies = {}) {
  const transitions = dependencies.transitions || createRequestTransitionService();
  const policy = dependencies.policy || requestPolicy.assertCanTransition;
  const audit = dependencies.audit || auditService.writeAuditEvent;
  const notify = dependencies.notify || outbox.enqueueNotification;

  async function transition(command, suppliedClient = null) {
    const input = validateLifecycleCommand(command);
    return withTransaction(async client => {
      const { rows } = await client.query('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [input.requestId]);
      const request = rows[0];
      if (!request) throw new RequestLifecycleError('Request not found', 'REQUEST_NOT_FOUND', 404);
      if (input.expectedStatus && request.status !== input.expectedStatus) throw new RequestLifecycleError('Request was changed by another operation', 'STALE_TRANSITION');
      await policy({ actor: input.actor, request, permission: input.permission });
      const validation = transitions.validate({ entityType: ENTITY_TYPES.REQUEST, currentState: request.status, nextState: input.toStatus, actor: input.actor?.id, reason: input.reason, allowIdempotent: input.allowIdempotent });
      if (validation.idempotent) return { requestId: request.id, before: request.status, after: request.status, changed: false, idempotent: true, idempotencyKey: input.idempotencyKey };
      const result = await client.query('UPDATE requests SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3 RETURNING *', [validation.to, request.id, request.status]);
      if (result.rowCount !== 1) throw new RequestLifecycleError('Concurrent request transition detected', 'CONCURRENT_TRANSITION');
      const correlationId = input.correlationId || input.idempotencyKey || null;
      await audit({ entityType: 'request', entityId: request.id, action: `request.${validation.to.toLowerCase().replace(/ /g, '_')}`, actorUserId: input.actor?.id, instituteId: request.institute_id, requestId: request.id, correlationId, beforeData: { status: request.status }, afterData: { status: validation.to }, reason: input.reason, metadata: input.metadata || {}, client });
      const eventKey = input.idempotencyKey
        ? `request:${request.id}:transition:${request.status}:${validation.to}:${input.idempotencyKey}`
        : `request:${request.id}:transition:${request.status}:${validation.to}:${result.rows[0].lifecycle_version ?? Date.now()}`;
      await notify(client, { type: 'request.lifecycle.changed', entityType: 'request', entityId: request.id, userId: request.requester_id, correlationId, idempotencyKey: eventKey, payload: { previousStatus: request.status, newStatus: validation.to, reason: input.reason } });
      if (['APPROVED','FULLY_APPROVED','READY_FOR_PROCUREMENT'].includes(String(validation.to).toUpperCase())) {
        const items=await client.query(`SELECT ri.*,r.status AS request_status,r.institute_id,r.department_id FROM requested_items ri JOIN requests r ON r.id=ri.request_id WHERE ri.request_id=$1 ORDER BY ri.id`,[request.id]);
        const performanceRepository=createProcurementPerformanceRepository(client);
        for(const item of items.rows) await ensureCaseForRequestedItem({repository:performanceRepository,requestedItem:item,actorId:input.actor?.id});
      }
      return { requestId: request.id, before: request.status, after: validation.to, changed: true, idempotent: false, request: result.rows[0] };
    }, { client: suppliedClient });
  }
  async function resetForReclassification({ requestId, actor, expectedStatus }, suppliedClient = null) {
    return withTransaction(async client => {
      const { rows } = await client.query('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [requestId]);
      const request = rows[0];
      if (!request) throw new RequestLifecycleError('Request not found', 'REQUEST_NOT_FOUND', 404);
      if (expectedStatus && request.status !== expectedStatus) throw new RequestLifecycleError('Request was changed by another operation', 'STALE_TRANSITION');
      await requestPolicy.assertCanTransition({ actor, request, permission: 'requests.reclassify', requireExplicitPermission: true });
      const allowed = new Set(['Draft', 'Submitted', 'Pending', 'Returned']);
      if (!allowed.has(request.status)) throw new RequestLifecycleError(`Reclassification is blocked after procurement begins (current status: ${request.status})`, 'RECLASSIFICATION_BLOCKED');
      if (request.status === 'Submitted') return { request, before: request.status, after: request.status, changed: false };
      const updated = await client.query("UPDATE requests SET status='Submitted',updated_at=NOW() WHERE id=$1 AND status=$2 RETURNING *", [request.id, request.status]);
      if (updated.rowCount !== 1) throw new RequestLifecycleError('Concurrent request transition detected', 'CONCURRENT_TRANSITION');
      return { request: updated.rows[0], before: request.status, after: 'Submitted', changed: true };
    }, { client: suppliedClient });
  }
  return { transition, resetForReclassification };
}

module.exports = { createRequestLifecycleService, RequestLifecycleError, ...createRequestLifecycleService() };