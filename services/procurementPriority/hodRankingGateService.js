'use strict';

const { writeAuditEvent } = require('../auditService');
const { provisionNeutralPriorityProfile } = require('./priorityProfileProvisioningService');

const STATE = 'HOD_RANKING_REQUIRED';
const INSTRUCTION = "Place this requirement relative to your department's other active procurement requirements.";

async function findGate({ client, request, approvalLevel }) {
  const result = await client.query(
    `SELECT pc.id AS procurement_case_id,pc.institute_id,pc.department_id,p.public_title, p.row_version,
            d.department_rank, d.department_rank_total
       FROM procurement_cases pc
       LEFT JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id
       LEFT JOIN department_priority_rankings d
         ON d.procurement_case_id=pc.id AND d.valid_until IS NULL
      WHERE pc.request_id=$1 AND pc.institute_id=$2 AND pc.department_id=$3
        AND pc.closed_at IS NULL
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
    `SELECT pc.id AS procurement_case_id,p.public_title,p.row_version,d.department_rank,d.department_rank_total
       FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id
       LEFT JOIN department_priority_rankings d ON d.procurement_case_id=pc.id AND d.valid_until IS NULL
      WHERE pc.institute_id=$1 AND pc.department_id=$2 AND pc.closed_at IS NULL
      ORDER BY d.department_rank NULLS LAST,pc.id FOR UPDATE OF pc,p`,
    [request.institute_id, request.department_id],
  );
  return { state: STATE, requestId: request.id, approvalLevel: Number(approvalLevel), instruction: INSTRUCTION,
    requiredCaseIds: requiringRanking.map(row => row.procurement_case_id), queue: queue.rows };
}

async function auditGate({ client, request, approval, actorId, gate }) {
  await writeAuditEvent({ client, entityType: 'request', entityId: request.id,
    action: 'HOD_RANKING_REQUIRED', actorUserId: actorId, instituteId: request.institute_id,
    requestId: request.id, afterData: gate,
    metadata: { approvalLevel: approval.approval_level, approvalId: approval.id } });
}

module.exports = { STATE, INSTRUCTION, findGate, auditGate };