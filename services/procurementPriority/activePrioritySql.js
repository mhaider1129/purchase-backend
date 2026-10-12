'use strict';
const { TERMINAL_STATUSES } = require('./constants');
const terminal = [...TERMINAL_STATUSES].map(status => `'${status.replace(/'/g, "''")}'`).join(',');
const requestActiveSql = `UPPER(TRIM(COALESCE(r.status,''))) NOT IN (${terminal})`;
const itemActiveSql = `UPPER(TRIM(COALESCE(ri.approval_status,''))) <> 'REJECTED'
  AND UPPER(TRIM(COALESCE(ri.procurement_status,''))) NOT IN (${terminal},'PURCHASED','FULLY_PROCURED','NOT_PROCURED','UNABLE_TO_PROCURE')`;
const priorityCaseJoins = `JOIN requests r ON r.id=pc.request_id
  JOIN requested_items ri ON ri.id=pc.requested_item_id AND ri.request_id=pc.request_id`;
const activePriorityCaseSql = `pc.closed_at IS NULL AND pc.id IS NOT NULL AND r.id IS NOT NULL AND ri.id IS NOT NULL
  AND UPPER(TRIM(COALESCE(pc.case_status,''))) NOT IN (${terminal})
  AND ${requestActiveSql} AND ${itemActiveSql}`;
// Project current positions without rewriting the effective-dated rank history.
const activeDepartmentRankingSql = `SELECT pc.id AS procurement_case_id,
  CASE WHEN d.department_rank IS NOT NULL THEN row_number() OVER(PARTITION BY pc.institute_id,pc.department_id ORDER BY d.department_rank NULLS LAST,pc.id)::int END AS department_rank,
  count(*) OVER(PARTITION BY pc.institute_id,pc.department_id)::int AS department_rank_total
  FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id ${priorityCaseJoins}
  LEFT JOIN department_priority_rankings d ON d.procurement_case_id=pc.id AND d.valid_until IS NULL
  WHERE ${activePriorityCaseSql}`;
module.exports = { requestActiveSql, itemActiveSql, priorityCaseJoins, activePriorityCaseSql, activeDepartmentRankingSql };
