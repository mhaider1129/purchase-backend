"use strict";
const pool = require("../config/db");
const { writeAuditEvent } = require("../services/auditService");
const { assertQueueVersions } = require('../services/procurementPriority/queueVersionService');

const { activePriorityCaseSql: ACTIVE, priorityCaseJoins, activeDepartmentRankingSql } = require('../services/procurementPriority/activePrioritySql');
function createProcurementPriorityRepository(database = pool) {
  const transaction = async (work) => {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  return {
    transaction,
    async publicQueue(instituteId) {
      const result = await database.query(
        `SELECT COALESCE(q.institutional_rank,min(p.institutional_rank)) AS institutional_rank,
        string_agg(DISTINCT p.public_title,' · ') AS public_title,string_agg(DISTINCT p.public_description,' · ') AS public_description,
        min(p.system_tier) AS tier,
        CASE WHEN (array_agg(p.system_score ORDER BY p.system_tier ASC NULLS LAST,p.system_score DESC NULLS LAST,pc.id))[1] IS NULL THEN NULL ELSE concat(floor((array_agg(p.system_score ORDER BY p.system_tier ASC NULLS LAST,p.system_score DESC NULLS LAST,pc.id))[1]/10)*10,'-',floor((array_agg(p.system_score ORDER BY p.system_tier ASC NULLS LAST,p.system_score DESC NULLS LAST,pc.id))[1]/10)*10+9) END AS score_band,
        max(GREATEST(0,extract(day FROM now()-pc.opened_at)))::int AS age,NULL::text AS impact,r.status AS case_status,count(*)::int AS member_count,false AS is_group
        FROM procurement_priority_profiles p JOIN procurement_cases pc ON pc.id=p.procurement_case_id
        ${priorityCaseJoins}
        LEFT JOIN request_priority_rankings q ON q.request_id=pc.request_id AND q.institute_id=pc.institute_id
        WHERE p.institute_id=$1 AND p.is_public AND ${ACTIVE}
        GROUP BY pc.request_id,r.status,q.institutional_rank
        UNION ALL SELECT g.institutional_rank,g.public_title,g.public_description,g.tier_override,NULL,NULL,NULL,g.status,
        count(m.procurement_case_id)::int,true FROM procurement_priority_groups g JOIN procurement_priority_group_members m ON m.group_id=g.id AND m.removed_at IS NULL
        JOIN procurement_cases pc ON pc.id=m.procurement_case_id AND pc.institute_id=g.institute_id ${priorityCaseJoins}
        WHERE g.institute_id=$1 AND g.is_public AND g.status='ACTIVE' AND ${ACTIVE} GROUP BY g.id ORDER BY institutional_rank NULLS LAST`,
        [instituteId],
      );
      return result.rows;
    },
    async departmentQueue(instituteId, departmentId, client = database) {
      const result = await client.query(
        `SELECT pc.id AS procurement_case_id,pc.case_status,pc.department_id,r.id AS request_id,r.status AS request_status,
        COALESCE(NULLIF(TRIM(p.public_title),''),ri.item_name,'Requirement ' || pc.id::text) AS public_title,
        COALESCE(NULLIF(r.maintenance_ref_number,''),r.id::text) AS request_reference,p.system_tier,p.system_score,p.institutional_rank,
        d.department_rank,d.department_rank_total,p.row_version,GREATEST(0,extract(day FROM now()-pc.opened_at))::int AS age
        FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id
        JOIN requests r ON r.id=pc.request_id JOIN requested_items ri ON ri.id=pc.requested_item_id
        LEFT JOIN (${activeDepartmentRankingSql}) d ON d.procurement_case_id=pc.id
        WHERE pc.institute_id=$1 AND pc.department_id=$2 AND ${ACTIVE} ORDER BY d.department_rank NULLS LAST,pc.id`,
        [instituteId, departmentId],
      );
      return result.rows;
    },
    async reorderDepartment({
      instituteId,
      departmentId,
      orderedCaseIds,
      version,
      versions,
      actorId,
      client: suppliedClient = null,
    }) {
      const work = async (client) => {
        const current = await client.query(
          `SELECT pc.id,p.row_version FROM procurement_cases pc JOIN procurement_priority_profiles p ON p.procurement_case_id=pc.id ${priorityCaseJoins} WHERE pc.institute_id=$1 AND pc.department_id=$2 AND ${ACTIVE} ORDER BY pc.id FOR UPDATE OF pc,p,r,ri`,
          [instituteId, departmentId],
        );
        const expected = current.rows.map((x) => String(x.id)).sort();
        const supplied = orderedCaseIds.map(String);
        if (
          new Set(supplied).size !== supplied.length ||
          supplied.length !== expected.length ||
          supplied
            .slice()
            .sort()
            .some((x, i) => x !== expected[i])
        ) {
          const e = new Error("Complete ordered active set is required");
          e.statusCode = 409;
          throw e;
        }
        assertQueueVersions(current.rows, versions, version);
        await client.query(
          `UPDATE department_priority_rankings SET valid_until=now() WHERE institute_id=$1 AND department_id=$2 AND valid_until IS NULL`,
          [instituteId, departmentId],
        );
        for (let index = 0; index < orderedCaseIds.length; index++)
          await client.query(
            `INSERT INTO department_priority_rankings(procurement_case_id,institute_id,department_id,department_rank,department_rank_total,ranked_by) VALUES($1,$2,$3,$4,$5,$6)`,
            [
              orderedCaseIds[index],
              instituteId,
              departmentId,
              index + 1,
              orderedCaseIds.length,
              actorId,
            ],
          );
        await client.query(
          `UPDATE procurement_priority_profiles SET row_version=row_version+1,updated_at=now() WHERE procurement_case_id=ANY($1::bigint[])`,
          [orderedCaseIds],
        );
        await writeAuditEvent({
          client,
          entityType: "department_priority_queue",
          // audit_logs.target_id is an integer in the deployed schema. The
          // institute is already captured separately in the audit details, so
          // use the department as the queue's concrete audit target rather
          // than a composite string that PostgreSQL cannot cast to integer.
          entityId: departmentId,
          action: "DEPARTMENT_PRIORITY_REORDERED",
          actorUserId: actorId,
          instituteId,
          afterData: { orderedCaseIds },
        });
        return this.departmentQueue(instituteId, departmentId, client);
      };
      return suppliedClient ? work(suppliedClient) : transaction(work);
    },
    async profile(caseId, instituteId) {
      const r = await database.query(
        `SELECT p.*,COALESCE(q.institutional_rank,p.institutional_rank) AS institutional_rank,d.department_rank,d.department_rank_total FROM procurement_priority_profiles p JOIN procurement_cases pc ON pc.id=p.procurement_case_id LEFT JOIN request_priority_rankings q ON q.request_id=pc.request_id AND q.institute_id=p.institute_id LEFT JOIN (${activeDepartmentRankingSql}) d ON d.procurement_case_id=p.procurement_case_id WHERE p.procurement_case_id=$1 AND p.institute_id=$2`,
        [caseId, instituteId],
      );
      return r.rows[0] || null;
    },
    async history(caseId, instituteId) {
      const r = await database.query(
        `SELECT h.* FROM procurement_priority_history h JOIN procurement_priority_profiles p ON p.procurement_case_id=h.procurement_case_id WHERE h.procurement_case_id=$1 AND p.institute_id=$2 ORDER BY calculated_at DESC,id DESC`,
        [caseId, instituteId],
      );
      return r.rows;
    },
    async managementQueue(instituteId, client = database) {
      const r = await client.query(
        `SELECT p.procurement_case_id,p.row_version,pc.department_id,r.id AS request_id,r.status AS request_status,COALESCE(NULLIF(r.maintenance_ref_number,''),r.id::text) AS request_reference,COALESCE(NULLIF(TRIM(p.public_title),''),ri.item_name,'Requirement ' || pc.id::text) AS public_title,d.name AS department_name,dr.department_rank,p.system_score,p.system_tier,p.system_suggested_rank,p.institutional_rank,GREATEST(0,extract(day FROM now()-pc.opened_at))::int AS age,p.impact_level,p.service_risk_level,p.deadline_at,p.deadline_type,pc.case_status,g.public_title AS priority_group_name FROM procurement_priority_profiles p JOIN procurement_cases pc ON pc.id=p.procurement_case_id ${priorityCaseJoins} LEFT JOIN departments d ON d.id=pc.department_id LEFT JOIN (${activeDepartmentRankingSql}) dr ON dr.procurement_case_id=pc.id LEFT JOIN procurement_priority_group_members gm ON gm.procurement_case_id=pc.id AND gm.removed_at IS NULL LEFT JOIN procurement_priority_groups g ON g.id=gm.group_id AND g.status='ACTIVE' WHERE p.institute_id=$1 AND ${ACTIVE} ORDER BY p.institutional_rank NULLS LAST,p.system_suggested_rank NULLS LAST,p.procurement_case_id`,
        [instituteId],
      );
      return r.rows;
    },
    async groups(instituteId, client = database) {
      const r = await client.query(
        `SELECT g.*,count(m.procurement_case_id) FILTER(WHERE m.removed_at IS NULL AND ${ACTIVE})::int AS member_count,array_remove(array_agg(m.procurement_case_id) FILTER(WHERE m.removed_at IS NULL AND ${ACTIVE}),NULL) AS member_case_ids FROM procurement_priority_groups g LEFT JOIN procurement_priority_group_members m ON m.group_id=g.id LEFT JOIN procurement_cases pc ON pc.id=m.procurement_case_id AND pc.institute_id=g.institute_id LEFT JOIN requests r ON r.id=pc.request_id LEFT JOIN requested_items ri ON ri.id=pc.requested_item_id AND ri.request_id=pc.request_id WHERE g.institute_id=$1 GROUP BY g.id ORDER BY g.created_at,g.id`,
        [instituteId],
      );
      return r.rows;
    },
  };
}
module.exports = { createProcurementPriorityRepository };
