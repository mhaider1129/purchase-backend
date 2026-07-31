const crypto = require('crypto');

const keyFor = event => event.idempotencyKey || crypto.createHash('sha256').update(JSON.stringify([event.type, event.entityType, event.entityId, event.userId, event.correlationId])).digest('hex');

async function enqueueNotification(client, event) {
  if (!client?.query) throw new TypeError('A transaction client is required');
  if (!event?.type || !event.entityType || event.entityId == null) throw new TypeError('type, entityType, and entityId are required');
  const idempotencyKey = keyFor(event);
  const { rows } = await client.query(
    `INSERT INTO notification_outbox (event_type, entity_type, entity_id, recipient_user_id, payload, idempotency_key, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'pending') ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`,
    [event.type, event.entityType, String(event.entityId), event.userId || null, JSON.stringify(event.payload || {}), idempotencyKey],
  );
  return rows[0];
}

module.exports = { enqueueNotification, keyFor };