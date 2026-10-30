'use strict';
const { departmentApprovedRequestSql, requestActiveSql, itemActiveSql, activePriorityCaseSql, priorityCaseJoins } = require('./activePrioritySql');

// Department ranking starts at HOD approval, before the request necessarily
// reaches its final Approved state.  Procurement-performance normally creates
// cases at final approval, so priority coverage has to be established here as
// well.  Both inserts are idempotent and preserve any richer case/profile that
// already exists.
async function ensureRequestPriorityCoverage({ client, requestId, instituteId, departmentId, actorId }) {
  const created = await client.query(
    `INSERT INTO procurement_cases
       (request_id,requested_item_id,institute_id,department_id,case_status,
        activity_coverage,complexity_coverage,commercial_coverage,cycle_time_coverage,
        logistics_coverage,created_by)
     SELECT r.id,ri.id,r.institute_id,r.department_id,'APPROVAL_PENDING',
            'PARTIAL','MISSING','MISSING','PARTIAL','MISSING',$4
       FROM requests r
       JOIN requested_items ri ON ri.request_id=r.id
      WHERE r.id=$1 AND r.institute_id=$2 AND r.department_id=$3
        AND ${requestActiveSql} AND ${itemActiveSql}
     ON CONFLICT(requested_item_id) WHERE closed_at IS NULL DO NOTHING
     RETURNING id`,
    [requestId, instituteId, departmentId, actorId || null],
  );
  await client.query(
    `INSERT INTO procurement_priority_profiles
       (procurement_case_id,institute_id,department_id,coverage_status)
     SELECT pc.id,pc.institute_id,pc.department_id,'NEEDS_ASSESSMENT'
       FROM procurement_cases pc
       ${priorityCaseJoins}
      WHERE pc.request_id=$1 AND pc.institute_id=$2 AND pc.department_id=$3
        AND ${activePriorityCaseSql}
     ON CONFLICT(procurement_case_id) DO NOTHING`,
    [requestId, instituteId, departmentId],
  );
  return created.rows;
}

async function ensureApprovedDepartmentPriorityCoverage({ client, instituteId, departmentId, actorId }) {
  const requests = await client.query(
    `SELECT r.id FROM requests r
      WHERE r.institute_id=$1 AND r.department_id=$2
        AND ${departmentApprovedRequestSql} AND ${requestActiveSql}
        AND EXISTS (SELECT 1 FROM requested_items ri WHERE ri.request_id=r.id)`,
    [instituteId, departmentId],
  );
  for (const request of requests.rows) {
    await ensureRequestPriorityCoverage({
      client,
      requestId: request.id,
      instituteId,
      departmentId,
      actorId,
    });
  }
}

// Record decision-time authority in the existing immutable approval journal so
// a later promotion/department move does not remove that department's approval.
async function recordDepartmentHodApproval({client,request,approvalId,actor}) {
  if (String(actor?.role || '').trim().toUpperCase()!=='HOD'
    || !actor.department_id || !actor.institute_id
    || String(actor.department_id)!==String(request.department_id)
    || String(actor.institute_id)!==String(request.institute_id)) return;
  await client.query(`INSERT INTO approval_logs(approval_id,request_id,approver_id,action,comments)
    VALUES($1,$2,$3,'Department HOD approved',$4)`,
    [approvalId,request.id,actor.id,`institute:${request.institute_id};department:${request.department_id}`]);
}
module.exports = { ensureRequestPriorityCoverage, ensureApprovedDepartmentPriorityCoverage, recordDepartmentHodApproval };
