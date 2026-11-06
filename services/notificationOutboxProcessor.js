const pool = require("../config/db");

const DEFAULT_MAX_RETRIES = 8;
const retryDelaySeconds = (retryCount) =>
  Math.min(3600, 15 * 2 ** Math.max(0, retryCount - 1));

async function deliverInApp(client, event) {
  const authority = require("./eventAuthority"),
    context = await authority.resolve(client, event);
  if (
    event.institute_id != null &&
    Number(event.institute_id) !== Number(context.instituteId)
  )
    throw authority.fail("EVENT_INSTITUTE_CONFLICT");
  const user = event.recipient_user_id
    ? await authority.recipient(client, event, context)
    : null;
  if (event.recipient_user_id && !user) return { suppressed: true };
  event = { ...event, institute_id: context.instituteId };
  if (event.event_type === "WORKFLOW_EMAIL") {
    await require("./notificationEmailDelivery").enqueue(client, event);
    return;
  }
  if (event.event_type === "PROCUREMENT_ASSIGNMENT_CHANGED")
    return require("./procurementAssignmentNotification").deliverAssignmentNotification(
      client,
      event,
    );
  const {
    captureBusinessEvent,
  } = require("./procurementPerformance/procurementEvidenceService");
  const {
    createProcurementPerformanceRepository,
  } = require("../repositories/procurementPerformanceRepository");
  const payload = event.payload || {};
  await captureBusinessEvent({
    repository: createProcurementPerformanceRepository(client),
    event: {
      type: event.event_type,
      entityType: event.entity_type,
      entityId: event.entity_id,
      requestedItemIds:
        payload.requestedItemIds || payload.requested_item_ids || [],
      occurredAt: event.created_at,
      actorId: payload.actorId || payload.actor_id,
      supplierId: payload.supplierId || payload.supplier_id,
      purchaseOrderStatus: payload.status || payload.purchase_order_status,
      receiptComplete: payload.receiptComplete ?? payload.receipt_complete,
    },
  });
  if (!event.recipient_user_id) return;
  await client.query(
    `INSERT INTO notifications (user_id,title,message,link,metadata,outbox_event_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (outbox_event_id) DO NOTHING`,
    [
      event.recipient_user_id,
      payload.title || event.event_type,
      payload.message || payload.reason || event.event_type,
      payload.link || null,
      JSON.stringify({ ...payload, eventType: event.event_type }),
      event.id,
    ],
  );
  if (payload.email)
    await require("./notificationEmailDelivery").enqueue(client, event);
}

function createNotificationOutboxProcessor({
  database = pool,
  deliver = deliverInApp,
  maxRetries = DEFAULT_MAX_RETRIES,
} = {}) {
  async function processOne() {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='15s'",
      );
      const claimed = await client.query(
        `SELECT * FROM notification_outbox
          WHERE ((status IN ('pending','failed') AND next_attempt_at <= NOW())
              OR (status='processing' AND (processing_started_at IS NULL OR processing_started_at < NOW() - INTERVAL '15 minutes')))
            AND $1>0
          ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
        [maxRetries],
      );
      const event = claimed.rows[0];
      if (!event) {
        await client.query("COMMIT");
        return null;
      }
      if (event.retry_count >= maxRetries) {
        await client.query(
          "UPDATE notification_outbox SET status='dead_letter',error_category='RETRY_EXHAUSTED' WHERE id=$1",
          [event.id],
        );
        await client.query("COMMIT");
        return { id: event.id, status: "dead_letter", terminal: true };
      }
      await client.query(
        "UPDATE notification_outbox SET status='processing', processing_started_at=NOW(), last_error=NULL WHERE id=$1",
        [event.id],
      );
      await client.query("SAVEPOINT notification_delivery");
      try {
        const result = await deliver(client, event);
        await client.query("RELEASE SAVEPOINT notification_delivery");
        await client.query(
          "UPDATE notification_outbox SET status=$2, processed_at=NOW(), processing_started_at=NULL,error_category=CASE WHEN $2='suppressed' THEN 'RECIPIENT_NO_LONGER_AUTHORIZED' ELSE NULL END WHERE id=$1",
          [event.id, result?.suppressed ? "suppressed" : "delivered"],
        );
        await client.query("COMMIT");
        return {
          id: event.id,
          status: result?.suppressed ? "suppressed" : "delivered",
        };
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT notification_delivery");
        const retries = Number(event.retry_count || 0) + 1;
        const terminal = error.permanent || retries >= maxRetries;
        await client.query(
          `UPDATE notification_outbox SET status=$6,retry_count=$2,last_error=NULL,error_category=$3,
             next_attempt_at=NOW()+($4 * INTERVAL '1 second'),processing_started_at=NULL,
             processed_at=CASE WHEN $5 THEN NOW() ELSE NULL END WHERE id=$1`,
          [
            event.id,
            retries,
            error.permanent ? "PERMANENT_EVENT_FAILURE" : "PROCESSING_FAILED",
            retryDelaySeconds(retries),
            terminal,
            terminal ? "dead_letter" : "failed",
          ],
        );
        await client.query("COMMIT");
        return {
          id: event.id,
          status: terminal ? "dead_letter" : "failed",
          retryCount: retries,
          terminal,
        };
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function processBatch(limit = 25) {
    const results = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await processOne();
      if (!result) break;
      results.push(result);
    }
    const emails = await require("./notificationEmailDelivery")
      .create({ database })
      .processBatch(limit);
    return [...results, ...emails];
  }
  return { processOne, processBatch };
}

module.exports = {
  createNotificationOutboxProcessor,
  deliverInApp,
  retryDelaySeconds,
  ...createNotificationOutboxProcessor(),
};
