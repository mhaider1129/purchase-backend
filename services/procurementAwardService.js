'use strict';
const { loadAndAssertSupplierEligible } = require('./supplierEligibilityService');
const defaultAudit = require('./auditService');
const defaultOutbox = require('./notificationOutboxService');
const { createHash } = require('crypto');
const { addDecimal, compareDecimal } = require('./purchaseOrderTotalsService');

const fingerprintAward = (input) => createHash('sha256').update(JSON.stringify([
  String(input.request_item_id), String(input.supplier_id), String(input.awarded_quantity),
  String(input.unit_price), String(input.currency).toUpperCase(), String(input.source_type),
  input.source_id == null ? null : String(input.source_id),
  input.approved_product_id == null ? null : String(input.approved_product_id),
  input.supplier_catalog_item_id == null ? null : String(input.supplier_catalog_item_id),
])).digest('hex');

const createAward = async ({ repository, requestItem, supplier, input, actor, auditService = defaultAudit, outbox = defaultOutbox }) => {
  if (Boolean(input.approved_product_id) !== Boolean(input.supplier_catalog_item_id)) throw Object.assign(new Error('Award Product and Supplier Catalog identities must be supplied together'), { code: 'AWARD_CATALOG_IDENTITY_REQUIRED' });
  if (compareDecimal(input.awarded_quantity, 0) <= 0) throw Object.assign(new Error('Award quantity must be positive'), { code: 'INVALID_AWARD_QUANTITY' });
  const fingerprint = fingerprintAward({ ...input, request_item_id: requestItem.id, supplier_id: supplier.id });
  return repository.withTransaction(async (tx) => {
    const locked = await tx.lockRequestItem(requestItem.id);
    if (!locked) throw Object.assign(new Error('Requested item not found'), { code: 'REQUEST_ITEM_NOT_FOUND', status: 404 });
    await loadAndAssertSupplierEligible(tx, supplier.id);
    const existing = await tx.findByIdempotencyKey(input.idempotency_key);
    if (existing) {
      if (existing.payload_fingerprint !== fingerprint) throw Object.assign(new Error('Idempotency key was used with a different award payload'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
      return existing;
    }
    const awarded = await tx.sumActiveAwards(locked.id);
    if (compareDecimal(addDecimal(awarded, input.awarded_quantity), locked.approved_quantity ?? locked.quantity) > 0) throw Object.assign(new Error('Award exceeds approved request quantity'), { code: 'AWARD_QUANTITY_EXCEEDED' });
    const award = await tx.insert({ request_id: locked.request_id, request_item_id: locked.id, supplier_id: supplier.id, approved_product_id: input.approved_product_id || null, supplier_catalog_item_id: input.supplier_catalog_item_id || null, awarded_quantity: String(input.awarded_quantity), unit_price: String(input.unit_price), currency: String(input.currency).toUpperCase(), source_type: input.source_type, source_id: input.source_id || null, selection_reason: input.selection_reason, actor_id: actor.id, idempotency_key: input.idempotency_key, payload_fingerprint: fingerprint });
    await auditService.writeAuditEvent({ client: tx.client, entityType: 'procurement_award', entityId: award.id, requestId: locked.request_id, action: 'AWARD_CREATED', actorUserId: actor.id, metadata: { request_item_id: locked.id, supplier_id: supplier.id } });
    await outbox.enqueueNotification(tx.client, { type: 'AWARD_CREATED', entityType: 'procurement_award', entityId: award.id, payload: { award_id: award.id, request_id: locked.request_id }, idempotencyKey: `award-created:${award.id}` });
    return award;
  });
};

module.exports = { createAward, fingerprintAward };