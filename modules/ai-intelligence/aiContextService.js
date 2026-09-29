'use strict';

const { aiError } = require('./aiErrors');

function numericIds(values) {
  return (Array.isArray(values) ? values : []).map(Number).filter(Number.isInteger);
}

function buildAiContext(user) {
  if (!user?.id || !user?.institute_id) throw aiError(403, 'AI_SCOPE_UNAVAILABLE', 'An institute-scoped user is required');
  const configured = numericIds(user.data_scopes?.institute_ids);
  const instituteIds = configured.length ? configured : [Number(user.institute_id)];
  return Object.freeze({
    userId: Number(user.id),
    instituteIds: Object.freeze([...new Set(instituteIds)]),
    departmentId: user.department_id == null ? null : Number(user.department_id),
    permissions: Object.freeze([...(user.permissions || [])].map(value => String(value).toLowerCase())),
  });
}

module.exports = { buildAiContext };