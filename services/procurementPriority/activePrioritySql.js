'use strict';
const { TERMINAL_STATUSES } = require('./constants');
const {stockItemSql,effectiveRequestStatusSql}=require('../requestFulfillmentSql');
const terminal = [...TERMINAL_STATUSES].map(status => `'${status.replace(/'/g, "''")}'`).join(',');
const requestActiveSql = `UPPER(TRIM(COALESCE(${effectiveRequestStatusSql('r')},''))) NOT IN (${terminal})`;
const itemActiveSql = `UPPER(TRIM(COALESCE(ri.approval_status,''))) <> 'REJECTED'
  AND UPPER(TRIM(COALESCE(ri.procurement_status,''))) NOT IN (${terminal},'PURCHASED','FULLY_PROCURED','NOT_PROCURED','UNABLE_TO_PROCURE')
  AND NOT ${stockItemSql('ri')}`;
const priorityCaseJoins = `JOIN requests r ON r.id=pc.request_id
  JOIN requested_items ri ON ri.id=pc.requested_item_id AND ri.request_id=pc.request_id`;
const activePriorityCaseSql = `pc.closed_at IS NULL AND pc.id IS NOT NULL AND r.id IS NOT NULL AND ri.id IS NOT NULL
  AND UPPER(TRIM(COALESCE(pc.case_status,''))) NOT IN (${terminal})
  AND ${requestActiveSql} AND ${itemActiveSql}`;
// A departmental queue starts only after a non-superseded approval by that
// department's HOD. Institution-wide assessment coverage alone is not approval.
const departmentApprovedRequestSql = `EXISTS (
  SELECT 1 FROM approvals department_approval
  JOIN users department_approver ON department_approver.id=department_approval.approver_id
  WHERE department_approval.request_id=r.id AND department_approval.status='Approved'
    AND COALESCE(department_approval.is_superseded,FALSE)=FALSE
    AND ((UPPER(TRIM(department_approver.role))='HOD'
      AND department_approver.department_id=r.department_id
      AND department_approver.institute_id=r.institute_id)
      OR EXISTS(SELECT 1 FROM approval_logs department_decision
        WHERE department_decision.approval_id=department_approval.id
          AND department_decision.request_id=r.id
          AND department_decision.approver_id=department_approval.approver_id
          AND department_decision.action='Department HOD approved'
          AND department_decision.comments='institute:' || r.institute_id::text || ';department:' || r.department_id::text))
)`;
// Project current positions without rewriting the effective-dated rank history.
const activeDepartmentRankingSql = `WITH active_cases AS (
  SELECT pc.id,pc.request_id,pc.institute_id,pc.department_id,d.department_rank AS legacy_rank
  FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id ${priorityCaseJoins}
  LEFT JOIN department_priority_rankings d ON d.procurement_case_id=pc.id AND d.valid_until IS NULL
  WHERE ${activePriorityCaseSql} AND ${departmentApprovedRequestSql}
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

module.exports = { departmentApprovedRequestSql, requestActiveSql, itemActiveSql, priorityCaseJoins, activePriorityCaseSql, activeDepartmentRankingSql };
