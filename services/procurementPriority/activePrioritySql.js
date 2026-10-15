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
const activeDepartmentRankingSql = `WITH active_cases AS (
  SELECT pc.id,pc.request_id,pc.institute_id,pc.department_id,d.department_rank AS legacy_rank
  FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id ${priorityCaseJoins}
  LEFT JOIN department_priority_rankings d ON d.procurement_case_id=pc.id AND d.valid_until IS NULL
  WHERE ${activePriorityCaseSql}
), request_positions AS (
  SELECT c.request_id,c.institute_id,c.department_id,COALESCE(q.department_rank,min(c.legacy_rank)) AS saved_rank
  FROM active_cases c LEFT JOIN request_priority_rankings q ON q.request_id=c.request_id
    AND q.institute_id=c.institute_id AND q.department_id=c.department_id
  GROUP BY c.request_id,c.institute_id,c.department_id,q.department_rank
), projected AS (
  SELECT request_id,CASE WHEN saved_rank IS NOT NULL THEN
    row_number() OVER(PARTITION BY institute_id,department_id ORDER BY saved_rank NULLS LAST,request_id)::int END AS department_rank,
    count(*) OVER(PARTITION BY institute_id,department_id)::int AS department_rank_total
  FROM request_positions
)
SELECT c.id AS procurement_case_id,p.department_rank,p.department_rank_total
FROM active_cases c JOIN projected p ON p.request_id=c.request_id`;

module.exports = { requestActiveSql, itemActiveSql, priorityCaseJoins, activePriorityCaseSql, activeDepartmentRankingSql };
