const crypto = require("crypto");

function keyFor(event) {
  const explicit =
    typeof event?.idempotencyKey === "string"
      ? event.idempotencyKey.trim()
      : "";
  if (explicit) return explicit;
  const eventId =
    typeof event?.eventId === "string" ? event.eventId.trim() : "";
  if (!eventId)
    throw Object.assign(
      new TypeError(
        "A deterministic event-specific idempotencyKey or eventId is required",
      ),
      { code: "OUTBOX_IDEMPOTENCY_KEY_REQUIRED", statusCode: 400 },
    );
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        event.type,
        event.entityType,
        String(event.entityId),
        event.userId ?? null,
        eventId,
      ]),
    )
    .digest("hex");
}

async function enqueueNotification(client, event) {
  if (!client?.query) throw new TypeError("A transaction client is required");
  if (!event?.type || !event.entityType || event.entityId == null)
    throw new TypeError("type, entityType, and entityId are required");
  await require("../utils/requireAuditTransaction")(client);
  const context = await require("./eventAuthority").resolve(client, event);
  if (
    event.recipientKind &&
    !["internal", "user"].includes(event.recipientKind)
  )
    throw require("./eventAuthority").fail("UNSUPPORTED_RECIPIENT_KIND");
  if (event.userId && context.instituteId == null)
    throw require("./eventAuthority").fail("EVENT_SOURCE_SCOPE_REQUIRED");
  if (event.userId && context.instituteId != null) {
    const user = (
      await client.query("SELECT institute_id FROM users WHERE id=$1", [
        event.userId,
      ])
    ).rows[0];
    if (!user || Number(user.institute_id) !== Number(context.instituteId))
      throw require("./eventAuthority").fail("RECIPIENT_INSTITUTE_CONFLICT");
  }

  const payload = { ...(event.payload || {}) };
  if (context.requestId != null) payload.requestId = context.requestId;
  if (event.type === "approval.action_required")
    payload.approvalId = event.entityId;
  const idempotencyKey = keyFor(event);
  const insert = await client.query(
    `INSERT INTO notification_outbox (event_type, entity_type, entity_id, recipient_user_id, payload, idempotency_key, status,institute_id,payload_version)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'pending',$7,1) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [
      event.type,
      event.entityType,
      String(event.entityId),
      event.userId || null,
      JSON.stringify(payload),
      idempotencyKey,
      context.instituteId,
    ],
  );
  if (insert.rows[0]) return { event: insert.rows[0], created: true };
  const existing = await client.query(
    "SELECT * FROM notification_outbox WHERE idempotency_key=$1",
    [idempotencyKey],
  );
  if (!existing.rows[0])
    throw Object.assign(
      new Error("Outbox conflict row could not be retrieved"),
      { code: "OUTBOX_CONFLICT_MISSING", statusCode: 409 },
    );
  const previous = existing.rows[0];
  if (
    previous.event_type !== event.type ||
    previous.entity_type !== event.entityType ||
    String(previous.entity_id) !== String(event.entityId) ||
    String(previous.recipient_user_id || "") !== String(event.userId || "")
  )
    throw require("./eventAuthority").fail("OUTBOX_IDEMPOTENCY_CONFLICT");
  const equal = (
    await client.query("SELECT $1::jsonb=$2::jsonb same", [
      JSON.stringify(previous.payload),
      JSON.stringify(payload),
    ])
  ).rows[0]?.same;
  if (!equal)
    throw require("./eventAuthority").fail("OUTBOX_IDEMPOTENCY_CONFLICT");
  return { event: previous, created: false };
}

module.exports = { enqueueNotification, keyFor };
