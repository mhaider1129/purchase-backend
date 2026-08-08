const CURRENT_FILTER = 'COALESCE(is_superseded,FALSE)=FALSE';

function scopeClause(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `(($2::integer IS NOT NULL AND ${prefix}approval_route_version=$2)
       OR ($2::integer IS NULL AND $3::text IS NOT NULL AND ${prefix}approval_route_version IS NULL AND ${prefix}route_snapshot_id=$3)
       OR ($2::integer IS NULL AND $3::text IS NULL AND ${prefix}approval_route_version IS NULL AND ${prefix}route_snapshot_id IS NULL))`;
}

const scopeParams = ({ requestId, approvalRouteVersion, routeSnapshotId }) =>
  [requestId, approvalRouteVersion ?? null, routeSnapshotId ?? null];

async function lockRequest(client, requestId) {
  const { rows } = await client.query('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [requestId]);
  return rows[0] || null;
}

async function findApproval(client, approvalId) {
  const { rows } = await client.query('SELECT * FROM approvals WHERE id=$1', [approvalId]);
  return rows[0] || null;
}

async function lockWorkflow(client, scope) {
  const { rows } = await client.query(
    `SELECT * FROM approvals
      WHERE request_id=$1 AND ${CURRENT_FILTER} AND ${scopeClause()}
      ORDER BY approval_level,id FOR UPDATE`, scopeParams(scope));
  return rows;
}

async function getCurrentLevel(client, scope) {
  const { rows } = await client.query(
    `SELECT MIN(approval_level) AS approval_level FROM approvals
      WHERE request_id=$1 AND status='Pending' AND ${CURRENT_FILTER} AND ${scopeClause()}`,
    scopeParams(scope));
  return rows[0]?.approval_level == null ? null : Number(rows[0].approval_level);
}

async function getNextLevel(client, scope, currentLevel) {
  const { rows } = await client.query(
    `SELECT MIN(approval_level) AS approval_level FROM approvals
      WHERE request_id=$1 AND approval_level>$4 AND status='Pending'
        AND ${CURRENT_FILTER} AND ${scopeClause()}`,
    [...scopeParams(scope), currentLevel]);
  return rows[0]?.approval_level == null ? null : Number(rows[0].approval_level);
}

async function activateLevel(client, scope, level) {
  const { rows } = await client.query(
    `UPDATE approvals SET is_active=TRUE
      WHERE request_id=$1 AND approval_level=$4 AND status='Pending' AND is_active=FALSE
        AND approver_id IS NOT NULL AND ${CURRENT_FILTER} AND ${scopeClause()}
      RETURNING *`, [...scopeParams(scope), level]);
  return rows;
}

async function deactivatePendingLevel(client, scope, level) {
  const { rows } = await client.query(
    `UPDATE approvals SET is_active=FALSE
      WHERE request_id=$1 AND approval_level=$4 AND status='Pending' AND is_active=TRUE
        AND ${CURRENT_FILTER} AND ${scopeClause()} RETURNING *`,
    [...scopeParams(scope), level]);
  return rows;
}

async function getLevelDecisionSummary(client, scope, level) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::integer AS member_count,
            COUNT(*) FILTER (WHERE status='Approved')::integer AS approved_count,
            COUNT(*) FILTER (WHERE status='Rejected')::integer AS rejected_count,
            COUNT(*) FILTER (WHERE status='Returned')::integer AS returned_count,
            COUNT(*) FILTER (WHERE status='Pending')::integer AS pending_count
       FROM approvals
      WHERE request_id=$1 AND approval_level=$4 AND ${CURRENT_FILTER} AND ${scopeClause()}`,
    [...scopeParams(scope), level]);
  const row = rows[0] || {};
  return {
    memberCount: Number(row.member_count || 0), approvedCount: Number(row.approved_count || 0),
    rejectedCount: Number(row.rejected_count || 0), returnedCount: Number(row.returned_count || 0),
    pendingCount: Number(row.pending_count || 0),
  };
}

module.exports = {
  CURRENT_FILTER, lockRequest, findApproval, lockWorkflow, getCurrentLevel, getNextLevel,
  activateLevel, deactivatePendingLevel, getLevelDecisionSummary,
};