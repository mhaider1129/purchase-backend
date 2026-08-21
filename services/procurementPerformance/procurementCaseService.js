'use strict';

const ELIGIBLE_REQUEST_STATES = new Set(['APPROVED', 'FULLY_APPROVED', 'READY_FOR_PROCUREMENT']);

async function ensureCaseForRequestedItem({ repository, requestedItem, actorId }) {
  if (!requestedItem?.id || !requestedItem.request_id) throw new TypeError('Requested item and request are required');
  if (!ELIGIBLE_REQUEST_STATES.has(String(requestedItem.request_status || '').toUpperCase())) return null;
  return repository.withTransaction(async tx => {
    const existing = await tx.findActiveByRequestedItem(requestedItem.id);
    if (existing) return existing;
    const created = await tx.insertCase({
      request_id: requestedItem.request_id, requested_item_id: requestedItem.id,
      institute_id: requestedItem.institute_id, department_id: requestedItem.department_id,
      assigned_buyer_id: requestedItem.assigned_buyer_id || null,
      case_status: requestedItem.generic_item_id ? 'READY_FOR_SOURCING' : 'ITEM_IDENTITY_RESOLUTION',
      activity_coverage: 'PARTIAL', complexity_coverage: 'MISSING',
      commercial_coverage: 'MISSING', cycle_time_coverage: 'PARTIAL',
      logistics_coverage: 'MISSING', created_by: actorId,
    });
    await tx.insertActivity({ procurement_case_id: created.id, activity_type: 'CASE_CREATED',
      activity_at: created.opened_at, actor_id: actorId, related_entity_type: 'requested_item',
      related_entity_id: requestedItem.id, source: 'SYSTEM', idempotency_key: `case-created:${created.id}` });
    return created;
  });
}

function deriveProcurementCaseStatus(evidence = {}) {
  if (evidence.completed || evidence.closedAt) return 'CLOSED';
  if (evidence.goodsDelivered || evidence.goodsReceiptComplete) return 'DELIVERED';
  if (evidence.shipment) return 'LOGISTICS';
  if (evidence.poIssued) return 'SUPPLIER_FULFILLMENT';
  if (evidence.po) return 'PO_PROCESSING';
  if (evidence.award) return 'AWARDED';
  if (evidence.commercialEvaluation) return 'COMMERCIAL_EVALUATION';
  if (evidence.technicalEvaluation) return 'TECHNICAL_EVALUATION';
  if (evidence.rfxAwaitingQuotation) return 'AWAITING_QUOTATION';
  if (evidence.rfx) return 'SOURCING';
  if (!evidence.identityResolved) return 'ITEM_IDENTITY_RESOLUTION';
  return evidence.approved ? 'READY_FOR_SOURCING' : 'APPROVAL_PENDING';
}

function instituteScope(user, requestedInstituteId) {
  if (!user?.hasPermission?.('procurement-performance.view')) return false;
  const permitted = user.data_scopes?.institute_ids;
  if (Array.isArray(permitted)) return permitted.map(String).includes(String(requestedInstituteId));
  return String(user.institute_id) === String(requestedInstituteId);
}

module.exports = { ensureCaseForRequestedItem, deriveProcurementCaseStatus, instituteScope, ELIGIBLE_REQUEST_STATES };