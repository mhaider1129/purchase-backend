'use strict';

const { writeAuditEvent } = require('../auditService');
const { provisionNeutralPriorityProfile } = require('./priorityProfileProvisioningService');
const { ensureRequestPriorityCoverage } = require('./departmentPriorityCoverageService');

const STATE = 'HOD_RANKING_REQUIRED';
const { activePriorityCaseSql, priorityCaseJoins, activeDepartmentRankingSql } = require('./activePrioritySql');
const { requestQueue } = require('./requestQueueService');
const INSTRUCTION = "Place this whole request relative to your department's other active requests. All its items share one position.";

async function findGate({ client, request, approvalLevel, actorId }) {
  await ensureRequestPriorityCoverage({ client, requestId: request.id,
    instituteId: request.institute_id, departmentId: request.department_id, actorId });
  const result = await client.query(
    `SELECT pc.id AS procurement_case_id,pc.institute_id,pc.department_id,p.public_title, p.row_version,
            d.department_rank, d.department_rank_total
       FROM procurement_cases pc
       ${priorityCaseJoins}
       LEFT JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id
       LEFT JOIN (${activeDepartmentRankingSql}) d ON d.procurement_case_id=pc.id
      WHERE pc.request_id=$1 AND pc.institute_id=$2 AND pc.department_id=$3
        AND ${activePriorityCaseSql}
      ORDER BY pc.id
      FOR UPDATE OF pc`,
    [request.id, request.institute_id, request.department_id],
  );
  const cases = result.rows;
  const missingProfiles = cases.filter(row => row.row_version == null);
  for (const row of missingProfiles) await provisionNeutralPriorityProfile({ client,
    procurementCaseId: row.procurement_case_id, instituteId: row.institute_id, departmentId: row.department_id });
  const requiringRanking = cases.filter(row => row.department_rank == null);
  if (!requiringRanking.length) return null;
  const queue = await client.query(
    `SELECT pc.id AS procurement_case_id,pc.request_id,pc.department_id,r.status AS request_status,
            COALESCE(NULLIF(r.maintenance_ref_number,''),r.id::text) AS request_reference,
            COALESCE(NULLIF(TRIM(p.public_title),''),ri.item_name) AS public_title,p.row_version,p.system_tier,p.system_score,d.department_rank,d.department_rank_total
       FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id
       ${priorityCaseJoins}
       LEFT JOIN (${activeDepartmentRankingSql}) d ON d.procurement_case_id=pc.id
      WHERE pc.institute_id=$1 AND pc.department_id=$2 AND ${activePriorityCaseSql}
      ORDER BY d.department_rank NULLS LAST,pc.id`,
    [request.institute_id, request.department_id],
  );
  const saved = await client.query('SELECT * FROM request_priority_rankings WHERE institute_id=$1 AND department_id=$2',[request.institute_id,request.department_id]);
  return { state: STATE, requestId: request.id, approvalLevel: Number(approvalLevel), instruction: INSTRUCTION,
    requiredCaseIds: requiringRanking.map(row => row.procurement_case_id), requiredRequestIds:[request.id],
    grain:'request',queue:requestQueue(queue.rows,saved.rows,'department') };
}

async function auditGate({ client, request, approval, actorId, gate }) {
  await writeAuditEvent({ client, entityType: 'request', entityId: request.id,
    action: 'HOD_RANKING_REQUIRED', actorUserId: actorId, instituteId: request.institute_id,
    requestId: request.id, afterData: gate,
    metadata: { approvalLevel: approval.approval_level, approvalId: approval.id } });
}

module.exports = { STATE, INSTRUCTION, findGate, auditGate };
