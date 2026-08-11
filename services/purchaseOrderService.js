'use strict';
const { assertSupplierEligible } = require('./supplierEligibilityService');
const { calculatePurchaseOrderTotals } = require('./purchaseOrderTotalsService');
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
module.exports = { releasePurchaseOrder };