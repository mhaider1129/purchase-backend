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
  if (!request?.request_type || !isSupportedAutoAssignmentType(request.request_type)) return null;
  const { id } = require('./procurementAssignmentPolicy');
  const instituteId = id(request.institute_id);
  await ensureRequestAutoAssignmentRulesTable(client);
  const type = normalizeRequestType(request.request_type);
  const warehouseId = type === 'Stock' ? request.supply_warehouse_id : null;
  if (type === 'Stock' && warehouseId == null) return null;
  const rows = (await client.query(`SELECT r.*,u.name AS assignee_name,u.email AS assignee_email
    FROM request_auto_assignment_rules r JOIN users u ON u.id=r.assignee_user_id
    WHERE r.institute_id=$1 AND LOWER(r.request_type)=LOWER($2)
      AND COALESCE(r.warehouse_id,0)=COALESCE($3::integer,0) AND r.is_active=true
      AND u.institute_id=r.institute_id AND u.is_active=true
    ORDER BY r.id LIMIT 2 FOR SHARE OF r,u`, [instituteId,type,warehouseId])).rows;
  if (rows.length > 1) throw Object.assign(new Error('Ambiguous assignment rules require reconciliation'), {statusCode:409});
  return rows[0] || null;
};
const applyAutoAssignmentForApprovedRequest = (client, request, actorId = null) =>
  require('./procurementAssignmentService').assign({ requestId:request?.id, actor:{id:actorId}, method:'automatic' }, client);

module.exports = { AUTO_ASSIGNMENT_REQUEST_TYPES, normalizeRequestType, isSupportedAutoAssignmentType,
  fetchAutoAssignmentRuleForRequest, applyAutoAssignmentForApprovedRequest };
