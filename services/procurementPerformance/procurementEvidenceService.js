'use strict';

const ACTIVITY_MAP = Object.freeze({
  RFX_CREATED: 'RFQ_CREATED', RFX_SUPPLIER_INVITED: 'SUPPLIER_CONTACTED',
  RFX_RESPONSE_SUBMITTED: 'QUOTATION_RECEIVED', TECHNICAL_EVALUATION_REQUESTED: 'TECHNICAL_EVALUATION_REQUESTED',
  TECHNICAL_EVALUATION_COMPLETED: 'TECHNICAL_EVALUATION_COMPLETED', AWARD_CREATED: 'AWARD_CREATED',
  PO_CREATED: 'PO_CREATED', PO_ISSUED: 'PO_ISSUED', GOODS_RECEIPT_POSTED: 'GOODS_RECEIPT',
});

/** Outbox consumer. Core transactions already atomically publish these events; reporting retries independently. */
async function captureBusinessEvent({ repository, event }) {
  const activityType = ACTIVITY_MAP[event.type];
  if (!activityType) return [];
  const itemIds = [...new Set((event.requestedItemIds || []).map(String))];
  const cases = await repository.findActiveCasesByRequestedItems(itemIds);
  const rows = [];
  for (const procurementCase of cases) {
    const key = `${activityType}:${event.entityType}:${event.entityId}:case:${procurementCase.id}`;
    rows.push(await repository.insertActivityIdempotent({ procurement_case_id: procurementCase.id,
      activity_type: activityType, activity_at: event.occurredAt, actor_id: event.actorId || null,
      supplier_id: event.supplierId || null, related_entity_type: event.entityType,
      related_entity_id: String(event.entityId), source: 'OUTBOX', idempotency_key: key }));
  }
  return rows.filter(Boolean);
}

module.exports = { ACTIVITY_MAP, captureBusinessEvent };