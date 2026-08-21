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
      evidence_coverage: 'FULL', created_by: actorId,
    });
    await tx.insertActivity({ procurement_case_id: created.id, activity_type: 'CASE_CREATED',
      activity_at: created.opened_at, actor_id: actorId, related_entity_type: 'requested_item',
      related_entity_id: requestedItem.id, source: 'SYSTEM', idempotency_key: `case-created:${created.id}` });
    return created;
  });
}

function instituteScope(user, requestedInstituteId) {
  if (!user?.hasPermission?.('procurement-performance.view')) return false;
  const permitted = user.data_scopes?.institute_ids;
  if (Array.isArray(permitted)) return permitted.map(String).includes(String(requestedInstituteId));
  return String(user.institute_id) === String(requestedInstituteId);
}

module.exports = { ensureCaseForRequestedItem, instituteScope, ELIGIBLE_REQUEST_STATES };