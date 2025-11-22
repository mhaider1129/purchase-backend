const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const { sendEmail } = require('../../utils/emailService');
const { createNotifications } = require('../../utils/notificationService');
const { assignApprover } = require('./createRequestController');
const { fetchApprovalRoutes, resolveRouteDomain } = require('../utils/approvalRoutes');

const assignRequestToProcurement = async (req, res, next) => {
  const { request_id, user_id } = req.body;
  if (!req.user.hasPermission('requests.manage')) {
    return next(createHttpError(403, 'You do not have permission to assign requests'));
  }

  try {
    const userCheck = await pool.query(
      `SELECT id, email, name
         FROM users
        WHERE id = $1
          AND role = 'ProcurementSpecialist'
          AND is_active = true`,
      [user_id],
    );
    if (userCheck.rowCount === 0) {
      return next(createHttpError(400, 'Invalid procurement staff'));
    }

    const requestRes = await pool.query(
      `SELECT id, request_type
         FROM requests
        WHERE id = $1`,
      [request_id],
    );

    if (requestRes.rowCount === 0) {
      return next(createHttpError(404, 'Request not found'));
    }

    await pool.query(
      `UPDATE requests SET assigned_to = $1 WHERE id = $2`,
      [user_id, request_id],
    );

    const assigneeEmail = userCheck.rows[0]?.email || null;
    const assigneeName = userCheck.rows[0]?.name || 'Procurement Specialist';
    const requestType = requestRes.rows[0]?.request_type || 'purchase';

    if (assigneeEmail) {
      await sendEmail(
        assigneeEmail,
        'New procurement assignment',
        `Hello ${assigneeName},\n\nYou have been assigned to the ${requestType} request with ID ${request_id}.\nPlease log in to the procurement portal to review and take action.`,
      );
    }

    try {
      await createNotifications([
        {
          userId: Number(user_id),
          title: 'New procurement assignment',
          message: `You have been assigned to the ${requestType} request with ID ${request_id}.`,
          link: `/requests/${request_id}`,
          metadata: {
            requestId: request_id,
            requestType,
            action: 'procurement_assignment',
          },
        },
      ]);
    } catch (notifyErr) {
      console.error('⚠️ Failed to record assignment notification:', notifyErr);
    }

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

    if (!req.user.hasPermission('procurement.update-cost')) {
      return next(createHttpError(403, 'You do not have permission to update estimated cost during approval'));
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

    const requestInfoRes = await client.query(
      `SELECT request_type, department_id, request_domain, estimated_cost, is_urgent, requester_id
         FROM requests
        WHERE id = $1
        FOR UPDATE`,
      [request_id],
    );

    if (requestInfoRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Request not found'));
    }

    const requestRow = requestInfoRes.rows[0];
    const wasAlreadyUrgent = requestRow.is_urgent === true;

    await client.query(
      `UPDATE approvals
       SET status = $1, is_active = false, approved_at = CURRENT_TIMESTAMP, comments = $2, is_urgent = COALESCE($3, is_urgent)
       WHERE id = $4`,
      [decision, comments, is_urgent, approval_id],
    );

    if (is_urgent === true && !wasAlreadyUrgent) {
      await client.query(
        `UPDATE requests
            SET is_urgent = true,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [request_id],
      );

      await client.query(
        `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Marked as Urgent', $2, 'Request flagged as urgent by approver')`,
        [request_id, approver_id],
      );

      requestRow.is_urgent = true;
    }

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, $2, $3, $4)`,
      [request_id, decision, approver_id, comments],
    );

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
      requestRow.requester_id = approver_id;
    }

    if (decision === 'Rejected') {
      await client.query(`UPDATE requests SET status = 'Rejected' WHERE id = $1`, [request_id]);
    } else {
      const routeDomain = await resolveRouteDomain({
        client,
        departmentId: department_id,
        explicitDomain: requestRow.request_domain,
        requestType: request_type,
      });

      const routeDefinitions = await fetchApprovalRoutes({
        client,
        requestType: request_type,
        departmentType: routeDomain,
        amount: effectiveEstimatedCost,
      });

      if (!routeDefinitions.length) {
        const fallbackLevel = currentApproval.approval_level + 1;
        const existing = await client.query(
          `SELECT 1 FROM approvals WHERE request_id = $1 AND approval_level = $2 LIMIT 1`,
          [request_id, fallbackLevel],
        );
        if (existing.rowCount === 0) {
          await assignApprover(
            client,
            'SCM',
            department_id,
            request_id,
            request_type,
            fallbackLevel,
            routeDomain,
          );
        }
      } else {
        let requesterRole = '';
        if (requestRow.requester_id) {
          const requesterRoleRes = await client.query(
            `SELECT role FROM users WHERE id = $1`,
            [requestRow.requester_id],
          );
          requesterRole = requesterRoleRes.rows[0]?.role?.trim().toLowerCase() || '';
        }

        for (const route of routeDefinitions) {
          if (route.approval_level <= currentApproval.approval_level) {
            continue;
          }

          const existing = await client.query(
            `SELECT 1 FROM approvals WHERE request_id = $1 AND approval_level = $2 LIMIT 1`,
            [request_id, route.approval_level],
          );
          if (existing.rowCount > 0) {
            continue;
          }

          const normalizedRouteRole = (route.role || '').trim().toLowerCase();

          if (normalizedRouteRole === 'requester' && requestRow.requester_id) {
            await client.query(
              `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status, approved_at)
               VALUES ($1, $2, $3, FALSE, 'Approved', CURRENT_TIMESTAMP)`,
              [request_id, requestRow.requester_id, route.approval_level],
            );
            continue;
          }

          if (
            normalizedRouteRole &&
            normalizedRouteRole === requesterRole &&
            requestRow.requester_id &&
            route.approval_level === 1
          ) {
            await client.query(
              `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status, approved_at)
               VALUES ($1, $2, $3, FALSE, 'Approved', CURRENT_TIMESTAMP)`,
              [request_id, requestRow.requester_id, route.approval_level],
            );
            continue;
          }

          await assignApprover(
            client,
            route.role,
            department_id,
            request_id,
            request_type,
            route.approval_level,
            routeDomain,
          );
        }
      }

      const { rows: nextPendingApprovals } = await client.query(
        `SELECT id
           FROM approvals
          WHERE request_id = $1
            AND status = 'Pending'
          ORDER BY approval_level ASC
          LIMIT 1`,
        [request_id],
      );

      let autoApprovedItems = 0;

      if (nextPendingApprovals.length > 0) {
        await client.query(
          `UPDATE approvals SET is_active = true WHERE id = $1`,
          [nextPendingApprovals[0].id],
        );
      } else {
        await client.query(`UPDATE requests SET status = 'Approved' WHERE id = $1`, [request_id]);

        const { rowCount } = await client.query(
          `UPDATE public.requested_items
              SET approval_status = 'Approved',
                  approved_at = COALESCE(approved_at, NOW()),
                  approved_by = COALESCE(approved_by, $2)
            WHERE request_id = $1
              AND (approval_status IS NULL OR approval_status = 'Pending')`,
          [request_id, approver_id],
        );

        autoApprovedItems = rowCount;

        if (autoApprovedItems > 0) {
          await client.query(
            `INSERT INTO request_logs (request_id, action, actor_id, comments)
             VALUES ($1, 'Items Auto-Approved', $2, $3)`,
            [
              request_id,
              approver_id,
              `${autoApprovedItems} pending item(s) auto-approved upon final request approval`,
            ],
          );

          await client.query(
            `INSERT INTO approval_logs (approval_id, request_id, approver_id, action, comments)
             VALUES ($1, $2, $3, 'Items Auto-Approved', $4)`,
            [
              approval_id,
              request_id,
              approver_id,
              `${autoApprovedItems} pending item(s) auto-approved upon final request approval`,
            ],
          );
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
  const { id: user_id } = req.user;

  if (!req.user.hasPermission('requests.manage')) {
    return next(createHttpError(403, 'You do not have permission to mark requests as completed'));
  }

  const client = await pool.connect();
  let transactionActive = false;
  try {
    await client.query('BEGIN');
    transactionActive = true;

    const itemStatusRes = await client.query(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN procurement_status IS NULL
               OR TRIM(procurement_status) = ''
               OR purchased_quantity IS NULL
             THEN 1
             ELSE 0
           END
         ), 0) AS missing_required,
         COALESCE(SUM(
           CASE
             WHEN procurement_status IS NULL
               OR TRIM(procurement_status) = ''
             THEN 0
             WHEN LOWER(TRIM(procurement_status)) NOT IN ('purchased', 'completed')
             THEN 1
             ELSE 0
           END
         ), 0) AS invalid_status
       FROM public.requested_items
       WHERE request_id = $1`,
      [id],
    );

    const {
      missing_required: missingRequiredRaw = 0,
      invalid_status: invalidStatusRaw = 0,
    } = itemStatusRes.rows[0] || {};

    const missingRequired = Number(missingRequiredRaw) || 0;
    if (missingRequired > 0) {
      await client.query('ROLLBACK');
      transactionActive = false;
      return next(
        createHttpError(
          400,
          'Not all items have a procurement status and purchased quantity.'
        )
      );
    }

    const invalidStatus = Number(invalidStatusRaw) || 0;
    if (invalidStatus > 0) {
      await client.query('ROLLBACK');
      transactionActive = false;
      return next(
        createHttpError(
          400,
          'All items must be purchased or completed before marking the request as completed.'
        )
      );
    }

    const requestRes = await client.query(
      `SELECT
         request_type,
         department_id,
         requester_id,
         initiated_by_technician_id
       FROM requests
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    if (requestRes.rowCount === 0) {
      await client.query('ROLLBACK');
      transactionActive = false;
      return next(createHttpError(404, 'Request not found'));
    }

    const requestRow = requestRes.rows[0];

    let requesterEmail = null;
    let technicianEmail = null;
    const notificationEntries = [];

    const relatedUserIds = [
      requestRow.requester_id,
      requestRow.initiated_by_technician_id,
    ].filter((value) => value !== null && value !== undefined);

    if (relatedUserIds.length > 0) {
      const userEmailRes = await client.query(
        `SELECT id, email
           FROM users
          WHERE id = ANY($1::int[])`,
        [relatedUserIds],
      );

      for (const { id: relatedId, email } of userEmailRes.rows) {
        if (email) {
          if (relatedId === requestRow.requester_id) {
            requesterEmail = email;
          }
          if (relatedId === requestRow.initiated_by_technician_id) {
            technicianEmail = email;
          }
        }
      }
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

    notificationEntries.push({
      userId: requestRow.requester_id,
      title: `Request ${id} completed`,
      message: `Your ${requestRow.request_type || 'purchase'} request (ID: ${id}) has been marked as completed by procurement.`,
      link: `/requests/${id}`,
      metadata: {
        requestId: id,
        requestType: requestRow.request_type,
        action: 'request_completed',
      },
    });

    if (
      requestRow.request_type === 'Maintenance' &&
      requestRow.initiated_by_technician_id &&
      requestRow.initiated_by_technician_id !== requestRow.requester_id
    ) {
      notificationEntries.push({
        userId: requestRow.initiated_by_technician_id,
        title: `Maintenance request ${id} completed`,
        message: `The maintenance request you initiated (ID: ${id}) has been marked as completed.`,
        link: `/requests/${id}`,
        metadata: {
          requestId: id,
          requestType: requestRow.request_type,
          action: 'maintenance_completed',
        },
      });
    }

    if (notificationEntries.length > 0) {
      await createNotifications(notificationEntries, client);
    }

    await client.query('COMMIT');
    transactionActive = false;

    const emailPromises = [];
    if (requesterEmail) {
      emailPromises.push(
        sendEmail(
          requesterEmail,
          `Request ${id} completed`,
          `Your ${requestRow.request_type || 'purchase'} request (ID: ${id}) has been marked as completed by procurement.\nYou can review the final details in the procurement portal.`,
        ),
      );
    }

    if (
      requestRow.request_type === 'Maintenance' &&
      technicianEmail &&
      technicianEmail !== requesterEmail
    ) {
      emailPromises.push(
        sendEmail(
          technicianEmail,
          `Maintenance request ${id} completed`,
          `The maintenance request you initiated (ID: ${id}) has been marked as completed.\nPlease review the outcome with the requesting department.`,
        ),
      );
    }

    try {
      await Promise.all(emailPromises);
    } catch (notificationErr) {
      console.error('⚠️ Failed to send one or more completion notifications:', notificationErr);
    }

    res.json({ message: '✅ Request marked as completed' });
  } catch (err) {
    if (transactionActive) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('⚠️ Failed to rollback transaction:', rollbackErr);
      }
    }
    console.error('❌ Failed to mark request as completed:', err);
    if (!err.code && !err.statusCode) {
      return next(createHttpError(500, 'Failed to complete the request'));
    }
    return next(err);
  } finally {
    client.release();
  }
};

const updateRequestCost = async (req, res, next) => {
  const { id } = req.params;
  const { estimated_cost } = req.body;
  const { id: user_id } = req.user;

  if (!req.user.hasPermission('procurement.update-cost')) {
    return next(createHttpError(403, 'You do not have permission to update request costs'));
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

const markRequestAsReceived = async (req, res, next) => {
  const { id } = req.params;
  const { id: user_id } = req.user;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestRes = await client.query(
      'SELECT requester_id, status FROM requests WHERE id = $1',
      [id]
    );
    if (requestRes.rowCount === 0) {
      return next(createHttpError(404, 'Request not found'));
    }
    const { requester_id, status } = requestRes.rows[0];
    if (status !== 'completed') {
      return next(
        createHttpError(400, 'Request must be completed to be marked as received')
      );
    }
    if (requester_id !== user_id) {
      return next(
        createHttpError(403, 'Unauthorized to mark request as received')
      );
    }
    await client.query(
      "UPDATE requests SET status = 'Received', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [id]
    );
    await client.query(
      "INSERT INTO request_logs (request_id, action, actor_id, comments) VALUES ($1, 'Marked as Received', $2, 'Items marked as received by requester')",
      [id, user_id]
    );
    await client.query('COMMIT');
    res.json({ message: '✅ Request marked as received' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(createHttpError(500, 'Failed to mark request as received'));
  } finally {
    client.release();
  }
};
module.exports = {
  assignRequestToProcurement,
  updateApprovalStatus,
  markRequestAsCompleted,
  markRequestAsReceived,
  updateRequestCost,
  approveMaintenanceRequest,
  reassignMaintenanceRequestToRequester,
};