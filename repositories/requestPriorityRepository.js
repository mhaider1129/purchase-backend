'use strict';
const { requestQueue,assertRequestSnapshot } = require('../services/procurementPriority/requestQueueService');
const { activePriorityCaseSql,priorityCaseJoins } = require('../services/procurementPriority/activePrioritySql');
const { writeAuditEvent } = require('../services/auditService');

function createRequestPriorityRepository(caseRepository) {
  const read = async ({ client,instituteId,departmentId,scope='institutional' }) => {
    if (scope==='department' && departmentId == null) throw Object.assign(new Error('Department is required'),{statusCode:403});
    const cases = departmentId == null ? await caseRepository.managementQueue(instituteId,client) : await caseRepository.departmentQueue(instituteId,departmentId,client);
    const saved=await client.query('SELECT * FROM request_priority_rankings WHERE institute_id=$1 AND ($2::bigint IS NULL OR department_id=$2)',[instituteId,departmentId ?? null]);
    const rows=requestQueue(cases,saved.rows,scope);
    // Department positions use the entire department, even in the institution view.
    if (departmentId == null) {
      const departments=[...new Set(cases.map(row => row.department_id).filter(value => value != null))];
      for (const id of departments) {
        const departmentRows=requestQueue(cases.filter(row => String(row.department_id)===String(id)),saved.rows,'department');
        for (const row of departmentRows) {
          const target=rows.find(entry => String(entry.request_id)===String(row.request_id));
          target.department_rank=row.department_rank; target.department_rank_total=departmentRows.length;
        }
      }
    }
    return rows;
  };
  const reorder = async ({ client,instituteId,departmentId,scope,orderedRequestIds,snapshots,actorId,reason }) => {
    if (!['department','institutional'].includes(scope)) throw new TypeError('Invalid priority scope');
    if (scope==='department' && departmentId == null) throw Object.assign(new Error('Department is required'),{statusCode:403});
    // Also serializes two first saves when no request rank record exists yet.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('request-priority:' || $1::text,0))",[instituteId]);
    // Approval decisions hold their parent request before provisioning/reading
    // cases. Acquire all parents first so we cannot hold an item/profile while
    // waiting for a parent owned by an approval transaction.
    await client.query(`SELECT parent.id FROM requests parent WHERE parent.id IN (
      SELECT pc.request_id FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id ${priorityCaseJoins}
      WHERE pc.institute_id=$1 AND ($2::bigint IS NULL OR pc.department_id=$2) AND ${activePriorityCaseSql}
    ) ORDER BY parent.id FOR UPDATE OF parent`,[instituteId,departmentId ?? null]);
    await client.query(`SELECT pc.id FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id ${priorityCaseJoins}
      WHERE pc.institute_id=$1 AND ($2::bigint IS NULL OR pc.department_id=$2) AND ${activePriorityCaseSql}
      ORDER BY r.id,pc.id FOR UPDATE OF r,ri,pc,p`,[instituteId,departmentId ?? null]);
    const current=await read({client,instituteId,departmentId,scope});
    assertRequestSnapshot(current,orderedRequestIds,snapshots);
    const ordered=orderedRequestIds.map(id => current.find(row => String(row.request_id)===String(id)));
    const differs=scope==='institutional' && ordered.some((row,index) => row.system_suggested_rank !== index+1);
    if (differs && !String(reason || '').trim()) throw Object.assign(new Error('Override reason is required when order differs from suggested order'),{statusCode:400});
    for (let index=0;index<ordered.length;index++) {
      const row=ordered[index];
      const written=await client.query(`INSERT INTO request_priority_rankings(request_id,institute_id,department_id,${scope}_rank,updated_by,institutional_override_reason)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(request_id) DO UPDATE SET ${scope}_rank=EXCLUDED.${scope}_rank,
        row_version=request_priority_rankings.row_version+1,updated_by=EXCLUDED.updated_by,updated_at=now()
        ${scope==='institutional' ? ',institutional_override_reason=EXCLUDED.institutional_override_reason' : ''}
        WHERE request_priority_rankings.institute_id=EXCLUDED.institute_id AND request_priority_rankings.department_id=EXCLUDED.department_id`,
      [row.request_id,instituteId,scope==='department' ? departmentId : row.department_id,index+1,actorId,differs ? String(reason).trim() : null]);
      if (!written.rowCount) throw Object.assign(new Error('Request ownership changed; review the priority scope before saving'),{statusCode:409});
    }
    await writeAuditEvent({client,entityType:`${scope}_request_priority_queue`,entityId:scope==='department' ? departmentId : instituteId,
      action:scope==='department' ? 'DEPARTMENT_REQUEST_PRIORITIES_REORDERED' : 'INSTITUTIONAL_REQUEST_PRIORITIES_REORDERED',actorUserId:actorId,instituteId,reason:reason || null,
      beforeData:current.map(row => ({request_id:row.request_id,rank:row[`${scope}_rank`]})),
      afterData:ordered.map((row,index) => ({request_id:row.request_id,rank:index+1,member_case_ids:row.members.map(member => member.procurement_case_id)}))});
    return read({client,instituteId,departmentId,scope});
  };
  return {read,reorder};
}
module.exports={createRequestPriorityRepository};
