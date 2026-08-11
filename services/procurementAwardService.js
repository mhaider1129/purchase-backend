'use strict';
const { assertSupplierEligible } = require('./supplierEligibilityService');
const createAward = async ({ repository, requestItem, supplier, input, actor }) => {
  assertSupplierEligible(supplier, { categoryId: requestItem.category_id, contractId: input.contract_id });
  const quantity = Number(input.awarded_quantity);
  if (!(quantity > 0)) throw Object.assign(new Error('Award quantity must be positive'), { code: 'INVALID_AWARD_QUANTITY' });
  return repository.lockRequestItem(requestItem.id, async (locked) => {
    const existing = await repository.findByIdempotencyKey(input.idempotency_key);
    if (existing) return existing;
    const awarded = Number(await repository.sumActiveAwards(locked.id));
    if (awarded + quantity > Number(locked.approved_quantity ?? locked.quantity)) throw Object.assign(new Error('Award exceeds approved request quantity'), { code: 'AWARD_QUANTITY_EXCEEDED' });
    return repository.insert({ request_id: locked.request_id, request_item_id: locked.id, supplier_id: supplier.id, awarded_quantity: String(input.awarded_quantity), unit_price: String(input.unit_price), currency: input.currency, tax_basis: input.tax_basis || null, discount_basis: input.discount_basis || null, source_type: input.source_type, source_id: input.source_id || null, selection_reason: input.selection_reason, actor_id: actor.id, idempotency_key: input.idempotency_key });
  });
};
module.exports = { createAward };