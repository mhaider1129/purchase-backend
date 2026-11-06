"use strict";
const crypto = require("crypto");
const outbox = require("./notificationOutboxService");
const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function notice(
  client,
  {
    requestId,
    userId,
    title,
    message,
    link,
    metadata = {},
    operationKey,
    approvalId,
    email = false,
  },
) {
  if (!userId) return null;
  const source = metadata.technical_review_id
    ? {
        entityType: "preprocurement_technical_review",
        entityId: metadata.technical_review_id,
      }
    : metadata.delivery_inspection_id
      ? {
          entityType: "delivery_inspection",
          entityId: metadata.delivery_inspection_id,
        }
      : { entityType: "request", entityId: requestId ?? metadata.requestId };
  if (source.entityId == null)
    throw new Error("A canonical notification source is required");
  return outbox.enqueueNotification(client, {
    type: "WORKFLOW_NOTICE",
    ...source,
    userId,
    idempotencyKey: `workflow-notice:${source.entityType}:${source.entityId}:${userId}:${operationKey || "workflow"}:${digest(operationKey ? [title, metadata.action] : [title, message, metadata])}`,
    payload: {
      title,
      message,
      link,
      requestId: requestId ?? metadata.requestId,
      ...metadata,
      ...(approvalId ? { approvalId } : {}),
      email,
    },
  });
}
async function email(
  client,
  { requestId, to, userId, subject, message, approvalId, operationKey },
) {
  const request = (
    await client.query("SELECT institute_id FROM requests WHERE id=$1", [
      requestId,
    ])
  ).rows[0];
  if (!request) throw new Error("Notification request not found");
  const emails = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const users = userId
    ? [{ id: userId }]
    : (
        await client.query(
          "SELECT id FROM users WHERE institute_id=$1 AND is_active=true AND lower(email)=ANY($2::text[])",
          [request.institute_id, emails.map((s) => String(s).toLowerCase())],
        )
      ).rows;
  const result = [];
  for (const user of users)
    result.push(
      await outbox.enqueueNotification(client, {
        type: "WORKFLOW_EMAIL",
        entityType: "request",
        entityId: requestId,
        userId: user.id,
        idempotencyKey: `workflow-email:${requestId}:${user.id}:${operationKey || "workflow"}:${digest(subject)}`,
        payload: {
          requestId,
          title: subject,
          message,
          link: `/requests/${requestId}`,
          ...(approvalId ? { approvalId } : {}),
          email: true,
        },
      }),
    );
  return result;
}
module.exports = { notice, email };
