// src/controllers/approvalsController.js
const pool = require('../config/db');
const { sendEmail } = require('../utils/emailService');
const { createNotifications } = require('../utils/notificationService');
const createHttpError = require('../utils/httpError');
const ensureRequestedItemApprovalColumns = require('../utils/ensureRequestedItemApprovalColumns');
const getColumnType = require('../utils/getColumnType');
const { assignApprover } = require('./requests/createRequestController');
const { fetchApprovalRoutes, resolveRouteDomain } = require('./utils/approvalRoutes');

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
  const { status, comments, is_urgent, estimated_cost: estimatedCostInput } = req.body;
  // authMiddleware exposes the logged in user's id as `id`
  const approver_id = req.user.id;
  const user_role = req.user.role;

  if (!['Approved', 'Rejected'].includes(status)) {
    return next(createHttpError(400, 'Invalid status value'));
  }

  const sanitizedEstimatedCost =
    estimatedCostInput !== undefined &&
    estimatedCostInput !== null &&
    String(estimatedCostInput).trim() !== ''
      ? Number(String(estimatedCostInput).replace(/,/g, ''))
      : null;

  if (sanitizedEstimatedCost !== null) {
    if (Number.isNaN(sanitizedEstimatedCost) || sanitizedEstimatedCost <= 0) {
      return next(createHttpError(400, 'estimated_cost must be a positive number'));
    }

    if (!req.user?.hasPermission || !req.user.hasPermission('procurement.update-cost')) {
      return next(
        createHttpError(403, 'You do not have permission to update estimated cost during approval'),
      );
    }
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

    const routeDomain = await resolveRouteDomain({
      client,
      departmentId: request.department_id,
      explicitDomain: request.request_domain,
      requestType: request.request_type,
    });

    let effectiveEstimatedCost = Number(request.estimated_cost) || 0;

    if (sanitizedEstimatedCost !== null) {
      effectiveEstimatedCost = sanitizedEstimatedCost;

      await client.query(
        `UPDATE requests
            SET estimated_cost = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [sanitizedEstimatedCost, approval.request_id],
      );

      await client.query(
        `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Estimated Cost Updated', $2, $3)`,
        [
          approval.request_id,
          approver_id,
          `SCM set estimated cost to ${sanitizedEstimatedCost}`,
        ],
      );

      request.estimated_cost = sanitizedEstimatedCost;
    }

    const routeDefinitions = await fetchApprovalRoutes({
      client,
      requestType: request.request_type,
      departmentType: routeDomain,
      amount: effectiveEstimatedCost,
    });

    const notificationsToCreate = [];
    const notificationKeySet = new Set();
    const enqueueNotification = ({ userId, title, message, link, metadata }) => {
      if (userId == null) {
        return;
      }
      const parsedId = Number(userId);
      if (!Number.isInteger(parsedId)) {
        return;
      }

      const trimmedMessage = typeof message === 'string' ? message.trim() : '';
      if (!trimmedMessage) {
        return;
      }

      const trimmedTitle = typeof title === 'string' ? title.trim() : null;
      const normalizedLink = typeof link === 'string' ? link.trim() : null;
      const key = `${parsedId}|${trimmedTitle || ''}|${trimmedMessage}|${normalizedLink || ''}`;

      if (notificationKeySet.has(key)) {
        return;
      }

      notificationKeySet.add(key);
      notificationsToCreate.push({
        userId: parsedId,
        title: trimmedTitle,
        message: trimmedMessage,
        link: normalizedLink,
        metadata,
      });
    };

    let technicianEmail = null;
    if (
      request.request_type === 'Maintenance' &&
      request.initiated_by_technician_id &&
      request.initiated_by_technician_id !== request.requester_id
    ) {
      const techRes = await client.query(
        `SELECT email FROM users WHERE id = $1`,
        [request.initiated_by_technician_id],
      );
      technicianEmail = techRes.rows[0]?.email || null;
    }

    // 3. HOD Role Validation
    if (user_role === 'HOD' && req.user.department_id !== request.department_id) {
      return rollbackWithError(client, res, next, 403, 'Only the HOD of the same department can approve this request');
    }

    // 4. Validate Role Against Approval Route
    const routeForLevel = routeDefinitions.find(
      route => route.approval_level === approval.approval_level,
    );
    const expectedRole = routeForLevel?.role || null;
    if (
      expectedRole &&
      expectedRole.trim().toUpperCase() !== (user_role || '').toUpperCase()
    ) {
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
    const shouldMarkUrgent = (() => {
      if (is_urgent === undefined || is_urgent === null) return false;
      if (typeof is_urgent === 'boolean') return is_urgent;
      if (typeof is_urgent === 'number') return is_urgent !== 0;
      if (typeof is_urgent === 'string') {
        const normalized = is_urgent.trim().toLowerCase();
        if (normalized === '') return false;
        return ['true', '1', 'yes', 'y', 'on', 'urgent'].includes(normalized);
      }
      return false;
    })();

    await client.query(
      `UPDATE approvals
      SET status = $1,
          comments = $2,
          approved_at = NOW(),
          is_active = FALSE,
          is_urgent = CASE WHEN $4 THEN TRUE ELSE is_urgent END
          WHERE id = $3`,
      [status, comments || null, approvalId, shouldMarkUrgent]
    );

    const wasAlreadyUrgent = request.is_urgent === true;

    if (shouldMarkUrgent && !wasAlreadyUrgent) {
      await client.query(
        `UPDATE requests
            SET is_urgent = TRUE,
                updated_at = NOW()
          WHERE id = $1`,
        [approval.request_id]
      );

      await client.query(
        `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Marked as Urgent', $2, 'Request flagged as urgent by approver')`,
        [approval.request_id, approver_id]
      );

      request.is_urgent = true;
    }

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
      const sameLevelPendingRes = await client.query(
        `SELECT COUNT(*) AS pending_count
           FROM approvals
          WHERE request_id = $1
            AND approval_level = $2
            AND status = 'Pending'`,
        [approval.request_id, approval.approval_level],
      );

      const pendingAtCurrentLevel = Number(
        sameLevelPendingRes.rows?.[0]?.pending_count || 0,
      );

      if (pendingAtCurrentLevel === 0) {
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

            if (!routeDefinitions.length) {
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
                  routeDomain,
                );
              }
            } else {
              for (const { role, approval_level } of routeDefinitions) {
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
                  routeDomain,
                );
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
          const nextApproverId = nextLevelRes.rows[0].approver_id || null;
          const emailRes = await client.query(
            `SELECT u.email FROM approvals a JOIN users u ON a.approver_id = u.id WHERE a.id = $1`,
            [nextId],
          );
          const nextEmail = emailRes.rows[0]?.email;
          const nextMessage = `The ${request.request_type} request with ID ${approval.request_id} is ready for your approval.`;

          if (nextApproverId) {
            enqueueNotification({
              userId: nextApproverId,
              title: 'Purchase Request Needs Your Review',
              message: nextMessage,
              link: `/requests/${approval.request_id}`,
              metadata: {
                requestId: approval.request_id,
                requestType: request.request_type,
                action: 'approval_required',
                level: approval.approval_level + 1,
              },
            });
          }

          if (nextEmail) {
            await sendEmail(
              nextEmail,
              'Purchase Request Needs Your Review',
              `${nextMessage}\nPlease log in to review the details.`,
            );
          }
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

      const statusLower = newStatus.toLowerCase();
      const requesterMessage = `Your ${request.request_type} request (ID: ${approval.request_id}) has been ${statusLower}.`;

      enqueueNotification({
        userId: request.requester_id,
        title: `Request ${approval.request_id} ${statusLower}`,
        message: requesterMessage,
        link: `/requests/${approval.request_id}`,
        metadata: {
          requestId: approval.request_id,
          requestType: request.request_type,
          action: newStatus === 'Approved' ? 'request_approved' : 'request_rejected',
        },
      });

      if (request.requester_email) {
        await sendEmail(
          request.requester_email,
          `Your purchase request ${approval.request_id} has been ${newStatus}`,
          `${requesterMessage}\nLog in to view the full details.`,
        );
      }

      if (newStatus === 'Approved') {
        if (
          request.request_type === 'Maintenance' &&
          request.initiated_by_technician_id &&
          technicianEmail
        ) {
          enqueueNotification({
            userId: request.initiated_by_technician_id,
            title: `Maintenance request ${approval.request_id} approved`,
            message: `The maintenance request you initiated (ID: ${approval.request_id}) has been approved.`,
            link: `/requests/${approval.request_id}`,
            metadata: {
              requestId: approval.request_id,
              requestType: request.request_type,
              action: 'maintenance_approved',
            },
          });

          await sendEmail(
            technicianEmail,
            `Maintenance request ${approval.request_id} approved`,
            `The maintenance request you initiated (ID: ${approval.request_id}) has received final approval.\nYou can follow up with the requesting department for fulfillment.`,
          );
        }

        const { rows: scmRows } = await client.query(
          `SELECT id, email
             FROM users
            WHERE role = 'SCM'
              AND is_active = true
              AND ($1::INT IS NULL OR department_id = $1)`,
          [request.department_id || null],
        );

        const scmEmails = scmRows.map(row => row.email).filter(Boolean);
        if (scmEmails.length > 0) {
          await sendEmail(
            scmEmails,
            `Request ${approval.request_id} fully approved`,
            `All approvals for ${request.request_type} request ${approval.request_id} are complete.\nYou can proceed with procurement activities.`,
          );
        }

        scmRows
          .filter(row => Number.isInteger(row.id))
          .forEach(row => {
            enqueueNotification({
              userId: row.id,
              title: `Request ${approval.request_id} fully approved`,
              message: `All approvals for ${request.request_type} request ${approval.request_id} are complete and ready for assignment.`,
              link: `/requests/${approval.request_id}`,
              metadata: {
                requestId: approval.request_id,
                requestType: request.request_type,
                action: 'request_ready_for_assignment',
              },
            });
          });
      }
    }

    if (notificationsToCreate.length > 0) {
      await createNotifications(notificationsToCreate, client);
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
  const approverId = rawApproverId ?? null;
  const approverIdAsString = rawApproverId != null ? String(rawApproverId) : null;

  let approverIdAsInteger = null;
  if (typeof rawApproverId === 'number' && Number.isInteger(rawApproverId)) {
    approverIdAsInteger = rawApproverId;
  } else if (typeof rawApproverId === 'string' && /^\d+$/.test(rawApproverId)) {
    approverIdAsInteger = Number.parseInt(rawApproverId, 10);
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

    const approvalApproverId =
      approval.approver_id != null ? String(approval.approver_id) : null;

    if ((approvalApproverId ?? '') !== (approverIdAsString ?? '')) {
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
    const quantityChanges = [];
    const summaryAdjustments = { Approved: 0, Rejected: 0, Pending: 0 };
    const lockedItems = [];
    const seenItemIds = new Set();

    const approvedByColumnTypeRaw = await getColumnType(
      'public',
      'requested_items',
      'approved_by',
      client,
    );

    const approvedByColumnType = approvedByColumnTypeRaw
      ? approvedByColumnTypeRaw.toLowerCase()
      : null;

    const approvedByPrefersString =
      approvedByColumnType &&
      ['uuid', 'text', 'varchar', 'character varying'].includes(approvedByColumnType);

    const approvedByPrefersInteger =
      approvedByColumnType &&
      ['integer', 'int4', 'bigint', 'int8', 'smallint', 'int2'].includes(approvedByColumnType);

    const approvedByCastFragment = (() => {
      switch (approvedByColumnType) {
        case 'uuid':
          return '::uuid';
        case 'integer':
        case 'int4':
          return '::int4';
        case 'bigint':
        case 'int8':
          return '::int8';
        case 'smallint':
        case 'int2':
          return '::int2';
        default:
          return '';
      }
    })();

    const resolvedApproverValue = approvedByPrefersString
      ? approverIdAsString ?? null
      : approvedByPrefersInteger
      ? approverIdAsInteger ?? null
      : approverIdAsInteger ?? approverIdAsString ?? null;

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
        `SELECT id, item_name, quantity, unit_cost, total_cost, approval_status, approved_by
           FROM public.requested_items
          WHERE id = $1 AND request_id = $2`,
        [itemId, approval.request_id]
      );

      if (itemRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(404, `Requested item ${itemId} not found for this request`));
      }

      const existingItem = itemRes.rows[0];
      const existingApprovedBy = existingItem.approved_by;
      const existingApprovedByNormalized =
        existingApprovedBy != null ? String(existingApprovedBy) : null;
      const resolvedApproverValueNormalized =
        resolvedApproverValue != null ? String(resolvedApproverValue) : null;

      const isLockedRejected =
        existingItem.approval_status === 'Rejected' &&
        existingApprovedByNormalized != null &&
        existingApprovedByNormalized !== (resolvedApproverValueNormalized ?? '');

      if (isLockedRejected) {
        lockedItems.push({
          id: existingItem.id,
          approval_status: existingItem.approval_status,
        });
        continue;
      }

      const rawQuantity = itemDecision.quantity;
      let parsedQuantity = null;
      let quantityChanged = false;
      const previousQuantity = Number(existingItem.quantity);
      const existingStatus = existingItem.approval_status || 'Pending';

      if (rawQuantity !== undefined && rawQuantity !== null && rawQuantity !== '') {
        const numericQuantity = Number(rawQuantity);
        if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
          await client.query('ROLLBACK');
          return next(createHttpError(400, 'Quantity must be a positive number'));
        }

        if (!Number.isInteger(numericQuantity)) {
          await client.query('ROLLBACK');
          return next(createHttpError(400, 'Quantity must be a whole number'));
        }

        parsedQuantity = numericQuantity;
        quantityChanged = parsedQuantity !== Number(existingItem.quantity);
      }

      const isFinalDecision = finalStatus === 'Approved' || finalStatus === 'Rejected';
      const statusChanged = finalStatus !== existingStatus;

      if (quantityChanged) {
        const quantityUpdateRes = await client.query(
          `UPDATE public.requested_items
             SET quantity = $1,
                 total_cost = CASE WHEN unit_cost IS NOT NULL THEN unit_cost * $1 ELSE NULL END,
                 updated_at = NOW()
           WHERE id = $2 AND request_id = $3
           RETURNING quantity, unit_cost, total_cost`,
          [parsedQuantity, itemId, approval.request_id],
        );

        const updatedRow = quantityUpdateRes.rows[0];
        existingItem.quantity = updatedRow?.quantity ?? parsedQuantity;
        existingItem.unit_cost = updatedRow?.unit_cost ?? existingItem.unit_cost;
        existingItem.total_cost = updatedRow?.total_cost ?? existingItem.total_cost;

        quantityChanges.push({
          id: existingItem.id,
          item_name: existingItem.item_name,
          previous_quantity: previousQuantity,
          updated_quantity: parsedQuantity,
        });
      }

      const updateRes = await client.query(
        `UPDATE public.requested_items
           SET approval_status = $1,
               approval_comments = $2,
               approved_by = CASE WHEN $6 THEN $3${approvedByCastFragment} ELSE NULL END,
               approved_at = CASE WHEN $6 THEN NOW() ELSE NULL END
         WHERE id = $4 AND request_id = $5
         RETURNING id, item_name, approval_status, approval_comments, approved_at, approved_by, quantity, total_cost, unit_cost`,
        [
          finalStatus,
          itemDecision.comments ?? null,
          resolvedApproverValue,
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
        approved_by: updated.approved_by,
        quantity: updated.quantity,
        total_cost: updated.total_cost,
        unit_cost: updated.unit_cost,
      });

      if (statusChanged) {
        summaryAdjustments[finalStatus] += 1;
      }
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

    if (quantityChanges.length > 0) {
      commentFragments.push(
        `${quantityChanges.length} item(s) quantity adjusted`,
      );
    }

    const commentText = commentFragments.join(', ');

    if (commentText) {
      await client.query(
        `INSERT INTO public.request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Item approvals updated', $2, $3)`,
        [approval.request_id, approverId, commentText]
      );

      await client.query(
        `INSERT INTO public.approval_logs (approval_id, request_id, approver_id, action, comments)
         VALUES ($1, $2, $3, 'Items Reviewed', $4)`,
        [approval.id, approval.request_id, approverId, commentText]
      );
    }

    const estimatedCostRes = await client.query(
      `SELECT COALESCE(SUM(quantity * unit_cost), 0) AS total
         FROM public.requested_items
        WHERE request_id = $1`,
      [approval.request_id],
    );

    const updatedEstimatedCost = Number(estimatedCostRes.rows[0]?.total || 0);

    await client.query(
      `UPDATE requests
          SET estimated_cost = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [updatedEstimatedCost, approval.request_id],
    );

    await client.query('COMMIT');

    res.json({
      message: '✅ Item decisions recorded successfully',
      updatedItems,
      summary,
      lockedItems,
      updatedEstimatedCost,
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

  if (!/^\d+$/.test(String(request_id))) {
    return next(createHttpError(400, 'Invalid request id'));
  }

  try {
    const result = await pool.query(
      `
      SELECT
        a.approval_level,
        a.status,
        a.comments,
        a.approved_at,
        COALESCE(
          u.name,
          CASE
            WHEN a.approver_id IS NULL AND a.status = 'Approved' THEN 'Auto-approved'
            ELSE NULL
          END
        ) AS approver_name,
        COALESCE(
          u.role,
          CASE
            WHEN a.approver_id IS NULL AND a.status = 'Approved' THEN 'System'
            ELSE NULL
          END
        ) AS role
      FROM approvals a
      LEFT JOIN users u ON a.approver_id = u.id
      WHERE a.request_id = $1
      ORDER BY a.approval_level ASC
    `,
      [request_id],
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to retrieve approval summary:', err);
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