const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const ensureCentralSupplyChainTrackingColumns = require('../../utils/ensureCentralSupplyChainTrackingColumns');
const auditService = require('../../services/auditService');

const isDatabaseError = (error) => /^[0-9A-Z]{5}$/.test(error?.code || '');

const runOptionalDatabaseWrite = async (client, savepoint, write) => {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await write();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return true;
  } catch (error) {
    if (!isDatabaseError(error)) throw error;
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return false;
  }
};

/**
 * Deployed installations can have incompatible legacy request_logs and generic
 * audit schemas. Isolate each audit sink so either one can preserve the event,
 * while a schema mismatch in both does not roll back the requested status.
 */
const writeCentralSupplyAudit = async ({ client, requestId, before, after, sent, userId }) => {
  const requestLogWritten = await runOptionalDatabaseWrite(client, 'central_supply_request_log', () => client.query(
    `INSERT INTO public.request_logs (request_id, action, actor_id, comments)
     VALUES ($1, $2, $3, $4)`,
    [requestId, 'Central Supply Chain status changed', userId,
      sent ? 'Marked as sent to Central Supply Chain' : 'Marked as not sent to Central Supply Chain'],
  ));

  const auditEventWritten = await runOptionalDatabaseWrite(client, 'central_supply_audit', () =>
    auditService.writeAuditEvent({
      client,
      entityType: 'request',
      entityId: requestId,
      requestId,
      instituteId: before.institute_id,
      actorUserId: userId,
      action: 'request.central_supply_status_changed',
      beforeData: { sent: before.sent_to_central_supply_at != null, sent_to_central_supply_at: before.sent_to_central_supply_at, sent_to_central_supply_by: before.sent_to_central_supply_by },
      afterData: { sent, sent_to_central_supply_at: after.sent_to_central_supply_at, sent_to_central_supply_by: after.sent_to_central_supply_by },
    }),
  );

  if (!requestLogWritten && !auditEventWritten) {
    console.warn('Central Supply Chain status updated without an audit record because both audit schemas rejected the write');
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