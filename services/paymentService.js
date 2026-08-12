'use strict';
const { subtractDecimal, compareDecimal } = require('./purchaseOrderTotalsService');
const postPayment = async ({ repository, invoiceId, amount, idempotencyKey, actorId }) => repository.lockInvoice(invoiceId, async (invoice) => {
  if (!idempotencyKey) throw Object.assign(new Error('Payment idempotency key is required'), { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  const retry = await repository.findByIdempotencyKey(idempotencyKey); if (retry) return retry;
  if (!['APPROVED_FOR_PAYMENT', 'PARTIALLY_PAID'].includes(invoice.status)) throw Object.assign(new Error('Invoice is not payable'), { code: 'INVOICE_NOT_PAYABLE' });
  const remaining = subtractDecimal(invoice.approved_payable_amount, await repository.sumPostedPayments(invoiceId));
  if (compareDecimal(amount, 0) <= 0 || compareDecimal(amount, remaining) > 0) throw Object.assign(new Error('Payment exceeds payable amount'), { code: 'PAYMENT_AMOUNT_EXCEEDED' });
  const payment = await repository.insert({ invoice_id: invoiceId, amount: String(amount), idempotency_key: idempotencyKey, actor_id: actorId, status: 'POSTED' });
  await repository.setInvoiceStatus(invoiceId, compareDecimal(amount, remaining) === 0 ? 'PAID' : 'PARTIALLY_PAID'); return payment;
});
module.exports = { postPayment };