// controllers/requestedItems/updateProcurementStatusController.js
const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');

const updateItemProcurementStatus = async (req, res, next) => {
  const { item_id } = req.params;
  const requestedStatus = req.body.status ?? req.body.procurement_status;
  const comment = req.body.comment ?? req.body.procurement_comment ?? '';
  const updater_id = req.user.id;
  const statusAliases = {
    cancelled: 'canceled',
    unable_to_procure: 'not_procured',
  };
  const normalizedRequestedStatus = String(requestedStatus || '').trim().toLowerCase();
  const status = statusAliases[normalizedRequestedStatus] || normalizedRequestedStatus;
  const allowedStatuses = ['pending', 'partially_procured', 'purchased', 'completed', 'not_procured', 'canceled'];

  if (!req.user.hasPermission('procurement.update-status')) {
    return next(createHttpError(403, 'You do not have permission to update procurement status'));
  }

  if (!allowedStatuses.includes(status)) {
    return next(createHttpError(400, 'Invalid procurement status'));
  }

  try {
    const result = await pool.query(
      `UPDATE public.requested_items
       SET procurement_status = $1,
           procurement_comment = $2,
           procurement_updated_by = $3,
           procurement_updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [status, comment, updater_id, item_id]
    );

    if (result.rowCount === 0) {
      return next(createHttpError(404, 'Requested item not found'));
    }

    // ✅ Add to audit_log
    await pool.query(
      `INSERT INTO audit_log (user_id, action_type, target_type, target_id, details, timestamp)
       VALUES ($1, 'update', 'requested_item', $2, $3, CURRENT_TIMESTAMP)`,
      [updater_id, item_id, `Status changed to ${status} with comment: ${comment}`]
    );

    res.json({ message: 'Procurement status updated', item: result.rows[0] });
  } catch (err) {
    console.error(err);
    next(createHttpError(500, 'Failed to update procurement status'));
  }
};

module.exports = updateItemProcurementStatus;

