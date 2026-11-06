const pool = require("../../config/db");
const createHttpError = require("../../utils/httpError");
const ensureCentralSupplyChainTrackingColumns = require("../../utils/ensureCentralSupplyChainTrackingColumns");
const auditService = require("../../services/auditService");

const runOptionalDatabaseWrite = async (client, savepoint, write) => {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await write();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return true;
  } catch (error) {
    // The compatibility request log is optional. PostgreSQL
    // errors abort the transaction, while serializers and legacy audit service
    // implementations can throw ordinary JavaScript errors. In either case the
    // savepoint lets us recover without turning a successful status update into
    // an HTTP 500. A failure to recover the transaction still propagates.
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    console.warn(
      `Skipped optional Central Supply Chain audit write (${savepoint}):`,
      error,
    );
    return false;
  }
};

// The authoritative audit is mandatory. The compatibility request log can remain
// optional because older deployments differ; it cannot substitute for audit_logs.
const writeCentralSupplyAudit = async ({
  client,
  requestId,
  before,
  after,
  sent,
  userId,
}) => {
  await auditService.writeAuditEvent({
    client,
    entityType: "request",
    entityId: requestId,
    requestId,
    instituteId: before.institute_id,
    actorUserId: userId,
    action: "request.central_supply_status_changed",
    beforeData: {
      sent: before.sent_to_central_supply_at != null,
      sent_to_central_supply_at: before.sent_to_central_supply_at,
      sent_to_central_supply_by: before.sent_to_central_supply_by,
    },
    afterData: {
      sent,
      sent_to_central_supply_at: after.sent_to_central_supply_at,
      sent_to_central_supply_by: after.sent_to_central_supply_by,
    },
  });
  await runOptionalDatabaseWrite(client, "central_supply_request_log", () =>
    client.query(
      `INSERT INTO public.request_logs (request_id, action, actor_id, comments) VALUES ($1,$2,$3,$4)`,
      [
        requestId,
        "Central Supply Chain status changed",
        userId,
        sent
          ? "Marked as sent to Central Supply Chain"
          : "Marked as not sent to Central Supply Chain",
      ],
    ),
  );
};

const updateCentralSupplyChainStatus = async (req, res, next) => {
  const requestId = /^\d+$/.test(String(req.params.id))
    ? Number(req.params.id)
    : NaN;
  const sent = req.body?.sent;

  if (!Number.isSafeInteger(requestId) || requestId <= 0)
    return next(createHttpError(400, "A valid request ID is required"));
  if (typeof sent !== "boolean")
    return next(createHttpError(400, "The sent value must be true or false"));

  let client;
  try {
    await ensureCentralSupplyChainTrackingColumns();
    client = await pool.connect();
    await client.query("BEGIN");
    const actor = await require("../../services/p2pAuthorization").loadActor(
      client,
      req.user,
      "requests.manage",
    );
    const current = await client.query(
      `SELECT id, institute_id, sent_to_central_supply_at, sent_to_central_supply_by
         FROM public.requests
        WHERE id = $1 AND institute_id = $2
        FOR UPDATE`,
      [requestId, actor.institute_id],
    );
    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return next(createHttpError(404, "Request not found"));
    }

    if ((current.rows[0].sent_to_central_supply_at != null) === sent) {
      await client.query("COMMIT");
      return res.json(current.rows[0]);
    }

    const result = await client.query(
      `UPDATE public.requests
          SET sent_to_central_supply_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
              sent_to_central_supply_by = CASE WHEN $1 THEN $2::integer ELSE NULL END
        WHERE id = $3
        RETURNING id, institute_id, sent_to_central_supply_at, sent_to_central_supply_by`,
      [sent, actor.id, requestId],
    );
    const before = current.rows[0];
    const after = result.rows[0];
    await writeCentralSupplyAudit({
      client,
      requestId,
      before,
      after,
      sent,
      userId: actor.id,
    });
    await client.query("COMMIT");
    res.json(after);
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to update Central Supply Chain status:", err);
    if (err.statusCode || err.code === "CENTRAL_SUPPLY_SCHEMA_NOT_READY")
      return next(err);
    next(createHttpError(500, "Failed to update Central Supply Chain status"));
  } finally {
    client?.release();
  }
};

module.exports = { updateCentralSupplyChainStatus };
