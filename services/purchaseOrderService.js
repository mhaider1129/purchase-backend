'use strict';
const { assertSupplierEligible } = require('./supplierEligibilityService');
const { calculatePurchaseOrderTotals, compareDecimal } = require('./purchaseOrderTotalsService');
const createPurchaseOrderFromAwards = async ({ repository, awardIds, quantities = {}, actor, input = {} }) => repository.withTransaction(async (tx) => {
  if (!Array.isArray(awardIds) || !awardIds.length) throw Object.assign(new Error('At least one award is required'), { code: 'AWARD_REQUIRED' });
  const awards = await tx.lockAwards(awardIds);
  if (awards.length !== awardIds.length || awards.some((award) => award.status !== 'ACTIVE')) throw Object.assign(new Error('An active award was not found'), { code: 'AWARD_NOT_FOUND' });
  const supplierId = String(awards[0].supplier_id);
  if (awards.some((award) => String(award.supplier_id) !== supplierId) || (input.supplier_id && String(input.supplier_id) !== supplierId)) throw Object.assign(new Error('PO supplier must match every award supplier'), { code: 'PO_SUPPLIER_MISMATCH' });
  const requestId = String(awards[0].request_id);
  if (awards.some((award) => String(award.request_id) !== requestId)) throw Object.assign(new Error('Awards on a PO must belong to one request'), { code: 'PO_REQUEST_MISMATCH' });
  const currencies = new Set(awards.map((award) => String(award.currency).toUpperCase()));
  if (currencies.size !== 1) throw Object.assign(new Error('PO awards must use one currency'), { code: 'PO_CURRENCY_MISMATCH' });
  const conversions = new Map();
  for (const award of awards) {
    const conversion = await tx.getAwardConversion(award.id);
    const quantity = String(quantities[award.id] ?? award.awarded_quantity);
    if (compareDecimal(quantity, 0) <= 0 || compareDecimal(quantity, conversion.remaining_quantity) > 0) throw Object.assign(new Error('PO quantity exceeds remaining award quantity'), { code: 'AWARD_QUANTITY_EXCEEDED' });
    conversions.set(String(award.id), quantity);
  }
  const header = await tx.insertHeader({ ...input, request_id: awards[0].request_id, supplier_id: awards[0].supplier_id, currency: awards[0].currency, status: 'PO_DRAFT', created_by: actor.id });
  const lines = [];
  for (const award of awards) lines.push(await tx.insertLine({ purchase_order_id: header.id, request_id: award.request_id, request_item_id: award.request_item_id, requested_item_id: award.request_item_id, award_id: award.id, quantity: conversions.get(String(award.id)), unit_price: award.unit_price, price_source_type: award.source_type, price_source_id: award.source_id || award.id, line_type: award.line_type }));
  return { ...header, lines };
});
const releasePurchaseOrder = async ({ withTransaction, repository, supplier, purchaseOrder, budgetService, auditService, outbox, actor }) => withTransaction(async (client) => {
  if (purchaseOrder.status === 'RELEASED') return purchaseOrder;
  if (purchaseOrder.status !== 'APPROVED') throw Object.assign(new Error('PO must be approved before release'), { code: 'INVALID_PO_TRANSITION' });
  assertSupplierEligible(supplier);
  for (const line of purchaseOrder.lines) if (!line.award_id || !line.request_id || !line.request_item_id || !line.price_source_type || !line.price_source_id) throw Object.assign(new Error('PO line traceability and price provenance are required'), { code: 'PO_LINE_TRACE_REQUIRED' });
  const totals = calculatePurchaseOrderTotals({ lines: purchaseOrder.lines, freight: purchaseOrder.freight, charges: purchaseOrder.charges });
  const commitment = await budgetService({ repository: repository.forClient(client), purchaseOrder: { ...purchaseOrder, grand_total: totals.grand_total }, idempotencyKey: `po-release:${purchaseOrder.id}` });
  const released = await repository.forClient(client).release(purchaseOrder.id, totals);
  await auditService.record(client, { action: 'PO_RELEASED', entity_type: 'purchase_order', entity_id: purchaseOrder.id, actor_id: actor.id, metadata: { commitment_id: commitment.id } });
  await outbox.enqueue(client, { event_type: 'PO_RELEASED', aggregate_type: 'purchase_order', aggregate_id: purchaseOrder.id, payload: { purchase_order_id: purchaseOrder.id } });
  return released;
});
module.exports = { createPurchaseOrderFromAwards, releasePurchaseOrder };