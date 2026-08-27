'use strict';
const pool = require('../config/db');
const { writeAuditEvent } = require('../services/auditService');

const ACTIVE = "pc.closed_at IS NULL";
function createProcurementPriorityRepository(database = pool) {
  const transaction = async work => { const client = await database.connect(); try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } };
  return {
    transaction,
    async publicQueue(instituteId) {
      const result = await database.query(`SELECT p.institutional_rank,p.public_title,p.public_description,p.system_tier AS tier,
        CASE WHEN p.system_score IS NULL THEN NULL ELSE concat(floor(p.system_score/10)*10,'-',floor(p.system_score/10)*10+9) END AS score_band,
        GREATEST(0,extract(day FROM now()-pc.opened_at))::int AS age,p.impact_level AS impact,pc.case_status,1::int AS member_count,false AS is_group
        FROM procurement_priority_profiles p JOIN procurement_cases pc ON pc.id=p.procurement_case_id
        WHERE p.institute_id=$1 AND p.is_public AND ${ACTIVE}
        UNION ALL SELECT g.institutional_rank,g.public_title,g.public_description,g.tier_override,NULL,NULL,NULL,g.status,
        count(m.procurement_case_id)::int,true FROM procurement_priority_groups g LEFT JOIN procurement_priority_group_members m ON m.group_id=g.id AND m.removed_at IS NULL
        WHERE g.institute_id=$1 AND g.is_public AND g.status='ACTIVE' GROUP BY g.id ORDER BY institutional_rank NULLS LAST`, [instituteId]);
      return result.rows;
    },
    async departmentQueue(instituteId, departmentId, client = database) {
      const result = await client.query(`SELECT pc.id AS procurement_case_id,pc.case_status,p.public_title,p.system_tier,p.institutional_rank,
        d.department_rank,d.department_rank_total,p.row_version,GREATEST(0,extract(day FROM now()-pc.opened_at))::int AS age
        FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id
        LEFT JOIN department_priority_rankings d ON d.procurement_case_id=pc.id AND d.valid_until IS NULL
        WHERE pc.institute_id=$1 AND pc.department_id=$2 AND ${ACTIVE} ORDER BY d.department_rank NULLS LAST,pc.id`, [instituteId, departmentId]);
      return result.rows;
    },
    async reorderDepartment({ instituteId, departmentId, orderedCaseIds, version, actorId }) {
      return transaction(async client => {
        const current = await client.query(`SELECT pc.id,p.row_version FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id WHERE pc.institute_id=$1 AND pc.department_id=$2 AND ${ACTIVE} ORDER BY pc.id FOR UPDATE OF pc,p`, [instituteId, departmentId]);
        const expected=current.rows.map(x=>String(x.id)).sort(); const supplied=orderedCaseIds.map(String);
        if (new Set(supplied).size!==supplied.length || supplied.length!==expected.length || supplied.slice().sort().some((x,i)=>x!==expected[i])) { const e=new Error('Complete ordered active set is required'); e.statusCode=409; throw e; }
        if (current.rows.some(x=>String(x.row_version)!==String(version))) { const e=new Error('Priority queue changed; reload and try again'); e.statusCode=409; e.code='PRIORITY_VERSION_CONFLICT'; throw e; }
        await client.query(`UPDATE department_priority_rankings SET valid_until=now() WHERE institute_id=$1 AND department_id=$2 AND valid_until IS NULL`,[instituteId,departmentId]);
        for (let index=0; index<orderedCaseIds.length; index++) await client.query(`INSERT INTO department_priority_rankings(procurement_case_id,institute_id,department_id,department_rank,department_rank_total,ranked_by) VALUES($1,$2,$3,$4,$5,$6)`,[orderedCaseIds[index],instituteId,departmentId,index+1,orderedCaseIds.length,actorId]);
        await client.query(`UPDATE procurement_priority_profiles SET row_version=row_version+1,updated_at=now() WHERE procurement_case_id=ANY($1::bigint[])`,[orderedCaseIds]);
        await writeAuditEvent({client,entityType:'department_priority_queue',entityId:`${instituteId}:${departmentId}`,action:'DEPARTMENT_PRIORITY_REORDERED',actorUserId:actorId,instituteId,afterData:{orderedCaseIds}});
        return this.departmentQueue(instituteId,departmentId,client);
      });
    },
    async profile(caseId, instituteId) { const r=await database.query(`SELECT p.*,d.department_rank,d.department_rank_total FROM procurement_priority_profiles p LEFT JOIN department_priority_rankings d ON d.procurement_case_id=p.procurement_case_id AND d.valid_until IS NULL WHERE p.procurement_case_id=$1 AND p.institute_id=$2`,[caseId,instituteId]); return r.rows[0]||null; },
    async history(caseId,instituteId){ const r=await database.query(`SELECT h.* FROM procurement_priority_history h JOIN procurement_priority_profiles p ON p.procurement_case_id=h.procurement_case_id WHERE h.procurement_case_id=$1 AND p.institute_id=$2 ORDER BY calculated_at DESC,id DESC`,[caseId,instituteId]); return r.rows; },
  };
}
module.exports={createProcurementPriorityRepository};