function hasPermission(actor, permission) { return Boolean(actor?.hasPermission?.(permission) || actor?.permissions?.includes?.(permission)); }
function sameScope(actor, request, field) { return request[field] == null || actor?.[field] == null || Number(actor[field]) === Number(request[field]); }

async function assertCanTransition({ actor, request, permission = 'requests.manage' }) {
  if (!actor?.id || actor.is_active === false) throw Object.assign(new Error('An active authenticated user is required'), { code: 'INACTIVE_ACTOR', status: 403 });
  const crossInstitute = hasPermission(actor, 'requests.cross-institute');
  if (!sameScope(actor, request, 'institute_id') && !crossInstitute) throw Object.assign(new Error('Request is outside institute scope'), { code: 'INSTITUTE_SCOPE_DENIED', status: 403 });
  if (!sameScope(actor, request, 'department_id') && !hasPermission(actor, 'requests.cross-department') && !hasPermission(actor, permission)) throw Object.assign(new Error('Request is outside department scope'), { code: 'DEPARTMENT_SCOPE_DENIED', status: 403 });
  if (!sameScope(actor, request, 'section_id') && !hasPermission(actor, 'requests.cross-section') && !hasPermission(actor, permission)) throw Object.assign(new Error('Request is outside section scope'), { code: 'SECTION_SCOPE_DENIED', status: 403 });
  if (!hasPermission(actor, permission) && Number(request.requester_id) !== Number(actor.id)) throw Object.assign(new Error(`Missing permission: ${permission}`), { code: 'PERMISSION_DENIED', status: 403 });
  return true;
}

module.exports = { assertCanTransition, hasPermission, sameScope };