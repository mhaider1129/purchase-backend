// src/controllers/approvalsController.js
const pool = require('../config/db');
const { sendEmail } = require('../utils/emailService');
const createHttpError = require('../utils/httpError');
const ensureRequestedItemApprovalColumns = require('../utils/ensureRequestedItemApprovalColumns');
const { assignApprover } = require('./requests/createRequestController');

const fetchApprovalRoutes = async (client, requestType, departmentType, cost) => {
  const { rows } = await client.query(
    `SELECT approval_level, role
       FROM approval_routes
      WHERE request_type = $1
        AND department_type = $2
        AND $3 BETWEEN COALESCE(min_amount, 0) AND COALESCE(max_amount, 999999999)
      ORDER BY approval_level`,
    [requestType, departmentType, cost],
  );
  return rows;
};

// 🧰 Helper to rollback and return error
const rollbackWithError = async (client, res, next, status, msg) => {
  await client.query('ROLLBACK');
  return next(createHttpError(status, msg));
};

// 🔘 Handle Approval Decision
const handleApprovalDecision = async (req, res, next) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return next(createHttpError(400, 'Invalid approval ID'));
  }
  const approvalId = Number(id);
  const { status, comments } = req.body;
  // authMiddleware exposes the logged in user's id as `id`
  const approver_id = req.user.id;
  const user_role = req.user.role;

  if (!['Approved', 'Rejected'].includes(status)) {
    return next(createHttpError(400, 'Invalid status value'));
  }

  await ensureRequestedItemApprovalColumns();

  const approverId = req.user?.id ?? null;
  if (!approverId) {
    return next(createHttpError(403, 'Unable to identify the current approver'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch Approval Row
    const approvalRes = await client.query(
      `SELECT * FROM approvals WHERE id = $1`,
      [approvalId]
    );
    const approval = approvalRes.rows[0];
    if (!approval) return rollbackWithError(client, res, next, 404, 'Approval not found');
    if (approval.status !== 'Pending') return rollbackWithError(client, res, next, 403, `This approval has already been ${approval.status.toLowerCase()}.`);
    if (!approval.is_active) return rollbackWithError(client, res, next, 403, 'This approval is not yet active for your action.');
    if (approval.approver_id !== approver_id) return rollbackWithError(client, res, next, 403, 'You are not authorized to act on this approval.');

    // 2. Fetch Request
    const requestRes = await client.query(
      `SELECT r.*, p.name AS project_name, u.email AS requester_email
       FROM requests r
       LEFT JOIN projects p ON r.project_id = p.id
       JOIN users u ON r.requester_id = u.id
       WHERE r.id = $1`,
      [approval.request_id]
    );
    const request = requestRes.rows[0];
    if (!request) return rollbackWithError(client, res, next, 404, 'Request not found');

    // 3. HOD Role Validation
    if (user_role === 'HOD' && req.user.department_id !== request.department_id) {
      return rollbackWithError(client, res, next, 403, 'Only the HOD of the same department can approve this request');
    }

    // 4. Validate Role Against Approval Route
    const routeRes = await client.query(`
      SELECT ar.role
      FROM approval_routes ar
      JOIN departments d ON d.id = $1
      WHERE ar.request_type = $2
        AND ar.department_type = d.type
        AND ar.approval_level = $3
        AND $4 BETWEEN ar.min_amount AND ar.max_amount
      LIMIT 1
    `, [request.department_id, request.request_type, approval.approval_level, request.estimated_cost]);

    const expectedRole = routeRes.rows[0]?.role;
    if (expectedRole && expectedRole !== user_role) {
      return rollbackWithError(client, res, next, 403, `Only users with role '${expectedRole}' can approve at this level.`);
    }

    // 5. Ensure Previous Approvals Are Completed
    if (approval.approval_level > 1) {
      const prevRes = await client.query(
        `SELECT id FROM approvals WHERE request_id = $1 AND approval_level < $2 AND status != 'Approved'`,
        [approval.request_id, approval.approval_level]
      );
      if (prevRes.rows.length > 0) {
        return rollbackWithError(client, res, next, 403, 'Previous level approvals are still pending.');
      }
    }

    // 6. Update Approval Decision
    await client.query(
      `UPDATE approvals
      SET status = $1,
          comments = $2,
          approved_at = NOW(),
          is_active = FALSE
          WHERE id = $3`,
      [status, comments || null, approvalId]
    );

    // 7. Insert Audit Logs
    await client.query(`
      INSERT INTO request_logs (request_id, action, actor_id, comments)
      VALUES ($1, $2, $3, $4)
    `, [approval.request_id, `Approval ${status}`, approver_id, comments || null]);

    await client.query(
      `INSERT INTO approval_logs (approval_id, request_id, approver_id, action, comments)
      VALUES ($1, $2, $3, $4, $5)`,
      [approvalId, approval.request_id, approver_id, status, comments || null]
    );

    // 8. Activate Next Approval Step (only when approved)
    if (status === 'Approved') {
      if (
        request.request_type === 'Maintenance' &&
        request.initiated_by_technician_id &&
        approval.approval_level === 0
      ) {
        const { rows: higherLevels } = await client.query(
          `SELECT 1
             FROM approvals
            WHERE request_id = $1 AND approval_level > 0
            LIMIT 1`,
          [approval.request_id],
        );

        if (higherLevels.length === 0) {
          await client.query(
            `UPDATE requests
                SET requester_id = $1,
                    updated_at = NOW()
              WHERE id = $2`,
            [approver_id, approval.request_id],
          );
          request.requester_id = approver_id;

          await client.query(
            `INSERT INTO request_logs (request_id, action, actor_id, comments)
             VALUES ($1, $2, $3, $4)`,
            [
              approval.request_id,
              'Requester confirmation recorded',
              approver_id,
              'Maintenance request ownership transferred to department requester',
            ],
          );

          const { rows: newRequesterEmailRows } = await client.query(
            `SELECT email FROM users WHERE id = $1`,
            [approver_id],
          );
          if (newRequesterEmailRows[0]?.email) {
            request.requester_email = newRequesterEmailRows[0].email;
          }

          let departmentType = request.request_domain;
          if (!departmentType) {
            const deptTypeRes = await client.query(
              `SELECT type FROM departments WHERE id = $1`,
              [request.department_id],
            );
            departmentType = deptTypeRes.rows[0]?.type || null;
          }
          departmentType = departmentType ? departmentType.toLowerCase() : null;

          if (!departmentType) {
            const existing = await client.query(
              `SELECT 1 FROM approvals WHERE request_id = $1 AND approval_level = $2 LIMIT 1`,
              [approval.request_id, approval.approval_level + 1],
            );
            if (existing.rowCount === 0) {
              await assignApprover(
                client,
                'SCM',
                request.department_id,
                approval.request_id,
                request.request_type,
                approval.approval_level + 1,
                request.request_domain,
              );
            }
          } else {
            const routes = await fetchApprovalRoutes(
              client,
              request.request_type,
              departmentType,
              request.estimated_cost || 0,
            );

            if (!routes.length) {
              const existing = await client.query(
                `SELECT 1 FROM approvals WHERE request_id = $1 AND approval_level = $2 LIMIT 1`,
                [approval.request_id, approval.approval_level + 1],
              );
              if (existing.rowCount === 0) {
                await assignApprover(
                  client,
                  'SCM',
                  request.department_id,
                  approval.request_id,
                  request.request_type,
                  approval.approval_level + 1,
                  request.request_domain,
                );
              }
            } else {
              for (const { role, approval_level } of routes) {
                if (approval_level <= approval.approval_level) {
                  continue;
                }

                const existing = await client.query(
                  `SELECT 1 FROM approvals WHERE request_id = $1 AND approval_level = $2 LIMIT 1`,
                  [approval.request_id, approval_level],
                );
                if (existing.rowCount > 0) {
                  continue;
                }

                await assignApprover(
                  client,
                  role,
                  request.department_id,
                  approval.request_id,
                  request.request_type,
                  approval_level,
                  request.request_domain,
                );
              }
            }
          }
        }
      }

      const nextLevelRes = await client.query(
        `UPDATE approvals SET is_active = TRUE
         WHERE request_id = $1 AND approval_level = $2 AND is_active = FALSE
         RETURNING id, approver_id`,
        [approval.request_id, approval.approval_level + 1],
      );

      if (nextLevelRes.rowCount > 0) {
        await client.query(
          `INSERT INTO request_logs (request_id, action, actor_id, comments)
           VALUES ($1, $2, $3, NULL)`,
          [approval.request_id, `Level ${approval.approval_level + 1} activated`, approver_id],
        );

        const nextId = nextLevelRes.rows[0].id;
        const emailRes = await client.query(
          `SELECT u.email FROM approvals a JOIN users u ON a.approver_id = u.id WHERE a.id = $1`,
          [nextId],
        );
        const nextEmail = emailRes.rows[0]?.email;
        if (nextEmail) {
          await sendEmail(
            nextEmail,
            'Purchase Request Needs Your Review',
            `The ${request.request_type} request with ID ${approval.request_id} is ready for your approval.\nPlease log in to review the details.`,
          );
        }
      }
    }

    // 9. Check Final Request Status
    const statusesRes = await client.query(`SELECT status FROM approvals WHERE request_id = $1`, [approval.request_id]);
    const statuses = statusesRes.rows.map(row => row.status);

    let newStatus = null;
    if (statuses.includes('Rejected')) newStatus = 'Rejected';
    else if (statuses.every(s => s === 'Approved')) newStatus = 'Approved';

    let itemSummary = null;
    if (request.request_type !== 'Warehouse Supply') {
      const summaryRes = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE approval_status = 'Approved') AS approved,
           COUNT(*) FILTER (WHERE approval_status = 'Rejected') AS rejected,
           COUNT(*) FILTER (
             WHERE approval_status IS NULL OR approval_status = 'Pending'
           ) AS pending
         FROM public.requested_items
         WHERE request_id = $1`,
        [approval.request_id]
      );

      if (summaryRes.rowCount > 0) {
        const summaryRow = summaryRes.rows[0];
        itemSummary = {
          approved: Number(summaryRow.approved || 0),
          rejected: Number(summaryRow.rejected || 0),
          pending: Number(summaryRow.pending || 0),
        };
      }
    }

    if (newStatus) {
      await client.query(`
        UPDATE requests SET status = $1, updated_at = NOW()
        WHERE id = $2
      `, [newStatus, approval.request_id]);

      await client.query(`
        INSERT INTO request_logs (request_id, action, actor_id, comments)
        VALUES ($1, $2, $3, NULL)
      `, [approval.request_id, `Request marked ${newStatus}`, approver_id]);
    
        if (request.requester_email) {
          await sendEmail(
            request.requester_email,
            `Your purchase request ${approval.request_id} has been ${newStatus}`,
            `Your ${request.request_type} request (ID: ${approval.request_id}) has been ${newStatus.toLowerCase()}.\nLog in to view the full details.`,
          );
        }
    }

    await client.query('COMMIT');

    res.json({
      message: `✅ Approval ${status.toLowerCase()} successfully`,
      updatedRequestStatus: newStatus || 'Pending',
      itemApprovalSummary: itemSummary,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Approval decision failed:', err);
    next(err);
  } finally {
    client.release();
  }
};

// 🔘 Allow approvers to record decisions for individual items before final approval
const updateApprovalItems = async (req, res, next) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return next(createHttpError(400, 'Invalid approval ID'));
  }

  const items = Array.isArray(req.body.items) ? req.body.items : null;
  if (!items || items.length === 0) {
    return next(createHttpError(400, 'At least one item decision is required'));
  }

  await ensureRequestedItemApprovalColumns();

  const rawApproverId = req.user?.id;
  let approverId = null;
  if (typeof rawApproverId === 'number' && Number.isInteger(rawApproverId)) {
    approverId = rawApproverId;
  } else if (typeof rawApproverId === 'string' && /^\d+$/.test(rawApproverId)) {
    approverId = Number.parseInt(rawApproverId, 10);
  }
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const approvalRes = await client.query(
      `SELECT id, request_id, approver_id, status, is_active
         FROM approvals
         WHERE id = $1
         FOR UPDATE`,
      [Number(id)]
    );

    const approval = approvalRes.rows[0];
    if (!approval) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Approval not found'));
    }

    if (String(approval.approver_id) !== String(approverId)) {
      await client.query('ROLLBACK');
      return next(createHttpError(403, 'You are not authorized to update items for this approval'));
    }

    if (!approval.is_active || approval.status !== 'Pending') {
      await client.query('ROLLBACK');
      return next(createHttpError(403, 'Only active pending approvals can update item decisions'));
    }

    const requestRes = await client.query(
      `SELECT request_type FROM requests WHERE id = $1`,
      [approval.request_id]
    );

    if (requestRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Associated request not found'));
    }

    if (requestRes.rows[0].request_type === 'Warehouse Supply') {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Item-level approvals are not supported for warehouse supply requests'));
    }

    const statusMap = {
      approved: 'Approved',
      rejected: 'Rejected',
      pending: 'Pending',
    };

    const updatedItems = [];
    const summaryAdjustments = { Approved: 0, Rejected: 0, Pending: 0 };
    const seenItemIds = new Set();

    for (const itemDecision of items) {
      const rawItemId = itemDecision?.item_id ?? itemDecision?.id;
      if (!/^\d+$/.test(String(rawItemId || ''))) {
        await client.query('ROLLBACK');
        return next(createHttpError(400, 'Each item must include a valid numeric id'));
      }

      const itemId = Number(rawItemId);
      if (seenItemIds.has(itemId)) {
        continue;
      }
      seenItemIds.add(itemId);

      const normalizedStatus = String(itemDecision.status || '')
        .trim()
        .toLowerCase();
      const finalStatus = statusMap[normalizedStatus];

      if (!finalStatus) {
        await client.query('ROLLBACK');
        return next(createHttpError(400, 'Invalid item status supplied'));
      }

      const itemRes = await client.query(
        `SELECT id FROM public.requested_items WHERE id = $1 AND request_id = $2`,
        [itemId, approval.request_id]
      );

      if (itemRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(404, `Requested item ${itemId} not found for this request`));
      }

      const isFinalDecision = finalStatus === 'Approved' || finalStatus === 'Rejected';

      const updateRes = await client.query(
        `UPDATE public.requested_items
           SET approval_status = $1::public.requested_items.approval_status%TYPE,
               approval_comments = $2,
               approved_by = CASE WHEN $1 IN ('Approved','Rejected') THEN $3::uuid ELSE NULL::uuid END,
               approved_at = CASE WHEN $6 THEN NOW() ELSE NULL END
         WHERE id = $4 AND request_id = $5
         RETURNING id, item_name, approval_status, approval_comments, approved_at`,
        [
          finalStatus,
          itemDecision.comments ?? null,
          approverId,
          itemId,
          approval.request_id,
          isFinalDecision,
        ]
      );

      const updated = updateRes.rows[0];
      updatedItems.push({
        id: updated.id,
        item_name: updated.item_name,
        approval_status: updated.approval_status,
        approval_comments: updated.approval_comments,
        approved_at: updated.approved_at,
      });

      summaryAdjustments[finalStatus] += 1;
    }

    const summaryRes = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE approval_status = 'Approved') AS approved,
         COUNT(*) FILTER (WHERE approval_status = 'Rejected') AS rejected,
         COUNT(*) FILTER (
           WHERE approval_status IS NULL OR approval_status = 'Pending'
         ) AS pending
       FROM public.requested_items
       WHERE request_id = $1`,
      [approval.request_id]
    );

    const summaryRow = summaryRes.rows[0] || {};
    const summary = {
      approved: Number(summaryRow.approved || 0),
      rejected: Number(summaryRow.rejected || 0),
      pending: Number(summaryRow.pending || 0),
    };

    const commentFragments = [];
    if (summaryAdjustments.Approved > 0) {
      commentFragments.push(`${summaryAdjustments.Approved} item(s) approved`);
    }
    if (summaryAdjustments.Rejected > 0) {
      commentFragments.push(`${summaryAdjustments.Rejected} item(s) rejected`);
    }
    if (summaryAdjustments.Pending > 0) {
      commentFragments.push(`${summaryAdjustments.Pending} item(s) set to pending`);
    }

    const commentText = commentFragments.join(', ');

    if (commentText) {
      await client.query(
        `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Item approvals updated', $2::request_logs.actor_id%TYPE, $3)`,
        [approval.request_id, approverId, commentText]
      );

      await client.query(
        `INSERT INTO approval_logs (approval_id, request_id, approver_id, action, comments)
         VALUES ($1, $2, $3::approval_logs.approver_id%TYPE, 'Items Reviewed', $4)`,
        [approval.id, approval.request_id, approverId, commentText]
      );
    }

    await client.query('COMMIT');

    res.json({
      message: '✅ Item decisions recorded successfully',
      updatedItems,
      summary,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update item approvals:', err);
    next(err);
  } finally {
    client.release();
  }
};

// 🔘 View Approval Progress
const getApprovalDetailsForRequest = async (req, res, next) => {
  const { request_id } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        a.approval_level,
        a.status,
        a.comments,
        a.approved_at,
        u.name AS approver_name,
        u.role
      FROM approvals a
      JOIN users u ON a.approver_id = u.id
      WHERE a.request_id = $1
      ORDER BY a.approval_level ASC
    `, [request_id]);

    res.json(result.rows);
  } catch (err) {
    next(createHttpError(500, 'Failed to retrieve approval summary'));
  }
};

// 🔘 Approval Summary (for dashboard stats)
const getApprovalSummary = async (req, res, next) => {
  const { year, month, department_id, role } = req.query;
  const conditions = [];
  const values = [];

  if (year) {
    conditions.push(`EXTRACT(YEAR FROM r.created_at) = $${values.length + 1}`);
    values.push(year);
  }
  if (month) {
    conditions.push(`EXTRACT(MONTH FROM r.created_at) = $${values.length + 1}`);
    values.push(month);
  }
  if (department_id) {
    conditions.push(`r.department_id = $${values.length + 1}`);
    values.push(department_id);
  }
  if (role) {
    conditions.push(`u.role = $${values.length + 1}`);
    values.push(role);
  }

  let query = `
    SELECT
      COUNT(*) AS total_requests,
      COUNT(*) FILTER (WHERE r.status = 'Approved') AS approved,
      COUNT(*) FILTER (WHERE r.status = 'Rejected') AS rejected,
      COUNT(*) FILTER (WHERE r.status = 'Submitted') AS pending
    FROM requests r
    JOIN users u ON r.requester_id = u.id
  `;

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  try {
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    next(createHttpError(500, 'Failed to fetch approval summary'));
  }
};

module.exports = {
  handleApprovalDecision,
  getApprovalSummary,
  getApprovalDetailsForRequest,
  updateApprovalItems,
};