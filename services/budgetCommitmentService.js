'use strict';
const { addDecimal, subtractDecimal, compareDecimal } = require('./purchaseOrderTotalsService');
const commitPurchaseOrder = async ({ repository, purchaseOrder, idempotencyKey }) => repository.lockBudget(purchaseOrder.budget_envelope_id, async (budget) => {
  const existing = await repository.findByIdempotencyKey(idempotencyKey); if (existing) return existing;
  const committed = await repository.sumActiveCommitments(budget.id);
  const available = subtractDecimal(budget.allocated_amount, budget.consumed_amount, committed);
  if (compareDecimal(purchaseOrder.grand_total, available) > 0) throw Object.assign(new Error('Insufficient available budget'), { code: 'BUDGET_INSUFFICIENT' });
  return repository.insert({ purchase_order_id: purchaseOrder.id, budget_envelope_id: budget.id, amount: purchaseOrder.grand_total, currency: purchaseOrder.currency, state: 'COMMITTED', idempotency_key: idempotencyKey });
});
module.exports = { commitPurchaseOrder };