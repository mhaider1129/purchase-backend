const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const ensureCentralSupplyChainTrackingColumns = require('../../utils/ensureCentralSupplyChainTrackingColumns');
const auditService = require('../../services/auditService');

/**
 * request_logs is the established audit trail for request lifecycle changes.
 * The generic audit log is supplementary and has multiple legacy schemas in
 * deployed installations, so a PostgreSQL error there must not roll back the
 * status change or its canonical request log entry.
 */
const writeCentralSupplyAudit = async ({ client, requestId, before, after, sent, userId }) => {
  await client.query(
    `INSERT INTO public.request_logs (request_id, action, actor_id, comments)
     VALUES ($1, $2, $3, $4)`,
    [
      requestId,
      'Central Supply Chain status changed',
      userId,
      sent ? 'Marked as sent to Central Supply Chain' : 'Marked as not sent to Central Supply Chain',
    ],
  );

  await client.query('SAVEPOINT central_supply_audit');
  try {
    await auditService.writeAuditEvent({
      client,
      entityType: 'request',
      entityId: requestId,
      requestId,
      instituteId: before.institute_id,
      actorUserId: userId,
      action: 'request.central_supply_status_changed',
      beforeData: { sent: before.sent_to_central_supply_at != null, sent_to_central_supply_at: before.sent_to_central_supply_at, sent_to_central_supply_by: before.sent_to_central_supply_by },
      afterData: { sent, sent_to_central_supply_at: after.sent_to_central_supply_at, sent_to_central_supply_by: after.sent_to_central_supply_by },
    });
    await client.query('RELEASE SAVEPOINT central_supply_audit');
  } catch (error) {
    // PostgreSQL SQLSTATE values are five characters. Only database/schema
    // compatibility failures are optional; application errors still fail.
    if (!/^[0-9A-Z]{5}$/.test(error?.code || '')) throw error;
    await client.query('ROLLBACK TO SAVEPOINT central_supply_audit');
    await client.query('RELEASE SAVEPOINT central_supply_audit');
  }
};

const updateCentralSupplyChainStatus = async (req, res, next) => {
  const requestId = Number.parseInt(req.params.id, 10);
  const sent = req.body?.sent;

  if (!Number.isInteger(requestId) || requestId <= 0) return next(createHttpError(400, 'A valid request ID is required'));
  if (typeof sent !== 'boolean') return next(createHttpError(400, 'The sent value must be true or false'));
  if (!req.user.hasPermission('requests.manage')) return next(createHttpError(403, 'Not authorized to update Central Supply Chain status'));

  let client;
  try {
    await ensureCentralSupplyChainTrackingColumns();
    client = await pool.connect();
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT id, institute_id, sent_to_central_supply_at, sent_to_central_supply_by
         FROM public.requests
        WHERE id = $1 AND ($2::integer IS NULL OR institute_id = $2)
        FOR UPDATE`,
      [requestId, req.user.institute_id ?? null],
    );
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Request not found'));
    }

    const result = await client.query(
      `UPDATE public.requests
          SET sent_to_central_supply_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
              sent_to_central_supply_by = CASE WHEN $1 THEN $2 ELSE NULL END
        WHERE id = $3
        RETURNING id, institute_id, sent_to_central_supply_at, sent_to_central_supply_by`,
      [sent, req.user.id, requestId],
    );
    const before = current.rows[0];
    const after = result.rows[0];
    await writeCentralSupplyAudit({ client, requestId, before, after, sent, userId: req.user.id });
    await client.query('COMMIT');
    res.json(after);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Failed to update Central Supply Chain status:', err);
    if (err.code === 'CENTRAL_SUPPLY_SCHEMA_NOT_READY') return next(err);
    next(createHttpError(500, 'Failed to update Central Supply Chain status'));
  } finally {
    client?.release();
  }
};

module.exports = { updateCentralSupplyChainStatus };