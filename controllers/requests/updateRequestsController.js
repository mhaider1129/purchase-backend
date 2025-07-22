const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');

const assignRequestToProcurement = async (req, res, next) => {
  const { request_id, user_id } = req.body;
  if (!['SCM', 'admin'].includes(req.user.role))
    return next(createHttpError(403, 'Only SCM or Admin can assign requests'));

  try {
    const userCheck = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role IN ('ProcurementSupervisor','ProcurementSpecialist')`,
      [user_id],
    );
    if (userCheck.rowCount === 0)
      return next(createHttpError(400, 'Invalid procurement staff'));

    await pool.query(
      `UPDATE requests SET assigned_to = $1 WHERE id = $2`,
      [user_id, request_id],
    );

    res.json({ message: '✅ Request assigned successfully' });
  } catch (err) {
    console.error('❌ Assignment error:', err);
    next(createHttpError(500, 'Failed to assign request'));
  }
};

const updateApprovalStatus = async (req, res, next) => {
  const approval_id = req.params.id;
  const { status: decision, comments = '', is_urgent = false } = req.body;
  const approver_id = req.user.id;

  if (!['Approved', 'Rejected'].includes(decision)) {
    return next(createHttpError(400, 'Approval status must be either Approved or Rejected'));
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const approvalRes = await client.query(
      `SELECT id, request_id, approval_level FROM approvals
       WHERE id = $1 AND approver_id = $2 AND is_active = true`,
      [approval_id, approver_id],
    );

    if (approvalRes.rowCount === 0) {
      return next(createHttpError(403, 'You are not the active approver for this request'));
    }

    const currentApproval = approvalRes.rows[0];
    const request_id = currentApproval.request_id;

    await client.query(
      `UPDATE approvals
       SET status = $1, is_active = false, approved_at = CURRENT_TIMESTAMP, comments = $2, is_urgent = COALESCE($3, is_urgent)
       WHERE id = $4`,
      [decision, comments, is_urgent, approval_id],
    );

    if (is_urgent === true) {
      await client.query(`UPDATE requests SET is_urgent = true WHERE id = $1`, [request_id]);
    }

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, $2, $3, $4)`,
      [request_id, decision, approver_id, comments],
    );

    const reqRes = await client.query(
      `SELECT request_type, department_id FROM requests WHERE id = $1`,
      [request_id],
    );
    const { request_type, department_id } = reqRes.rows[0];

    if (request_type === 'Maintenance' && currentApproval.approval_level === 1) {
      await client.query(`UPDATE requests SET requester_id = $1 WHERE id = $2`, [approver_id, request_id]);

      const deptRes = await client.query(`SELECT type FROM departments WHERE id = $1`, [department_id]);
      const deptType = deptRes.rows[0]?.type.toLowerCase();

      let nextRoles = ['HOD', 'SCM', 'COO'];
      if (deptType === 'medical') nextRoles.splice(2, 0, 'CMO');

      for (let i = 0; i < nextRoles.length; i++) {
        const nextUserRes = await client.query(
          `SELECT id FROM users WHERE role = $1 AND department_id = $2 AND is_active = true LIMIT 1`,
          [nextRoles[i], department_id],
        );

        if (nextUserRes.rowCount > 0) {
          await client.query(
            `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status)
             VALUES ($1, $2, $3, $4, 'Pending')`,
            [request_id, nextUserRes.rows[0].id, currentApproval.approval_level + 1 + i, i === 0],
          );
        }
      }
    } else {
      if (decision === 'Rejected') {
        await client.query(`UPDATE requests SET status = 'Rejected' WHERE id = $1`, [request_id]);
      } else {
        const nextApprovalRes = await client.query(
          `SELECT id FROM approvals WHERE request_id = $1 AND approval_level = $2`,
          [request_id, currentApproval.approval_level + 1],
        );

        if (nextApprovalRes.rowCount > 0) {
          await client.query(
            `UPDATE approvals SET is_active = true WHERE id = $1`,
            [nextApprovalRes.rows[0].id],
          );
        } else {
          await client.query(`UPDATE requests SET status = 'Approved' WHERE id = $1`, [request_id]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ message: `✅ Request ${decision.toLowerCase()} successfully` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error in approval workflow:', err);
    next(createHttpError(500, 'Failed to update approval status'));
  } finally {
    client.release();
  }
};

const markRequestAsCompleted = async (req, res, next) => {
  const { id } = req.params;
  const { user_id, role } = req.user;

  const allowedRoles = ['SCM', 'ProcurementSupervisor', 'ProcurementSpecialist'];
  if (!allowedRoles.includes(role)) {
    return next(createHttpError(403, 'Unauthorized to mark request as completed'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemCheck = await client.query(
      `SELECT COUNT(*) AS incomplete_count
       FROM requested_items
       WHERE request_id = $1
         AND (
           procurement_status IS NULL OR procurement_status = '' OR purchased_quantity IS NULL
         )`,
      [id],
    );

    const incompleteCount = parseInt(itemCheck.rows[0].incomplete_count);
    if (incompleteCount > 0) {
      await client.query('ROLLBACK');
      return next(
        createHttpError(
          400,
          'Not all items have a procurement status and purchased quantity.'
        )
      );
    }

    await client.query(
      `UPDATE requests
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id],
    );

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Marked as Completed', $2, 'All items finalized by procurement')`,
      [id, user_id],
    );

    await client.query('COMMIT');
    res.json({ message: '✅ Request marked as completed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to mark request as completed:', err.message);
    next(createHttpError(500, 'Failed to complete the request'));
  } finally {
    client.release();
  }
};

const updateRequestCost = async (req, res, next) => {
  const { id } = req.params;
  const { estimated_cost } = req.body;
  const { user_id, role } = req.user;

  const allowedRoles = ['SCM', 'ProcurementSupervisor', 'ProcurementSpecialist'];
  if (!allowedRoles.includes(role)) {
    return next(createHttpError(403, 'Unauthorized to update request cost'));
  }

  if (!estimated_cost || isNaN(estimated_cost) || Number(estimated_cost) <= 0) {
    return next(createHttpError(400, 'Valid estimated_cost is required and must be > 0'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqRes = await client.query('SELECT id FROM requests WHERE id = $1', [id]);
    if (reqRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Request not found'));
    }

    await client.query(
      `UPDATE requests SET estimated_cost = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [estimated_cost, id]
    );

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Total Cost Updated', $2, $3)`,
      [id, user_id, `Updated total cost to ${estimated_cost}`]
    );

    await client.query('COMMIT');

    res.json({ message: '✅ Request cost updated successfully', estimated_cost: Number(estimated_cost) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update request cost:', err.message);
    next(createHttpError(500, 'Failed to update request cost'));
  } finally {
    client.release();
  }
};

const approveMaintenanceRequest = async (req, res, next) => {
  const { request_id, decision, comments = '' } = req.body;
  const user_id = req.user.id;

  if (!['Approved', 'Rejected'].includes(decision)) {
    return next(createHttpError(400, 'Decision must be Approved or Rejected'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqRes = await client.query(`SELECT * FROM requests WHERE id = $1`, [request_id]);
    if (reqRes.rowCount === 0) throw createHttpError(404, 'Request not found');

    if (decision === 'Rejected') {
      await client.query(`UPDATE requests SET status = 'Rejected' WHERE id = $1`, [request_id]);

      await client.query(
        `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Maintenance Request Rejected by Requester', $2, $3)`,
        [request_id, user_id, comments],
      );
    } else {
      await client.query(
        `UPDATE requests
         SET requester_id = $1, status = 'Submitted', updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [user_id, request_id],
      );

      await client.query(
        `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Maintenance Request Approved by Requester', $2, $3)`,
        [request_id, user_id, comments],
      );

      await client.query(
        `UPDATE approvals
         SET status = 'Approved',
             approved_at = NOW(),
             comments = $1,
             is_active = false
         WHERE request_id = $2 AND approver_id = $3`,
        [comments, request_id, user_id],
      );

      const { initializeApprovals } = require('../utils/initializeApprovals');
      await initializeApprovals(request_id, client);
    }

    await client.query('COMMIT');
    res.json({ message: `Request ${decision.toLowerCase()} successfully.` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Maintenance approval error:', err);
    next(createHttpError(500, 'Failed to process maintenance request decision'));
  } finally {
    client.release();
  }
};

module.exports = {
  assignRequestToProcurement,
  updateApprovalStatus,
  markRequestAsCompleted,
  updateRequestCost,
  approveMaintenanceRequest,
};