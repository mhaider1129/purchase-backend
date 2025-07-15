// controllers/requests/assignRequestController.js
const pool = require('../../config/db');
const { successResponse, errorResponse } = require('../../utils/responseFormatter');

const assignRequestToUser = async (req, res) => {
  const { request_id, user_id } = req.body;
  const assignerId = req.user.id;
  const assignerRole = req.user.role;

  // 🔐 Only SCM or Admin can assign
  if (!['SCM', 'admin'].includes(assignerRole)) {
    return errorResponse(res, 403, '⛔ Only SCM or Admin can assign requests');
  }

  // ✅ Validate input
  if (!request_id || !user_id || isNaN(request_id) || isNaN(user_id)) {
    return errorResponse(res, 400, '❗ request_id and user_id must be valid numbers');
  }

  try {
    const statusCheck = await pool.query(
      'SELECT status, assigned_to FROM requests WHERE id = $1',
      [request_id]
    );

    if (statusCheck.rowCount === 0) {
      return errorResponse(res, 404, `❌ Request with ID ${request_id} not found`);
    }

    const { status, assigned_to } = statusCheck.rows[0];

    if (['completed', 'Rejected'].includes(status)) {
      return errorResponse(res, 400, '⚠️ Cannot assign a request that is already finalized');
    }

    if (status !== 'Approved') {
      return errorResponse(res, 400, '⚠️ Request must be fully approved before assignment');
    }




    const userCheck = await pool.query(
      `SELECT id, name FROM users
       WHERE id = $1 AND role IN ('ProcurementSupervisor', 'ProcurementSpecialist', 'SCM') AND is_active = true`,
      [user_id]
    );

    if (userCheck.rowCount === 0) {
      return errorResponse(res, 400, '❌ Assigned user not valid or not active procurement staff/SCM');
    }

    const assignedName = userCheck.rows[0].name;

    let logAction = 'assigned_to_procurement';
    let logComment = `Assigned to ${assignedName} (ID: ${user_id})`;

    if (assigned_to) {
      if (assigned_to === parseInt(user_id, 10)) {
        return errorResponse(res, 400, '⚠️ Request already assigned to this user');
      }

      const prevRes = await pool.query('SELECT name FROM users WHERE id = $1', [assigned_to]);
      const prevName = prevRes.rows[0]?.name || assigned_to;

      logAction = 'reassigned_to_procurement';
      logComment = `Reassigned from ${prevName} (ID: ${assigned_to}) to ${assignedName} (ID: ${user_id})`;
    }

    const updateRes = await pool.query(
      'UPDATE requests SET assigned_to = $1 WHERE id = $2 RETURNING id, request_type, assigned_to',
      [user_id, request_id]
    );

    await pool.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, $2, $3, $4)`,
      [request_id, logAction, assignerId, logComment]
    );

    // Optional audit log
    // await pool.query(
    //   `INSERT INTO audit_log (user_id, action_type, target_type, target_id, details, timestamp)
    //    VALUES ($1, 'assign', 'request', $2, $3, CURRENT_TIMESTAMP)`,
    //   [assignerId, request_id, `Assigned to ${assignedName}`]
    // );

    return successResponse(res, '✅ Request assigned successfully', {
      ...updateRes.rows[0],
      assigned_user: assignedName
    });

  } catch (err) {
    console.error('❌ Error assigning request:', err);
    return errorResponse(res, 500, 'Internal server error while assigning request');
  }
};

module.exports = assignRequestToUser;

