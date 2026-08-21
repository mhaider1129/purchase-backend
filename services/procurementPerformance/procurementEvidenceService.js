'use strict';

const ACTIVITY_MAP = Object.freeze({
  RFX_CREATED: 'RFQ_CREATED', RFX_SUPPLIER_INVITED: 'SUPPLIER_CONTACTED',
  RFX_RESPONSE_SUBMITTED: 'QUOTATION_RECEIVED', TECHNICAL_EVALUATION_REQUESTED: 'TECHNICAL_EVALUATION_REQUESTED',
  TECHNICAL_EVALUATION_COMPLETED: 'TECHNICAL_EVALUATION_COMPLETED', AWARD_CREATED: 'AWARD_CREATED',
  PO_CREATED: 'PO_CREATED', PO_ISSUED: 'PO_ISSUED', GOODS_RECEIPT_POSTED: 'GOODS_RECEIPT',
});

const PROJECTION_MAP = Object.freeze({
  RFX_CREATED: { case_status: 'SOURCING', pending_root_cause: 'AWAITING_SUPPLIER_QUOTATION', timestamp: 'sourcing_started_at' },
  RFX_RESPONSE_SUBMITTED: { case_status: 'COMMERCIAL_EVALUATION', pending_root_cause: null },
  AWARD_CREATED: { case_status: 'AWARDED', pending_root_cause: null, timestamp: 'commercially_ready_at' },
  PO_CREATED: { case_status: 'PO_PROCESSING', pending_root_cause: null },
  PO_ISSUED: { case_status: 'SUPPLIER_FULFILLMENT', pending_root_cause: null },
});

function projectionForEvent(event) {
  if (event.type !== 'GOODS_RECEIPT_POSTED') return PROJECTION_MAP[event.type] || null;
  // A receipt is delivery evidence only when the producer's authoritative PO totals say
  // the requirement is complete. A partial receipt remains supplier fulfilment.
  return event.receiptComplete === true || event.purchaseOrderStatus === 'PO_DELIVERED'
    ? { case_status: 'DELIVERED', pending_root_cause: null }
    : { case_status: 'SUPPLIER_FULFILLMENT', pending_root_cause: null };
}

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
    const projection = projectionForEvent(event);
    if (projection) await repository.updateCaseProjection(procurementCase.id, {
      ...projection,
      occurred_at: event.occurredAt,
      updated_by: event.actorId || null,
    });
  }
  return rows.filter(Boolean);
}

module.exports = { ACTIVITY_MAP, PROJECTION_MAP, projectionForEvent, captureBusinessEvent };