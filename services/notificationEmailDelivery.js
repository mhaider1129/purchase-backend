"use strict";
const crypto = require("crypto");
const authority = require("./eventAuthority");
const retry = (count) => Math.min(3600, 15 * 2 ** Math.max(0, count - 1));
async function enqueue(client, event) {
  if (!event.recipient_user_id || event.institute_id == null) return;
  await client.query(
    `INSERT INTO notification_email_deliveries(outbox_event_id,recipient_user_id,institute_id,idempotency_key) VALUES($1,$2,$3,$4) ON CONFLICT(outbox_event_id,recipient_user_id) DO NOTHING`,
    [
      event.id,
      event.recipient_user_id,
      event.institute_id,
      `outbox-email:${event.id}:user:${event.recipient_user_id}`,
    ],
  );
}
function create({
  database,
  send = require("../utils/emailService").sendEmail,
} = {}) {
  async function transaction(work) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='15s'",
      );
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  async function processOne() {
    const claim = await transaction(async (db) => {
      const job = (
        await db.query(
          "SELECT * FROM notification_email_deliveries WHERE (status IN ('pending','failed') AND next_attempt_at<=clock_timestamp()) OR (status='processing' AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp())) ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!job) return null;
      if (job.attempt_count >= 8) {
        await db.query(
          "UPDATE notification_email_deliveries SET status='dead_letter',error_category='RETRY_EXHAUSTED',lease_token=NULL,lease_expires_at=NULL WHERE id=$1",
          [job.id],
        );
        return { terminal: true, id: job.id };
      }
      const token = crypto.randomUUID();
      await db.query(
        "UPDATE notification_email_deliveries SET status='processing',attempt_count=attempt_count+1,lease_token=$1,lease_expires_at=clock_timestamp()+interval '2 minutes',last_attempt_at=clock_timestamp() WHERE id=$2",
        [token, job.id],
      );
      return { ...job, attempt_count: job.attempt_count + 1, token };
    });
    if (!claim || claim.terminal) return claim;
    let heartbeat;
    try {
      const prepared = await transaction(async (db) => {
        const event = (
          await db.query("SELECT * FROM notification_outbox WHERE id=$1", [
            claim.outbox_event_id,
          ])
        ).rows[0];
        if (!event) throw authority.fail("EVENT_SOURCE_NOT_FOUND");
        const user = await authority.recipient(db, event);
        if (!user?.email) return null;
        let message = event.payload.message || "";
        if (event.payload.approvalId) {
          const links =
            require("../utils/emailService").buildApprovalActionLinks({
              approvalId: event.payload.approvalId,
              approverId: user.id,
            });
          message += `\n\nQuick actions:\nApprove: ${links.approveUrl}\nReject: ${links.rejectUrl}`;
        }
        return {
          to: user.email,
          subject: event.payload.title || event.event_type,
          message,
        };
      });
      if (!prepared) {
        await finish(claim, "suppressed", "RECIPIENT_NO_LONGER_AUTHORIZED");
        return { id: claim.id, status: "suppressed" };
      }
      const renew = () =>
        transaction((db) =>
          db.query(
            "UPDATE notification_email_deliveries SET lease_expires_at=clock_timestamp()+interval '2 minutes' WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_expires_at>clock_timestamp()",
            [claim.id, claim.token],
          ),
        );
      if (!(await renew()).rowCount)
        return { id: claim.id, status: "lease_lost" };
      let renewing = false;
      heartbeat = setInterval(async () => {
        if (renewing) return;
        renewing = true;
        try {
          await renew();
        } catch (_) {
          /* Lease expiry remains recoverable after database loss. */
        } finally {
          renewing = false;
        }
      }, 30000);
      heartbeat.unref();
      // No open database transaction spans this external side effect. SMTP may
      // redeliver after ambiguous acknowledgement; Message-ID is not a dedupe promise.
      const result = await send(
        prepared.to,
        prepared.subject,
        prepared.message,
        {
          throwOnError: true,
          messageId: `<${claim.idempotency_key.replace(/[^a-zA-Z0-9-]/g, "-")}@purchase-tracker>`,
          idempotencyKey: claim.idempotency_key,
        },
      );
      if (!result || result.dryRun)
        throw Object.assign(
          new Error("Email not accepted by an external transport"),
          { code: "EMAIL_UNAVAILABLE" },
        );
      if (
        Array.isArray(result.accepted) &&
        !result.accepted.some(
          (address) =>
            String(address).toLowerCase() === prepared.to.toLowerCase(),
        )
      )
        throw Object.assign(new Error("Recipient rejected by transport"), {
          responseCode: 550,
        });
      const ack = await finish(claim, "delivered", null);
      if (!ack.rowCount) return { id: claim.id, status: "lease_lost" };
      return { id: claim.id, status: "delivered" };
    } catch (e) {
      const permanent =
        e.permanent || /^5\d\d$/.test(String(e.responseCode || ""));
      const state =
        permanent || claim.attempt_count >= 8 ? "dead_letter" : "failed";
      await finish(
        claim,
        state,
        permanent
          ? "PERMANENT_DELIVERY_FAILURE"
          : e.code === "EMAIL_UNAVAILABLE"
            ? "EMAIL_UNAVAILABLE"
            : "EXTERNAL_DELIVERY_FAILED",
      ).catch(() => {});
      return { id: claim.id, status: state };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }
  async function finish(claim, status, category) {
    return transaction((db) =>
      db.query(
        "UPDATE notification_email_deliveries SET status=$1,error_category=$2,lease_token=NULL,lease_expires_at=NULL,acknowledged_at=CASE WHEN $1='delivered' THEN clock_timestamp() ELSE NULL END,next_attempt_at=clock_timestamp()+make_interval(secs=>$3) WHERE id=$4 AND status='processing' AND lease_token=$5",
        [status, category, retry(claim.attempt_count), claim.id, claim.token],
      ),
    );
  }
  async function processBatch(limit = 25) {
    const results = [];
    for (let i = 0; i < limit; i++) {
      const result = await processOne();
      if (!result) break;
      results.push(result);
    }
    return results;
  }
  return { processOne, processBatch };
}
module.exports = { enqueue, create };
