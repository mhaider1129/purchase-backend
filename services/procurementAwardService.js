'use strict';
const { assertSupplierEligible } = require('./supplierEligibilityService');
const { createHash } = require('crypto');
const { addDecimal, compareDecimal } = require('./purchaseOrderTotalsService');
const fingerprintAward = (input) => createHash('sha256').update(JSON.stringify([
  String(input.request_item_id), String(input.supplier_id), String(input.awarded_quantity),
  String(input.unit_price), String(input.currency).toUpperCase(), String(input.source_type),
  input.source_id == null ? null : String(input.source_id),
])).digest('hex');
const createAward = async ({ repository, requestItem, supplier, input, actor }) => {
  assertSupplierEligible(supplier, { categoryId: requestItem.category_id, contractId: input.contract_id });
  if (compareDecimal(input.awarded_quantity, 0) <= 0) throw Object.assign(new Error('Award quantity must be positive'), { code: 'INVALID_AWARD_QUANTITY' });
  const fingerprint = fingerprintAward({ ...input, request_item_id: requestItem.id, supplier_id: supplier.id });
  return repository.lockRequestItem(requestItem.id, async (locked) => {
    const existing = await repository.findByIdempotencyKey(input.idempotency_key);
    if (existing) {
      if (existing.payload_fingerprint !== fingerprint) throw Object.assign(new Error('Idempotency key was used with a different award payload'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
      return existing;
    }
    const awarded = await repository.sumActiveAwards(locked.id);
    if (compareDecimal(addDecimal(awarded, input.awarded_quantity), locked.approved_quantity ?? locked.quantity) > 0) throw Object.assign(new Error('Award exceeds approved request quantity'), { code: 'AWARD_QUANTITY_EXCEEDED' });
    return repository.insert({ request_id: locked.request_id, request_item_id: locked.id, supplier_id: supplier.id, awarded_quantity: String(input.awarded_quantity), unit_price: String(input.unit_price), currency: input.currency, tax_basis: input.tax_basis || null, discount_basis: input.discount_basis || null, source_type: input.source_type, source_id: input.source_id || null, selection_reason: input.selection_reason, actor_id: actor.id, idempotency_key: input.idempotency_key, payload_fingerprint: fingerprint });
  });
};
module.exports = { createAward, fingerprintAward };