const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const ensureCentralSupplyChainTrackingColumns = require('../../utils/ensureCentralSupplyChainTrackingColumns');
const auditService = require('../../services/auditService');

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
    await auditService.writeAuditEvent({
      client,
      entityType: 'request',
      entityId: requestId,
      requestId,
      instituteId: before.institute_id,
      actorUserId: req.user.id,
      action: 'request.central_supply_status_changed',
      beforeData: { sent: before.sent_to_central_supply_at != null, sent_to_central_supply_at: before.sent_to_central_supply_at, sent_to_central_supply_by: before.sent_to_central_supply_by },
      afterData: { sent, sent_to_central_supply_at: after.sent_to_central_supply_at, sent_to_central_supply_by: after.sent_to_central_supply_by },
    });
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