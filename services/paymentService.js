'use strict';

const crypto = require('crypto');
const { compareDecimal, subtractDecimal } = require('./purchaseOrderTotalsService');
const defaultAudit = require('./auditService');
const defaultOutbox = require('./notificationOutboxService');

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const paymentFingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Compatibility adapter for pre-cutover internal callers. Live HTTP routes use
// the payable-oriented transaction below; this adapter can be removed once all
// tests/import jobs have moved to AP payable IDs.
const postLegacyInvoicePayment = ({ repository, invoiceId, amount, idempotencyKey, actorId }) => repository.lockInvoice(invoiceId, async (invoice) => {
  if (!String(idempotencyKey || '').trim()) throw fail('Payment idempotency key is required', 'IDEMPOTENCY_KEY_REQUIRED');
  const retry = await repository.findByIdempotencyKey(idempotencyKey);
  if (retry) return retry;
  if (!['APPROVED_FOR_PAYMENT', 'PARTIALLY_PAID'].includes(invoice.status)) throw fail('Invoice is not payable', 'INVOICE_NOT_PAYABLE', 409);
  const remaining = subtractDecimal(invoice.approved_payable_amount, await repository.sumPostedPayments(invoiceId));
  if (compareDecimal(amount, '0') <= 0 || compareDecimal(amount, remaining) > 0) throw fail('Payment exceeds payable amount', 'PAYMENT_AMOUNT_EXCEEDED', 409);
  const payment = await repository.insert({ invoice_id: invoiceId, amount: String(amount), idempotency_key: idempotencyKey, actor_id: actorId, status: 'POSTED' });
  await repository.setInvoiceStatus(invoiceId, compareDecimal(amount, remaining) === 0 ? 'PAID' : 'PARTIALLY_PAID');
  return payment;
});

const postPayment = ({ repository, payableId, invoiceId, amount, currency, paymentReference, paymentMethod, idempotencyKey, actor, actorId, auditService = defaultAudit, outbox = defaultOutbox }) => {
  if (!repository.withTransaction && payableId == null) return postLegacyInvoicePayment({ repository, invoiceId, amount, idempotencyKey, actorId });
  const key = String(idempotencyKey || '').trim();
  if (!key) throw fail('Payment idempotency key is required', 'IDEMPOTENCY_KEY_REQUIRED');
  const normalized = { payable_id: String(payableId), amount: String(amount), currency: String(currency || '').toUpperCase(), payment_reference: String(paymentReference || ''), payment_method: String(paymentMethod || '') };
  const payloadFingerprint = paymentFingerprint(normalized);
  return repository.withTransaction(async (tx) => {
    await tx.lockPaymentOperation(key);
    const retry = await tx.findPaymentByIdempotency(key);
    if (retry) {
      if (retry.payload_fingerprint !== payloadFingerprint) throw fail('Idempotency key was used with a different payment payload', 'IDEMPOTENCY_CONFLICT', 409);
      return { payment: retry, idempotent: true };
    }
    const payable = await tx.lockPayable(payableId);
    if (!payable) throw fail('Payable not found', 'PAYABLE_NOT_FOUND', 404);
    if (!['OPEN', 'PARTIALLY_PAID'].includes(payable.payable_status)) throw fail('Payable is not open for payment', 'PAYABLE_NOT_OPEN', 409);
    const authority = await tx.loadPayablePostingAuthority(payable.id);
    if (!authority || String(authority.voucher_status).toLowerCase() !== 'posted') throw fail('AP liability has not been posted', 'PAYABLE_NOT_POSTED', 409);
    if (!payable.currency) throw fail('Payable currency is unavailable', 'PAYABLE_CURRENCY_UNAVAILABLE', 409);
    if (String(payable.currency).toUpperCase() !== normalized.currency) throw fail('Payment currency does not match payable', 'PAYMENT_CURRENCY_MISMATCH', 409);
    const paid = await tx.sumPostedPayments(payable.id);
    const remaining = subtractDecimal(payable.invoice_total, paid);
    if (compareDecimal(amount, '0') <= 0 || compareDecimal(amount, remaining) > 0) throw fail('Payment exceeds open payable balance', 'PAYMENT_AMOUNT_EXCEEDED', 409);
    const payment = await tx.insertPaymentRecord({ request_id: payable.request_id, ap_voucher_id: payable.ap_voucher_id, supplier_invoice_id: payable.supplier_invoice_id, amount_paid: String(amount), currency: normalized.currency, payment_reference: paymentReference, payment_method: paymentMethod, idempotency_key: key, payload_fingerprint: payloadFingerprint, paid_by: actor?.id || actorId });
    await tx.insertPaymentAllocation({ payment_record_id: payment.id, ap_payable_id: payable.id, amount: String(amount) });
    const openBalance = subtractDecimal(remaining, amount);
    const status = compareDecimal(openBalance, '0') === 0 ? 'PAID' : 'PARTIALLY_PAID';
    await tx.synchronizePayableOpenBalance(payable.id, openBalance);
    await tx.updatePayableStatus(payable.id, status);
    await tx.updateInvoicePaymentProjection(payable.supplier_invoice_id, status);
    if (tx.linkDocuments) await tx.linkDocuments(payable.request_id, 'ACCOUNTS_PAYABLE', payable.id, 'PAYMENT', payment.id, actor?.id || actorId);
    const action = status === 'PAID' ? 'PAYMENT_COMPLETED' : 'PAYMENT_PARTIAL';
    await auditService.writeAuditEvent({ client: tx.client, entityType: 'payment', entityId: payment.id, requestId: payable.request_id, action, actorUserId: actor?.id || actorId, metadata: { payable_id: payable.id, amount: String(amount), open_balance: openBalance } });
    await outbox.enqueueNotification(tx.client, { type: action, entityType: 'payment', entityId: payment.id, payload: { payable_id: payable.id, amount: String(amount), open_balance: openBalance }, idempotencyKey: `payment-posted:${payment.id}` });
    return { payment, open_balance: openBalance, payable_status: status, idempotent: false };
  });
};

module.exports = { postPayment, paymentFingerprint };