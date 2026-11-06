'use strict';

const ACTIVITY_MAP = Object.freeze({
  RFX_CREATED: 'RFQ_CREATED', RFX_SUPPLIER_INVITED: 'SUPPLIER_CONTACTED',
  RFX_RESPONSE_SUBMITTED: 'QUOTATION_RECEIVED', TECHNICAL_EVALUATION_REQUESTED: 'TECHNICAL_EVALUATION_REQUESTED',
  TECHNICAL_EVALUATION_COMPLETED: 'TECHNICAL_EVALUATION_COMPLETED', AWARD_CREATED: 'AWARD_CREATED',
  PO_CREATED: 'PO_CREATED', PO_ISSUED: 'PO_ISSUED', GOODS_RECEIPT_POSTED: 'GOODS_RECEIPT', GOODS_RECEIPT_ACCEPTANCE_APPLIED:'GOODS_RECEIPT', GOODS_RECEIPT_STOCK_STATUS_CHANGED:'GOODS_RECEIPT', WAREHOUSE_FULFILLMENT_APPLIED:'GOODS_RECEIPT',
});

const PROJECTION_MAP = Object.freeze({
  RFX_CREATED: { case_status: 'SOURCING', pending_root_cause: 'AWAITING_SUPPLIER_QUOTATION', timestamp: 'sourcing_started_at' },
  RFX_RESPONSE_SUBMITTED: { case_status: 'COMMERCIAL_EVALUATION', pending_root_cause: null },
  AWARD_CREATED: { case_status: 'AWARDED', pending_root_cause: null, timestamp: 'commercially_ready_at' },
  PO_CREATED: { case_status: 'PO_PROCESSING', pending_root_cause: null },
  PO_ISSUED: { case_status: 'SUPPLIER_FULFILLMENT', pending_root_cause: null },
});

function projectionForEvent(event) {
  if (!['GOODS_RECEIPT_POSTED','GOODS_RECEIPT_ACCEPTANCE_APPLIED','GOODS_RECEIPT_STOCK_STATUS_CHANGED','WAREHOUSE_FULFILLMENT_APPLIED'].includes(event.type)) return PROJECTION_MAP[event.type] || null;
  // Re-read accepted quantities across every PO for the case item; one delivered PO
  // or a producer status flag cannot establish acceptance of the entire demand.
  return event.completion?.approved_demand === true && event.completion?.terminal !== true && event.itemCompletion?.receipt_complete === true && event.itemCompletion?.evidence_conflict !== true
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
    let currentEvent=event;
    if(['GOODS_RECEIPT_POSTED','GOODS_RECEIPT_ACCEPTANCE_APPLIED','GOODS_RECEIPT_STOCK_STATUS_CHANGED','WAREHOUSE_FULFILLMENT_APPLIED'].includes(event.type)) {
      if(!repository.loadCaseCompletion)throw new Error('Authoritative case completion projection unavailable');
      const completion=await repository.loadCaseCompletion(procurementCase.id);
      if(!completion)throw new Error('Procurement case completion ancestry is inconsistent');
      currentEvent={...event,completion,itemCompletion:completion.items.find(line=>String(line.requested_item_id)===String(procurementCase.requested_item_id))};
    }
    const projection = currentEvent.completion?.terminal ? null : projectionForEvent(currentEvent);
    if (projection) await repository.updateCaseProjection(procurementCase.id, {
      ...projection,
      occurred_at: event.occurredAt,
      updated_by: event.actorId || null,
    });
  }
  return rows.filter(Boolean);
}

module.exports = { ACTIVITY_MAP, PROJECTION_MAP, projectionForEvent, captureBusinessEvent };