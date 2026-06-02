const pool = require('../config/db');
const { sendEmail } = require('../utils/emailService');
const { createNotifications } = require('../utils/notificationService');
const ensureRequestAutoAssignmentRulesTable = require('../utils/ensureRequestAutoAssignmentRulesTable');

const AUTO_ASSIGNMENT_REQUEST_TYPES = [
  'Maintenance',
  'Non-stock',
  'Stock',
  'IT',
  'Logbook',
  'Medical Device',
  'Medication',
];

const REQUEST_TYPE_ALIASES = new Map([
  ['maintenance', 'Maintenance'],
  ['non-stock', 'Non-stock'],
  ['nonstock', 'Non-stock'],
  ['non stock', 'Non-stock'],
  ['stock', 'Stock'],
  ['it', 'IT'],
  ['it item', 'IT'],
  ['logbook', 'Logbook'],
  ['printing logbook', 'Logbook'],
  ['medical device', 'Medical Device'],
  ['medication', 'Medication'],
]);

const normalizeRequestType = value => {
  const candidate = String(value || '').trim();
  const normalized = candidate.toLowerCase();
  return REQUEST_TYPE_ALIASES.get(normalized) || candidate;
};

const isSupportedAutoAssignmentType = requestType =>
  AUTO_ASSIGNMENT_REQUEST_TYPES.includes(normalizeRequestType(requestType));

const fetchAutoAssignmentRuleForRequest = async (client, request) => {
  if (!request?.request_type || !isSupportedAutoAssignmentType(request.request_type)) {
    return null;
  }

  await ensureRequestAutoAssignmentRulesTable(client);

  const normalizedType = normalizeRequestType(request.request_type);
  const submittedWarehouseId =
    request.supply_warehouse_id == null ? null : Number(request.supply_warehouse_id);

  const params = [normalizedType];
  let warehouseClause = 'AND r.warehouse_id IS NULL';

  if (normalizedType.toLowerCase() === 'stock') {
    params.push(Number.isInteger(submittedWarehouseId) ? submittedWarehouseId : null);
    warehouseClause = 'AND r.warehouse_id = $2';
  }

  const { rows } = await client.query(
    `SELECT r.id,
            r.request_type,
            r.warehouse_id,
            r.assignee_user_id,
            u.name AS assignee_name,
            u.email AS assignee_email
       FROM request_auto_assignment_rules r
       JOIN users u ON u.id = r.assignee_user_id
      WHERE LOWER(r.request_type) = LOWER($1)
        ${warehouseClause}
        AND r.is_active = TRUE
        AND u.is_active = TRUE
      LIMIT 1`,
    params,
  );

  return rows[0] || null;
};

const applyAutoAssignmentForApprovedRequest = async (client, request, actorId = null) => {
  const rule = await fetchAutoAssignmentRuleForRequest(client, request);
  if (!rule) {
    return null;
  }

  const requestId = Number(request.id);
  const assigneeId = Number(rule.assignee_user_id);

  if (!Number.isInteger(requestId) || !Number.isInteger(assigneeId)) {
    return null;
  }

  if (request.assigned_to != null && Number(request.assigned_to) === assigneeId) {
    return { ...rule, skipped: true, reason: 'already_assigned' };
  }

  const { rows } = await client.query(
    `UPDATE requests
        SET assigned_to = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING id, request_type, assigned_to`,
    [assigneeId, requestId],
  );

  if (rows.length === 0) {
    return null;
  }

  await client.query(
    `INSERT INTO request_logs (request_id, action, actor_id, comments)
     VALUES ($1, 'Auto-assigned to procurement', $2, $3)`,
    [
      requestId,
      actorId,
      `Automatically assigned to ${rule.assignee_name || assigneeId} using management auto-assignment rule ${rule.id}`,
    ],
  );

  const requestType = rows[0].request_type || request.request_type || 'purchase';
  const message = `You have been automatically assigned to the ${requestType} request with ID ${requestId}.`;

  if (rule.assignee_email) {
    try {
      await sendEmail(
        rule.assignee_email,
        'New procurement assignment',
        `Hello ${rule.assignee_name || 'Procurement team member'},\n\n${message}\nPlease log in to the procurement portal to review and take action.`,
      );
    } catch (err) {
      console.error('⚠️ Failed to send auto-assignment email:', err);
    }
  }

  try {
    await createNotifications([
      {
        userId: assigneeId,
        title: 'New procurement assignment',
        message,
        link: `/requests/${requestId}`,
        metadata: {
          requestId,
          requestType,
          action: 'procurement_auto_assignment',
          ruleId: rule.id,
        },
      },
    ], client);
  } catch (err) {
    console.error('⚠️ Failed to record auto-assignment notification:', err);
  }

  return { ...rule, assigned_request: rows[0] };
};

module.exports = {
  AUTO_ASSIGNMENT_REQUEST_TYPES,
  normalizeRequestType,
  isSupportedAutoAssignmentType,
  fetchAutoAssignmentRuleForRequest,
  applyAutoAssignmentForApprovedRequest,
};