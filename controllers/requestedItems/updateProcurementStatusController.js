// controllers/requestedItems/updateProcurementStatusController.js
const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');

const updateItemProcurementStatus = async (req, res, next) => {
  const { item_id } = req.params;
  const { status, comment } = req.body;
  const updater_id = req.user.id;
  const role = req.user.role;

  const allowedRoles = ['SCM', 'Procurement Specialist', 'ProcurementSupervisor'];
  const allowedStatuses = ['pending', 'purchased', 'completed', 'canceled'];

  if (!allowedRoles.includes(role)) {
    return next(createHttpError(403, 'Unauthorized to update procurement status'));
  }

  if (!allowedStatuses.includes(status)) {
    return next(createHttpError(400, 'Invalid procurement status'));
  }

  try {
    const result = await pool.query(
      `UPDATE requested_items
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

