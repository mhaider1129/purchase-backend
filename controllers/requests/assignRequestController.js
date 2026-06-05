// controllers/requests/assignRequestController.js
const pool = require('../../config/db');
const { sendEmail } = require('../../utils/emailService');
const { createNotifications } = require('../../utils/notificationService');
const { successResponse, errorResponse } = require('../../utils/responseFormatter');

let assignmentColumnsEnsurePromise = null;

const runRequestedItemAssignmentEnsure = async (clientOrPool) => {
  await clientOrPool.query(`
    ALTER TABLE public.requested_items
      ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES public.users(id),
      ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES public.users(id),
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS assignment_notes TEXT
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_requested_items_assigned_to
      ON public.requested_items(assigned_to)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_requested_items_request_assignee
      ON public.requested_items(request_id, assigned_to)
  `);
};

const ensureRequestedItemAssignmentColumns = async (clientOrPool = pool) => {
  if (clientOrPool !== pool) {
    await runRequestedItemAssignmentEnsure(clientOrPool);
    return;
  }

  if (!assignmentColumnsEnsurePromise) {
    assignmentColumnsEnsurePromise = runRequestedItemAssignmentEnsure(pool).catch((err) => {
      assignmentColumnsEnsurePromise = null;
      throw err;
    });
  }

  await assignmentColumnsEnsurePromise;
};

const getActiveProcurementUsers = async (userIds, clientOrPool = pool) => {
  const normalizedIds = [...new Set(userIds.map((id) => Number(id)).filter(Number.isInteger))];
  if (!normalizedIds.length) return new Map();

  const result = await clientOrPool.query(
    `SELECT id, name, email, role
       FROM users
      WHERE id = ANY($1::int[])
        AND role IN ('ProcurementSpecialist', 'SCM')
        AND is_active = true`,
    [normalizedIds],
  );

  return new Map(result.rows.map((user) => [Number(user.id), user]));
};

const notifyAssignment = async ({ user, requestId, requestType, itemNames = [], split = false }) => {
  const itemLine = itemNames.length
    ? `\n\nAssigned item(s): ${itemNames.join(', ')}`
    : '';

  if (user.email) {
    try {
      await sendEmail(
        user.email,
        split ? 'New split procurement assignment' : 'New procurement assignment',
        `Hello ${user.name},\n\nYou have been assigned ${split ? 'part of' : 'to'} the ${requestType} request with ID ${requestId}.${itemLine}\nPlease log in to the procurement portal to review and take action.`,
      );
    } catch (emailErr) {
      console.error('⚠️ Failed to send procurement assignment email:', emailErr);
    }
  }

  try {
    await createNotifications([
      {
        userId: Number(user.id),
        title: split ? 'New split procurement assignment' : 'New procurement assignment',
        message: `You have been assigned ${split ? 'part of' : 'to'} the ${requestType} request with ID ${requestId}.`,
        link: `/requests/${requestId}`,
        metadata: {
          requestId,
          requestType,
          action: split ? 'split_procurement_assignment' : 'procurement_assignment',
          assignedItemNames: itemNames,
        },
      },
    ]);
  } catch (notifyErr) {
    console.error('⚠️ Failed to record procurement assignment notification:', notifyErr);
  }
};

const assignRequestToUser = async (req, res) => {
  const { request_id, user_id } = req.body;
  const assignerId = req.user.id;
  // 🔐 Only authorized users can assign
  if (!req.user.hasPermission('requests.manage')) {
    return errorResponse(res, 403, '⛔ You do not have permission to assign requests');
  }

  // ✅ Validate input
  if (!request_id || !user_id || isNaN(request_id) || isNaN(user_id)) {
    return errorResponse(res, 400, '❗ request_id and user_id must be valid numbers');
  }

  try {
    await ensureRequestedItemAssignmentColumns();
    const statusCheck = await pool.query(
      'SELECT status, assigned_to, request_type FROM requests WHERE id = $1',
      [request_id]
    );

    if (statusCheck.rowCount === 0) {
      return errorResponse(res, 404, `❌ Request with ID ${request_id} not found`);
    }

    const { status, assigned_to, request_type } = statusCheck.rows[0];

    if (['completed', 'Rejected'].includes(status)) {
      return errorResponse(res, 400, '⚠️ Cannot assign a request that is already finalized');
    }

    if (status !== 'Approved') {
      return errorResponse(res, 400, '⚠️ Request must be fully approved before assignment');
    }

    const userMap = await getActiveProcurementUsers([user_id]);
    const assignedUser = userMap.get(Number(user_id));

    if (!assignedUser) {
      return errorResponse(res, 400, '❌ Assigned user not valid or not active procurement staff/SCM');
    }

    let logAction = 'assigned_to_procurement';
    let logComment = `Assigned to ${assignedUser.name} (ID: ${user_id})`;

    if (assigned_to) {
      if (assigned_to === parseInt(user_id, 10)) {
        return errorResponse(res, 400, '⚠️ Request already assigned to this user');
      }

      const prevRes = await pool.query('SELECT name FROM users WHERE id = $1', [assigned_to]);
      const prevName = prevRes.rows[0]?.name || assigned_to;

      logAction = 'reassigned_to_procurement';
      logComment = `Reassigned from ${prevName} (ID: ${assigned_to}) to ${assignedUser.name} (ID: ${user_id})`;
    }

    const updateRes = await pool.query(
      'UPDATE requests SET assigned_to = $1 WHERE id = $2 RETURNING id, request_type, assigned_to',
      [user_id, request_id],
    );

    await pool.query(
      `UPDATE public.requested_items
          SET assigned_to = $1,
              assigned_by = $2,
              assigned_at = CURRENT_TIMESTAMP,
              assignment_notes = NULL
        WHERE request_id = $3
          AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
      [user_id, assignerId, request_id],
    );

    await pool.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, $2, $3, $4)`,
      [request_id, logAction, assignerId, logComment],
    );

    const requestType = updateRes.rows[0]?.request_type || request_type || 'purchase';

    await notifyAssignment({
      user: assignedUser,
      requestId: request_id,
      requestType,
    });

    return successResponse(res, '✅ Request assigned successfully', {
      ...updateRes.rows[0],
      assigned_user: assignedUser.name,
    });

  } catch (err) {
    console.error('❌ Error assigning request:', err);
    return errorResponse(res, 500, 'Internal server error while assigning request');
  }
};

const normalizeSplitAssignments = (assignments) => {
  if (!Array.isArray(assignments)) return [];

  return assignments.map((assignment) => {
    const userId = Number(assignment.user_id);
    const requestedItemIds = Array.isArray(assignment.requested_item_ids)
      ? assignment.requested_item_ids.map((itemId) => Number(itemId)).filter(Number.isInteger)
      : [];

    return {
      user_id: userId,
      requested_item_ids: [...new Set(requestedItemIds)],
      notes: typeof assignment.notes === 'string' ? assignment.notes.trim() : null,
    };
  }).filter((assignment) => Number.isInteger(assignment.user_id) && assignment.requested_item_ids.length > 0);
};

const splitAssignRequest = async (req, res) => {
  const requestId = Number(req.params.id || req.body.request_id);
  const assignerId = req.user.id;
  const assignments = normalizeSplitAssignments(req.body.assignments);

  if (!req.user.hasPermission('requests.manage')) {
    return errorResponse(res, 403, '⛔ You do not have permission to split assign requests');
  }

  if (!Number.isInteger(requestId) || requestId <= 0) {
    return errorResponse(res, 400, '❗ request_id must be a valid number');
  }

  if (!assignments.length) {
    return errorResponse(res, 400, '❗ Provide at least one assignment with a procurement user and item IDs');
  }

  const duplicatedItemIds = assignments
    .flatMap((assignment) => assignment.requested_item_ids)
    .filter((itemId, index, allIds) => allIds.indexOf(itemId) !== index);

  if (duplicatedItemIds.length) {
    return errorResponse(res, 400, `❗ Item ${duplicatedItemIds[0]} is assigned more than once`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureRequestedItemAssignmentColumns(client);

    const requestRes = await client.query(
      'SELECT id, status, request_type FROM requests WHERE id = $1 FOR UPDATE',
      [requestId],
    );

    if (requestRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return errorResponse(res, 404, `❌ Request with ID ${requestId} not found`);
    }

    const request = requestRes.rows[0];
    if (['completed', 'Rejected'].includes(request.status)) {
      await client.query('ROLLBACK');
      return errorResponse(res, 400, '⚠️ Cannot split assign a request that is already finalized');
    }

    if (request.status !== 'Approved') {
      await client.query('ROLLBACK');
      return errorResponse(res, 400, '⚠️ Request must be fully approved before split assignment');
    }

    const userIds = assignments.map((assignment) => assignment.user_id);
    const userMap = await getActiveProcurementUsers(userIds, client);
    const invalidUserId = userIds.find((userId) => !userMap.has(Number(userId)));
    if (invalidUserId) {
      await client.query('ROLLBACK');
      return errorResponse(res, 400, `❌ User ${invalidUserId} is not valid or active procurement staff/SCM`);
    }

    const assignedItemIds = assignments.flatMap((assignment) => assignment.requested_item_ids);
    const itemsRes = await client.query(
      `SELECT id, item_name, approval_status
         FROM public.requested_items
        WHERE request_id = $1
          AND id = ANY($2::int[])
        FOR UPDATE`,
      [requestId, assignedItemIds],
    );

    if (itemsRes.rowCount !== assignedItemIds.length) {
      const foundIds = new Set(itemsRes.rows.map((item) => Number(item.id)));
      const missingId = assignedItemIds.find((itemId) => !foundIds.has(Number(itemId)));
      await client.query('ROLLBACK');
      return errorResponse(res, 400, `❌ Item ${missingId} does not belong to request ${requestId}`);
    }

    const rejectedItem = itemsRes.rows.find((item) => item.approval_status === 'Rejected');
    if (rejectedItem) {
      await client.query('ROLLBACK');
      return errorResponse(res, 400, `⚠️ Rejected item ${rejectedItem.id} cannot be assigned to procurement`);
    }

    const itemById = new Map(itemsRes.rows.map((item) => [Number(item.id), item]));
    const assignmentSummaries = [];
    const notificationsByUser = new Map();

    for (const assignment of assignments) {
      await client.query(
        `UPDATE public.requested_items
            SET assigned_to = $1,
                assigned_by = $2,
                assigned_at = CURRENT_TIMESTAMP,
                assignment_notes = $3
          WHERE request_id = $4
            AND id = ANY($5::int[])`,
        [assignment.user_id, assignerId, assignment.notes || null, requestId, assignment.requested_item_ids],
      );

      const user = userMap.get(Number(assignment.user_id));
      const itemNames = assignment.requested_item_ids.map((itemId) => itemById.get(Number(itemId))?.item_name).filter(Boolean);
      assignmentSummaries.push(`${user.name} (ID: ${assignment.user_id}): ${itemNames.join(', ')}`);
      notificationsByUser.set(Number(user.id), {
        user,
        itemNames: [...(notificationsByUser.get(Number(user.id))?.itemNames || []), ...itemNames],
      });
    }

    const distinctUserIds = [...new Set(assignments.map((assignment) => Number(assignment.user_id)))];
    const requestAssignedTo = distinctUserIds.length === 1 ? distinctUserIds[0] : null;
    await client.query('UPDATE requests SET assigned_to = $1 WHERE id = $2', [requestAssignedTo, requestId]);

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'split_assigned_to_procurement', $2, $3)`,
      [requestId, assignerId, `Split assignment: ${assignmentSummaries.join(' | ')}`],
    );

    await client.query('COMMIT');

    for (const { user, itemNames } of notificationsByUser.values()) {
      await notifyAssignment({
        user,
        requestId,
        requestType: request.request_type || 'purchase',
        itemNames,
        split: true,
      });
    }

    return successResponse(res, '✅ Request split assignment saved successfully', {
      request_id: requestId,
      assigned_to: requestAssignedTo,
      assignments: assignments.map((assignment) => ({
        user_id: assignment.user_id,
        assigned_user: userMap.get(Number(assignment.user_id))?.name,
        requested_item_ids: assignment.requested_item_ids,
        notes: assignment.notes,
      })),
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('⚠️ Failed to rollback split assignment transaction:', rollbackErr);
    }
    console.error('❌ Error split assigning request:', err);
    return errorResponse(res, 500, 'Internal server error while split assigning request');
  } finally {
    client.release();
  }
};

module.exports = {
  assignRequestToUser,
  splitAssignRequest,
  ensureRequestedItemAssignmentColumns,
};