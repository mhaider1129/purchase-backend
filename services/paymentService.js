'use strict';
const postPayment = async ({ repository, invoiceId, amount, idempotencyKey, actorId }) => repository.lockInvoice(invoiceId, async (invoice) => {
  const retry = await repository.findByIdempotencyKey(idempotencyKey); if (retry) return retry;
  if (!['APPROVED_FOR_PAYMENT', 'PARTIALLY_PAID'].includes(invoice.status)) throw Object.assign(new Error('Invoice is not payable'), { code: 'INVOICE_NOT_PAYABLE' });
  const remaining = Number(invoice.approved_payable_amount) - Number(await repository.sumPostedPayments(invoiceId));
  if (!(Number(amount) > 0) || Number(amount) > remaining) throw Object.assign(new Error('Payment exceeds payable amount'), { code: 'PAYMENT_AMOUNT_EXCEEDED' });
  const payment = await repository.insert({ invoice_id: invoiceId, amount: String(amount), idempotency_key: idempotencyKey, actor_id: actorId, status: 'POSTED' });
  await repository.setInvoiceStatus(invoiceId, Number(amount) === remaining ? 'PAID' : 'PARTIALLY_PAID'); return payment;
});
module.exports = { postPayment };