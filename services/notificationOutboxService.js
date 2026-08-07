const crypto = require('crypto');

function keyFor(event) {
  const explicit = typeof event?.idempotencyKey === 'string' ? event.idempotencyKey.trim() : '';
  if (explicit) return explicit;
  const eventId = typeof event?.eventId === 'string' ? event.eventId.trim() : '';
  if (!eventId) throw Object.assign(new TypeError('A deterministic event-specific idempotencyKey or eventId is required'), { code: 'OUTBOX_IDEMPOTENCY_KEY_REQUIRED', statusCode: 400 });
  return crypto.createHash('sha256').update(JSON.stringify([event.type, event.entityType, String(event.entityId), event.userId ?? null, eventId])).digest('hex');
}

async function enqueueNotification(client, event) {
  if (!client?.query) throw new TypeError('A transaction client is required');
  if (!event?.type || !event.entityType || event.entityId == null) throw new TypeError('type, entityType, and entityId are required');
  const idempotencyKey = keyFor(event);
  const insert = await client.query(
    `INSERT INTO notification_outbox (event_type, entity_type, entity_id, recipient_user_id, payload, idempotency_key, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'pending') ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [event.type, event.entityType, String(event.entityId), event.userId || null, JSON.stringify(event.payload || {}), idempotencyKey],
  );
  if (insert.rows[0]) return { event: insert.rows[0], created: true };
  const existing = await client.query('SELECT * FROM notification_outbox WHERE idempotency_key=$1', [idempotencyKey]);
  if (!existing.rows[0]) throw Object.assign(new Error('Outbox conflict row could not be retrieved'), { code: 'OUTBOX_CONFLICT_MISSING', statusCode: 409 });
  return { event: existing.rows[0], created: false };
}

module.exports = { enqueueNotification, keyFor };