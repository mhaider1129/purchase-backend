const { REQUEST_STATUS, normalizeStatus } = require('../domain/statusConstants');

const REASON_REQUIRED = new Set([REQUEST_STATUS.REJECTED, REQUEST_STATUS.RETURNED, REQUEST_STATUS.CANCELLED]);

function validateLifecycleCommand(command = {}) {
  const requestId = Number(command.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) throw Object.assign(new TypeError('requestId must be a positive integer'), { code: 'INVALID_REQUEST_ID' });
  const toStatus = normalizeStatus(command.toStatus);
  if (!toStatus) throw Object.assign(new TypeError('toStatus is required'), { code: 'STATUS_REQUIRED' });
  const reason = typeof command.reason === 'string' ? command.reason.trim() : '';
  const idempotencyKey = typeof command.idempotencyKey === 'string' ? command.idempotencyKey.trim() : '';
  if (command.allowIdempotent === true && !idempotencyKey) {
    throw Object.assign(new TypeError('A non-empty idempotencyKey is required when allowIdempotent is true'), { code: 'IDEMPOTENCY_KEY_REQUIRED', statusCode: 400 });
  }
  if ((REASON_REQUIRED.has(toStatus) || command.override || command.reopening) && !reason) {
    throw Object.assign(new TypeError('A reason is required for this transition'), { code: 'REASON_REQUIRED' });
  }
  return { ...command, requestId, toStatus, reason: reason || null, idempotencyKey: idempotencyKey || null, allowIdempotent: command.allowIdempotent === true };
}

module.exports = { validateLifecycleCommand, REASON_REQUIRED };