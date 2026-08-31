'use strict';

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
        AND COALESCE(UPPER(ri.approval_status),'PENDING') <> 'REJECTED'
     ON CONFLICT(requested_item_id) WHERE closed_at IS NULL DO NOTHING
     RETURNING id`,
    [requestId, instituteId, departmentId, actorId || null],
  );
  await client.query(
    `INSERT INTO procurement_priority_profiles
       (procurement_case_id,institute_id,department_id,coverage_status)
     SELECT pc.id,pc.institute_id,pc.department_id,'NEEDS_ASSESSMENT'
       FROM procurement_cases pc
      WHERE pc.request_id=$1 AND pc.institute_id=$2 AND pc.department_id=$3
        AND pc.closed_at IS NULL
     ON CONFLICT(procurement_case_id) DO NOTHING`,
    [requestId, instituteId, departmentId],
  );
  return created.rows;
}

async function ensureApprovedDepartmentPriorityCoverage({ client, instituteId, departmentId, actorId }) {
  const requests = await client.query(
    `SELECT DISTINCT r.id
       FROM requests r
       JOIN approvals a ON a.request_id=r.id AND a.status='Approved'
       JOIN users approver ON approver.id=a.approver_id
      WHERE r.institute_id=$1 AND r.department_id=$2
        AND UPPER(approver.role)='HOD'
        AND UPPER(r.status) NOT IN ('REJECTED','CANCELLED','CANCELED','COMPLETED')
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

module.exports = { ensureRequestPriorityCoverage, ensureApprovedDepartmentPriorityCoverage };