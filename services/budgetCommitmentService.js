const {authorizeCommand}=require('./p2pAuthorization');
'use strict';
const { subtractDecimal, compareDecimal } = require('./purchaseOrderTotalsService');

const commitPurchaseOrder = async ({ repository, purchaseOrder, idempotencyKey, actor }) => {
  actor=(await authorizeCommand(repository,actor,'procure-to-pay.purchase-orders.manage',{purchaseOrderId:purchaseOrder.id})).actor;
  const existing = await repository.findCommitmentByIdempotency(idempotencyKey);
  if (existing) {await authorizeCommand(repository,actor,'procure-to-pay.purchase-orders.manage',{requestId:purchaseOrder.request_id,purchaseOrderId:purchaseOrder.id,commitmentId:existing.id});return existing;}
  const envelope = await repository.resolveBudgetEnvelope(purchaseOrder);
  if (!envelope) throw Object.assign(new Error('No valid budget envelope exists for this purchase order'), { code: 'BUDGET_ENVELOPE_NOT_FOUND', statusCode: 409 });
  await authorizeCommand(repository,actor,'procure-to-pay.purchase-orders.manage',{requestId:purchaseOrder.request_id,budgetId:envelope.id});
  const budget = await repository.lockBudgetEnvelope(envelope.id);
  const committed = await repository.sumActiveEncumbrances(budget.id);
  const available = subtractDecimal(budget.allocated_amount, budget.consumed_amount || '0', committed);
  if (compareDecimal(purchaseOrder.grand_total, available) > 0) throw Object.assign(new Error('Insufficient available budget'), { code: 'BUDGET_INSUFFICIENT', statusCode: 409 });
  return repository.insertEncumbrance({ request_id: purchaseOrder.request_id, budget_envelope_id: budget.id, purchase_order_id: purchaseOrder.id, amount: purchaseOrder.grand_total, currency: purchaseOrder.currency, idempotency_key: idempotencyKey, actor_id: actor.id });
};
module.exports = { commitPurchaseOrder };