const { hasPermission, sameScope } = require('./requestPolicy');

async function assertCanDecide({ actor, request, approval, allowSelfApproval = false }) {
  if (!actor?.id || actor.is_active === false) throw Object.assign(new Error('An active authenticated approver is required'), { code: 'INACTIVE_ACTOR', statusCode: 403 });
  if (Number(approval.approver_id) !== Number(actor.id) && !hasPermission(actor, 'approvals.override')) throw Object.assign(new Error('Actor is not the assigned approver'), { code: 'INVALID_APPROVER', statusCode: 403 });
  if (!sameScope(actor, request, 'institute_id') && !hasPermission(actor, 'approvals.cross-institute')) throw Object.assign(new Error('Approval is outside institute scope'), { code: 'INSTITUTE_SCOPE_DENIED', statusCode: 403 });
  for (const field of ['department_id', 'section_id', 'warehouse_id']) {
    if (!sameScope(actor, request, field) && !hasPermission(actor, `approvals.cross-${field.replace('_id', '')}`)) throw Object.assign(new Error(`Approval is outside ${field.replace('_id', '')} scope`), { code: 'DATA_SCOPE_DENIED', statusCode: 403 });
  }
  if (!allowSelfApproval && Number(request.requester_id) === Number(actor.id) && !hasPermission(actor, 'approvals.self-approve')) throw Object.assign(new Error('Self-approval is prohibited'), { code: 'SELF_APPROVAL_DENIED', statusCode: 403 });
  return true;
}

module.exports = { assertCanDecide };