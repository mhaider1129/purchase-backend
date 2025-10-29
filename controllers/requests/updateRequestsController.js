const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const { assignApprover } = require('./createRequestController');

const assignRequestToProcurement = async (req, res, next) => {
  const { request_id, user_id } = req.body;
  if (!['SCM', 'admin'].includes(req.user.role))
    return next(createHttpError(403, 'Only SCM or Admin can assign requests'));

  try {
    const userCheck = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'ProcurementSpecialist'`,
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
  const {
    status: decision,
    comments = '',
    is_urgent = false,
    estimated_cost: estimatedCostInput,
  } = req.body;
  const approver_id = req.user.id;

  if (!['Approved', 'Rejected'].includes(decision)) {
    return next(createHttpError(400, 'Approval status must be either Approved or Rejected'));
  }

  const sanitizedEstimatedCost =
    estimatedCostInput !== undefined &&
    estimatedCostInput !== null &&
    String(estimatedCostInput).trim() !== ''
      ? Number(estimatedCostInput)
      : null;

  if (sanitizedEstimatedCost !== null) {
    if (Number.isNaN(sanitizedEstimatedCost) || sanitizedEstimatedCost <= 0) {
      return next(createHttpError(400, 'estimated_cost must be a positive number'));
    }

    if (req.user.role !== 'SCM') {
      return next(createHttpError(403, 'Only SCM can update estimated cost during approval'));
    }
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
      `SELECT request_type, department_id, request_domain, estimated_cost
         FROM requests
        WHERE id = $1`,
      [request_id],
    );
    const requestRow = reqRes.rows[0];
    const { request_type, department_id } = requestRow;

    let effectiveEstimatedCost = Number(requestRow.estimated_cost) || 0;

    if (sanitizedEstimatedCost !== null) {
      effectiveEstimatedCost = sanitizedEstimatedCost;

      await client.query(
        `UPDATE requests
            SET estimated_cost = $1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2`,
        [sanitizedEstimatedCost, request_id],
      );

      await client.query(
        `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Estimated Cost Updated', $2, $3)`,
        [
          request_id,
          approver_id,
          `SCM set estimated cost to ${sanitizedEstimatedCost}`,
        ],
      );
    }

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
        if (req.user.role === 'SCM' && effectiveEstimatedCost > 5000) {
          const { rowCount: cfoExists } = await client.query(
            `SELECT 1
               FROM approvals a
               JOIN users u ON a.approver_id = u.id
              WHERE a.request_id = $1
                AND UPPER(u.role) = 'CFO'
              LIMIT 1`,
            [request_id],
          );

          if (cfoExists === 0) {
            const deptRes = await client.query(
              `SELECT type
                 FROM departments
                WHERE id = $1`,
              [department_id],
            );
            const deptType = deptRes.rows[0]?.type?.toLowerCase() || null;
            const domainForRoutes =
              request_type === 'Warehouse Supply'
                ? requestRow.request_domain || deptType || 'operational'
                : deptType || requestRow.request_domain || 'operational';

            let insertionLevel = currentApproval.approval_level + 1;

            const { rows: cfoRouteRows } = await client.query(
              `SELECT approval_level
                 FROM approval_routes
                WHERE request_type = $1
                  AND department_type = $2
                  AND role = 'CFO'
                  AND $3 BETWEEN COALESCE(min_amount, 0) AND COALESCE(max_amount, 999999999)
                ORDER BY approval_level
                LIMIT 1`,
              [request_type, domainForRoutes, effectiveEstimatedCost],
            );

            if (cfoRouteRows.length > 0) {
              insertionLevel = cfoRouteRows[0].approval_level;
            } else {
              const { rows: cooRows } = await client.query(
                `SELECT approval_level
                   FROM approvals a
                   JOIN users u ON a.approver_id = u.id
                  WHERE a.request_id = $1
                    AND UPPER(u.role) = 'COO'
                  LIMIT 1`,
                [request_id],
              );

              if (cooRows.length > 0) {
                insertionLevel = cooRows[0].approval_level;
              }
            }

            const { rows: approvalsToShift } = await client.query(
              `SELECT id, approval_level
                 FROM approvals
                WHERE request_id = $1
                  AND approval_level >= $2
                ORDER BY approval_level DESC`,
              [request_id, insertionLevel],
            );

            for (const row of approvalsToShift) {
              await client.query(
                `UPDATE approvals
                    SET approval_level = $1
                  WHERE id = $2`,
                [row.approval_level + 1, row.id],
              );
            }

            await assignApprover(
              client,
              'CFO',
              department_id,
              request_id,
              request_type,
              insertionLevel,
              requestRow.request_domain,
            );

            await client.query(
              `INSERT INTO request_logs (request_id, action, actor_id, comments)
               VALUES ($1, 'Approval Route Updated', $2, $3)`,
              [
                request_id,
                approver_id,
                `Inserted CFO approval at level ${insertionLevel} after estimated cost ${effectiveEstimatedCost}`,
              ],
            );
          }
        }

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
  const { id: user_id, role } = req.user;

  const allowedRoles = ['SCM', 'ProcurementSpecialist'];
  if (!allowedRoles.includes(role)) {
    return next(createHttpError(403, 'Unauthorized to mark request as completed'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemCheck = await client.query(
      `SELECT COUNT(*) AS incomplete_count
       FROM public.requested_items
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
  const { id: user_id, role } = req.user;

  const allowedRoles = ['SCM', 'ProcurementSpecialist'];
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

const reassignMaintenanceRequestToRequester = async (req, res, next) => {
  const { request_id, approval_id } = req.body;

  if (!request_id || !approval_id) {
    return next(createHttpError(400, 'request_id and approval_id are required'));
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const approvalRes = await client.query(
      `SELECT
         a.approver_id,
         a.status,
         a.is_active,
         a.approval_level,
         r.department_id,
         r.section_id,
         r.request_type,
         r.requester_id
       FROM approvals a
       JOIN requests r ON r.id = a.request_id
       WHERE a.id = $1 AND a.request_id = $2
       FOR UPDATE`,
      [approval_id, request_id],
    );

    if (approvalRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Approval not found for this request'));
    }

    const approval = approvalRes.rows[0];

    if (approval.request_type !== 'Maintenance') {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Reassignment is only available for maintenance requests'));
    }

    if (approval.approval_level !== 1) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Only level 1 approvals can be reassigned to a department requester'));
    }

    if (approval.status !== 'Pending' || approval.is_active === false) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Only pending, active approvals can be reassigned'));
    }

    if (approval.approver_id !== req.user.id) {
      await client.query('ROLLBACK');
      return next(createHttpError(403, 'You are not the active approver for this request'));
    }

    const designatedRes = await client.query(
      `SELECT id, name
         FROM users
        WHERE LOWER(role) = 'requester'
          AND department_id = $1
          AND ($2::INT IS NULL OR section_id = $2)
          AND is_active = true
        ORDER BY id
        LIMIT 1`,
      [approval.department_id, approval.section_id],
    );

    if (designatedRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'No active department requester found for this request'));
    }

    const designatedRequester = designatedRes.rows[0];

    if (designatedRequester.id === approval.approver_id) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Request is already assigned to the department requester'));
    }

    await client.query(
      `UPDATE approvals
         SET approver_id = $1,
             updated_at = NOW()
       WHERE id = $2`,
      [designatedRequester.id, approval_id],
    );

    await client.query(
      `UPDATE requests
         SET requester_id = $1,
             updated_at = NOW()
       WHERE id = $2`,
      [designatedRequester.id, request_id],
    );

    await client.query(
      `INSERT INTO approval_logs (approval_id, request_id, approver_id, action, comments)
       VALUES ($1, $2, $3, $4, $5)`,
      [approval_id, request_id, req.user.id, 'Reassigned', `Reassigned to department requester ${designatedRequester.name || designatedRequester.id}`],
    );

    const previousRequester = approval.requester_id || 'none';
    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, $2, $3, $4)`,
      [
        request_id,
        'Requester Reassigned',
        req.user.id,
        `Requester changed from ${previousRequester} to ${designatedRequester.name || designatedRequester.id}`,
      ],
    );

    await client.query('COMMIT');

    res.json({
      message: '✅ Maintenance request reassigned to department requester',
      request_id,
      approval_id,
      new_requester_id: designatedRequester.id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to reassign maintenance request to requester:', err);
    next(createHttpError(500, 'Failed to reassign request to department requester'));
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
  reassignMaintenanceRequestToRequester,
};