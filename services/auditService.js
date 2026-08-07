const pool = require('../config/db');

async function writeAuditEvent(event) {
  const { entityType, entityId, action, actorUserId = null, instituteId = null,
    requestId = null, correlationId = null, beforeData = null, afterData = null,
    metadata = null, reason = null, client = null } = event || {};
  if (!entityType || entityId == null || !action) throw new TypeError('entityType, entityId, and action are required');
  const database = client || pool;
  const details = { instituteId, requestId, correlationId, beforeData, afterData, metadata, reason };
  const result = await database.query(
    `INSERT INTO audit_logs (action, action_type, actor_id, target_type, target_id, description, details)
     VALUES ($1,$1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
    [action, actorUserId, entityType, String(entityId), reason || `${action} ${entityType}`, JSON.stringify(details)]
  );
  return result.rows[0];
}

module.exports = { writeAuditEvent };