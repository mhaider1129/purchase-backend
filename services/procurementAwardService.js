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
  if (compareDecimal(input.awarded_quantity, 0) <= 0) throw Object.assign(new Error('Award quantity must be positive'), { code: 'INVALID_AWARD_QUANTITY' });
  const fingerprint = fingerprintAward({ ...input, request_item_id: requestItem.id, supplier_id: supplier.id });
  return repository.withTransaction(async (tx) => {
    const locked = await tx.lockRequestItem(requestItem.id);
    if (!locked) throw Object.assign(new Error('Requested item not found'), { code: 'REQUEST_ITEM_NOT_FOUND', status: 404 });
    const governedPhysical = locked.request_mode && !['service','approved_free_text_exception'].includes(locked.request_mode);
    if (governedPhysical && (!input.approved_product_id || !input.supplier_catalog_item_id)) throw Object.assign(new Error('Governed physical awards require Product and Supplier Catalog identities'), { code: 'AWARD_CATALOG_IDENTITY_REQUIRED', status: 409 });
    if (locked.request_mode === 'approved_free_text_exception' && locked.catalog_status !== 'approved_exception') throw Object.assign(new Error('Free-text procurement requires an approved exception identity state'), { code: 'FREE_TEXT_EXCEPTION_APPROVAL_REQUIRED', status: 409 });
    if (governedPhysical && typeof tx.loadAwardCatalogIdentity !== 'function') throw Object.assign(new Error('Award catalog authority is not configured'),{code:'AWARD_CATALOG_AUTHORITY_REQUIRED',status:500});
    if (governedPhysical) {
      const x=await tx.loadAwardCatalogIdentity(input.approved_product_id,input.supplier_catalog_item_id);
      const valid=x&&x.catalog_active&&Number(x.supplier_id)===Number(supplier.id)&&Number(x.approved_product_id)===Number(input.approved_product_id)&&x.approval_status==='approved'&&x.product_active&&x.lifecycle_status==='active'&&x.generic_active&&Number(x.generic_item_id)===Number(locked.generic_item_id)&&x.purchasing_uom_id&&x.uom_active&&compareDecimal(x.conversion_factor,0)>0&&compareDecimal(x.package_quantity,0)>0;
      if(!valid) throw Object.assign(new Error('Award Product/Catalog relationship or UOM authority is invalid'),{code:'AWARD_CATALOG_IDENTITY_INVALID',status:409});
      if(locked.mandatory_product_id&&Number(locked.mandatory_product_id)!==Number(input.approved_product_id)) throw Object.assign(new Error('Award violates mandatory Product restriction'),{code:'AWARD_MANDATORY_PRODUCT_MISMATCH',status:409});
    }
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
    await outbox.enqueueNotification(tx.client, { type: 'AWARD_CREATED', entityType: 'procurement_award', entityId: award.id, payload: { award_id: award.id, request_id: locked.request_id, requestedItemIds: [locked.id], supplierId: supplier.id, actorId: actor.id }, idempotencyKey: `award-created:${award.id}` });
    return award;
  });
};

module.exports = { createAward, fingerprintAward };