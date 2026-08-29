'use strict';
const pool = require('../config/db');
const { provisionNeutralPriorityProfile } = require('../services/procurementPriority/priorityProfileProvisioningService');

function createProcurementPerformanceRepository(database = pool) {
  const q = (text, params) => database.query(text, params);
  const repository = {
    client: database,
    withTransaction: async work => {
      if (typeof database.connect !== 'function') return work(repository);
      const client = await database.connect();
      try { await client.query('BEGIN'); const value = await work(createProcurementPerformanceRepository(client)); await client.query('COMMIT'); return value; }
      catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    findActiveByRequestedItem: async id => (await q('SELECT * FROM procurement_cases WHERE requested_item_id=$1 AND closed_at IS NULL', [id])).rows[0],
    insertCase: async row => (await q(`INSERT INTO procurement_cases(request_id,requested_item_id,institute_id,department_id,assigned_buyer_id,case_status,activity_coverage,complexity_coverage,commercial_coverage,cycle_time_coverage,logistics_coverage,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(requested_item_id) WHERE closed_at IS NULL DO NOTHING RETURNING *`, [row.request_id,row.requested_item_id,row.institute_id,row.department_id,row.assigned_buyer_id,row.case_status,row.activity_coverage,row.complexity_coverage,row.commercial_coverage,row.cycle_time_coverage,row.logistics_coverage,row.created_by])).rows[0] || null,
    provisionPriorityProfile: row => provisionNeutralPriorityProfile({ client: database,
      procurementCaseId: row.procurement_case_id, instituteId: row.institute_id, departmentId: row.department_id }),
    insertActivity: async row => (await q(`INSERT INTO procurement_case_activities(procurement_case_id,activity_type,activity_at,actor_id,supplier_id,related_entity_type,related_entity_id,source,idempotency_key,metadata,notes) VALUES($1,$2,COALESCE($3,NOW()),$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`, [row.procurement_case_id,row.activity_type,row.activity_at,row.actor_id,row.supplier_id,row.related_entity_type,row.related_entity_id,row.source,row.idempotency_key,JSON.stringify(row.metadata||{}),row.notes])).rows[0],
    findActiveCasesByRequestedItems: async ids => ids.length ? (await q('SELECT * FROM procurement_cases WHERE requested_item_id = ANY($1::int[]) AND closed_at IS NULL', [ids])).rows : [],
    insertActivityIdempotent: async row => (await q(`INSERT INTO procurement_case_activities(procurement_case_id,activity_type,activity_at,actor_id,supplier_id,related_entity_type,related_entity_id,source,idempotency_key,metadata) VALUES($1,$2,COALESCE($3,NOW()),$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING *`, [row.procurement_case_id,row.activity_type,row.activity_at,row.actor_id,row.supplier_id,row.related_entity_type,row.related_entity_id,row.source,row.idempotency_key,JSON.stringify(row.metadata||{})])).rows[0] || null,
    updateCaseProjection: async (id,row) => (await q(`UPDATE procurement_cases SET
      case_status=$2,
      pending_root_cause=$3,
      sourcing_started_at=CASE WHEN $4='sourcing_started_at' THEN COALESCE(sourcing_started_at,$5::timestamptz) ELSE sourcing_started_at END,
      commercially_ready_at=CASE WHEN $4='commercially_ready_at' THEN COALESCE(commercially_ready_at,$5::timestamptz) ELSE commercially_ready_at END,
      updated_by=COALESCE($6,updated_by),updated_at=NOW()
      WHERE id=$1 AND array_position(ARRAY['APPROVAL_PENDING','ITEM_IDENTITY_RESOLUTION','READY_FOR_SOURCING','SOURCING','AWAITING_QUOTATION','TECHNICAL_EVALUATION','COMMERCIAL_EVALUATION','AWARDED','PO_PROCESSING','SUPPLIER_FULFILLMENT','LOGISTICS','DELIVERED','CLOSED']::text[],case_status)
        <= array_position(ARRAY['APPROVAL_PENDING','ITEM_IDENTITY_RESOLUTION','READY_FOR_SOURCING','SOURCING','AWAITING_QUOTATION','TECHNICAL_EVALUATION','COMMERCIAL_EVALUATION','AWARDED','PO_PROCESSING','SUPPLIER_FULFILLMENT','LOGISTICS','DELIVERED','CLOSED']::text[],$2)
      RETURNING *`,[id,row.case_status,row.pending_root_cause,row.timestamp||null,row.occurred_at||null,row.updated_by||null])).rows[0] || null,
    lockCase: async id => (await q('SELECT * FROM procurement_cases WHERE id=$1 FOR UPDATE',[id])).rows[0],
    replaceFactorSnapshot: async (id,factors,version,actor,reason) => { await q('DELETE FROM procurement_case_complexity_factors WHERE procurement_case_id=$1',[id]); for(const f of factors) await q('INSERT INTO procurement_case_complexity_factors(procurement_case_id,model_version,factor_code,factor_value,points,assessed_by,assessment_reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,version,f.factor,f.value,f.points,actor,reason]); },
    updateComplexity: async (id,row) => (await q(`UPDATE procurement_cases SET complexity_score=$2,complexity_class=$3,workload_units=$4,complexity_model_version=$5,workload_model_version=$6,complexity_coverage=$7,updated_by=$8,updated_at=NOW() WHERE id=$1 RETURNING *`,[id,row.complexity_score,row.complexity_class,row.workload_units,row.complexity_model_version,row.workload_model_version,row.complexity_coverage,row.updated_by])).rows[0],
    writeAudit: async row => require('../services/auditService').writeAuditEvent({client:database,entityType:row.entity_type,entityId:row.entity_id,action:row.action,actorUserId:row.actor_user_id,reason:row.reason,metadata:row.metadata}),
    insertValueEvent: async row => (await q(`INSERT INTO procurement_value_events(procurement_case_id,value_type,baseline_type,baseline_amount,final_amount,verified_value,currency,evidence_entity_type,evidence_entity_id,notes,entered_by,verified_by,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,[row.procurementCaseId,row.valueType,row.baselineType,row.baselineAmount||null,row.finalAmount||null,row.verifiedValue,row.currency,row.evidenceEntityType,row.evidenceEntityId,row.notes||null,row.enteredBy,row.verifiedBy])).rows[0],
  };
  return repository;
}
module.exports = { createProcurementPerformanceRepository, ...createProcurementPerformanceRepository() };