'use strict';

const pool = require('../config/db');

const positiveIntegers = values => [...new Set((values || []).map(Number).filter(value => Number.isInteger(value) && value > 0))];

function getInstituteScope(user) {
  const scoped = positiveIntegers(user?.data_scopes?.institute_ids);
  return scoped.length ? scoped : positiveIntegers([user?.institute_id]);
}

function hasPermission(user, permission) {
  if (typeof user?.hasPermission === 'function') return user.hasPermission(permission);
  return (user?.permissions || []).includes(permission);
}

/**
 * Canonical purchase-request read authority used by the HTTP request detail view
 * and AI tools. Institute scope is always applied, including for view-all users.
 */
async function findAuthorizedRequest({ requestId, user, database = pool, instituteIds = getInstituteScope(user) }) {
  const scopedInstituteIds = positiveIntegers(instituteIds);
  if (!scopedInstituteIds.length) return null;

  const privileged = hasPermission(user, 'requests.view-all');
  const params = [requestId, scopedInstituteIds];
  let accessClause = '';
  if (!privileged) {
    params.push(user?.id);
    accessClause = `AND (
      r.requester_id = $3
      OR r.assigned_to = $3
      OR EXISTS (SELECT 1 FROM approvals a WHERE a.request_id = r.id AND a.approver_id = $3)
      OR EXISTS (SELECT 1 FROM requested_items access_ri WHERE access_ri.request_id = r.id AND access_ri.assigned_to = $3)
    )`;
  }

  const result = await database.query(
    `SELECT r.*, p.name AS project_name
       FROM requests r
       LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.id = $1
        AND r.institute_id = ANY($2::int[])
        ${accessClause}
      LIMIT 1`,
    params,
  );
  if (!result.rowCount) return null;
  return { request: result.rows[0], privileged };
}

function filterAuthorizedRequestItems(items, request, user, privileged) {
  const userId = Number(user?.id);
  const requestAssignee = Number(request?.assigned_to);
  const isSplitAssignee = !privileged && requestAssignee !== userId &&
    items.some(item => Number(item.assigned_to) === userId);
  const hideRejected = request?.status === 'Approved' &&
    (requestAssignee === userId || isSplitAssignee);

  return items.filter(item => {
    if (isSplitAssignee && Number(item.assigned_to) !== userId) return false;
    if (hideRejected && item.approval_status === 'Rejected') return false;
    return true;
  });
}

module.exports = { findAuthorizedRequest, filterAuthorizedRequestItems, getInstituteScope };