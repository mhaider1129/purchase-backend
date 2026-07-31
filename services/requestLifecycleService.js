const withTransaction = require('../utils/withTransaction');
const { ENTITY_TYPES } = require('../domain/statusConstants');
const { createRequestTransitionService } = require('../domain/statusTransitionService');
const { validateLifecycleCommand } = require('../validators/requestLifecycleValidator');
const requestPolicy = require('../policies/requestPolicy');
const auditService = require('./auditService');
const outbox = require('./notificationOutboxService');

class RequestLifecycleError extends Error { constructor(message, code, status = 409) { super(message); this.name = 'RequestLifecycleError'; this.code = code; this.status = status; } }

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
      const validation = transitions.validate({ entityType: ENTITY_TYPES.REQUEST, currentState: request.status, nextState: input.toStatus, actor: input.actor?.id, reason: input.reason, allowIdempotent: input.allowIdempotent !== false });
      if (validation.idempotent) return { requestId: request.id, before: request.status, after: request.status, changed: false, idempotent: true };
      const result = await client.query('UPDATE requests SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3 RETURNING *', [validation.to, request.id, request.status]);
      if (result.rowCount !== 1) throw new RequestLifecycleError('Concurrent request transition detected', 'CONCURRENT_TRANSITION');
      const correlationId = input.correlationId || input.idempotencyKey || null;
      await audit({ entityType: 'request', entityId: request.id, action: `request.${validation.to.toLowerCase().replace(/ /g, '_')}`, actorUserId: input.actor?.id, instituteId: request.institute_id, requestId: request.id, correlationId, beforeData: { status: request.status }, afterData: { status: validation.to }, reason: input.reason, metadata: input.metadata || {}, client });
      await notify(client, { type: 'request.lifecycle.changed', entityType: 'request', entityId: request.id, userId: request.requester_id, correlationId, idempotencyKey: input.idempotencyKey, payload: { previousStatus: request.status, newStatus: validation.to, reason: input.reason } });
      return { requestId: request.id, before: request.status, after: validation.to, changed: true, idempotent: false, request: result.rows[0] };
    }, { client: suppliedClient });
  }
  return { transition };
}

module.exports = { createRequestLifecycleService, RequestLifecycleError, ...createRequestLifecycleService() };