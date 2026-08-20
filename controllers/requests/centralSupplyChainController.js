const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const ensureCentralSupplyChainTrackingColumns = require('../../utils/ensureCentralSupplyChainTrackingColumns');

const updateCentralSupplyChainStatus = async (req, res, next) => {
  const requestId = Number.parseInt(req.params.id, 10);
  const sent = req.body?.sent;

  if (!Number.isInteger(requestId) || requestId <= 0) {
    return next(createHttpError(400, 'A valid request ID is required'));
  }
  if (typeof sent !== 'boolean') {
    return next(createHttpError(400, 'The sent value must be true or false'));
  }
  if (!req.user.hasPermission('requests.manage')) {
    return next(createHttpError(403, 'Not authorized to update Central Supply Chain status'));
  }

  try {
    await ensureCentralSupplyChainTrackingColumns();
    const result = await pool.query(
      `UPDATE public.requests
       SET sent_to_central_supply_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
           sent_to_central_supply_by = CASE WHEN $1 THEN $2 ELSE NULL END
       WHERE id = $3
         AND ($4::integer IS NULL OR institute_id = $4)
       RETURNING id, sent_to_central_supply_at, sent_to_central_supply_by`,
      [sent, req.user.id, requestId, req.user.institute_id ?? null],
    );

    if (result.rowCount === 0) return next(createHttpError(404, 'Request not found'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update Central Supply Chain status:', err);
    next(createHttpError(500, 'Failed to update Central Supply Chain status'));
  }
};

module.exports = { updateCentralSupplyChainStatus };