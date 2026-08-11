'use strict';
const commitPurchaseOrder = async ({ repository, purchaseOrder, idempotencyKey }) => repository.lockBudget(purchaseOrder.budget_envelope_id, async (budget) => {
  const existing = await repository.findByIdempotencyKey(idempotencyKey); if (existing) return existing;
  const available = Number(budget.allocated_amount) - Number(budget.actual_amount) - Number(budget.committed_amount);
  if (Number(purchaseOrder.grand_total) > available) throw Object.assign(new Error('Insufficient available budget'), { code: 'BUDGET_INSUFFICIENT' });
  return repository.insert({ purchase_order_id: purchaseOrder.id, budget_envelope_id: budget.id, amount: purchaseOrder.grand_total, currency: purchaseOrder.currency, state: 'COMMITTED', idempotency_key: idempotencyKey });
});
module.exports = { commitPurchaseOrder };