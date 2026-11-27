"use strict";
const { projectionSql } = require("../requestFulfillmentSql");
const { TERMINAL_STATUSES } = require("./constants");
const terminal = [...TERMINAL_STATUSES]
  .map((value) => `'${value.replace(/'/g, "''")}'`)
  .join(",");
const {
  departmentApprovedRequestSql,
  priorityCaseJoins,
  activePriorityCaseFromCompletionSql,
} = require("./activePrioritySql");
// Bound before expensive completion/approval evaluation. Never scan other
// institutes to build departmental positions for this management request.
const managementQueueSql = `WITH candidate_requests AS MATERIALIZED (
 SELECT DISTINCT r.id,r.institute_id
 FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id
 ${priorityCaseJoins}
 WHERE p.institute_id=$1 AND pc.institute_id=$1 AND r.institute_id=$1 AND pc.closed_at IS NULL
 AND UPPER(TRIM(COALESCE(pc.case_status,''))) NOT IN (${terminal})
 AND UPPER(TRIM(COALESCE(r.status,''))) NOT IN (${terminal})
 AND UPPER(TRIM(COALESCE(ri.approval_status,''))) <> 'REJECTED'
 AND UPPER(TRIM(COALESCE(ri.procurement_status,''))) NOT IN (${terminal},'PURCHASED','FULLY_PROCURED','NOT_PROCURED','UNABLE_TO_PROCURE')
), request_completion AS MATERIALIZED (
 SELECT r.id AS request_id,r.institute_id,${projectionSql("r")} AS completion,
 ${departmentApprovedRequestSql} AS department_approved
 FROM requests r JOIN candidate_requests c ON c.id=r.id AND c.institute_id=r.institute_id
), active_cases AS MATERIALIZED (
 SELECT pc.id,pc.request_id,pc.institute_id,pc.department_id,rc.department_approved
 FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id
 ${priorityCaseJoins}
 JOIN request_completion rc ON rc.request_id=r.id AND rc.institute_id=r.institute_id
 WHERE p.institute_id=$1 AND pc.institute_id=$1 AND r.institute_id=$1
 AND ${activePriorityCaseFromCompletionSql("rc.completion")}
), request_positions AS (
 SELECT c.request_id,c.institute_id,c.department_id,COALESCE(q.department_rank,min(d.department_rank)) AS saved_rank
 FROM active_cases c
 LEFT JOIN department_priority_rankings d ON d.procurement_case_id=c.id AND d.valid_until IS NULL
 LEFT JOIN request_priority_rankings q ON q.request_id=c.request_id AND q.institute_id=c.institute_id AND q.department_id=c.department_id
 WHERE c.department_approved
 GROUP BY c.request_id,c.institute_id,c.department_id,q.department_rank
), projected AS (
 SELECT request_id,institute_id,department_id,
 CASE WHEN saved_rank IS NOT NULL THEN row_number() OVER(PARTITION BY institute_id,department_id ORDER BY saved_rank NULLS LAST,request_id)::int END AS department_rank,
 count(*) OVER(PARTITION BY institute_id,department_id)::int AS department_rank_total
 FROM request_positions
)
SELECT a.department_approved,p.procurement_case_id,p.row_version,pc.department_id,r.id AS request_id,r.status AS request_status,
 COALESCE(NULLIF(r.maintenance_ref_number,''),r.id::text) AS request_reference,
 COALESCE(NULLIF(TRIM(p.public_title),''),ri.item_name,'Requirement ' || pc.id::text) AS public_title,
 d.name AS department_name,dr.department_rank,p.system_score,p.system_tier,p.system_suggested_rank,p.institutional_rank,
 GREATEST(0,extract(day FROM now()-pc.opened_at))::int AS age,p.impact_level,p.service_risk_level,p.deadline_at,p.deadline_type,
 pc.case_status,g.public_title AS priority_group_name
FROM active_cases a JOIN procurement_cases pc ON pc.id=a.id
JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id AND p.institute_id=pc.institute_id
${priorityCaseJoins}
LEFT JOIN departments d ON d.id=pc.department_id
LEFT JOIN projected dr ON dr.request_id=pc.request_id AND dr.institute_id=pc.institute_id AND dr.department_id=pc.department_id
LEFT JOIN procurement_priority_group_members gm ON gm.procurement_case_id=pc.id AND gm.removed_at IS NULL
LEFT JOIN procurement_priority_groups g ON g.id=gm.group_id AND g.status='ACTIVE' AND g.institute_id=pc.institute_id
ORDER BY p.institutional_rank NULLS LAST,p.system_suggested_rank NULLS LAST,p.procurement_case_id`;
module.exports = { managementQueueSql };
