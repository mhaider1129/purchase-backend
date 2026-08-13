'use strict';

const { addDecimal, compareDecimal } = require('./purchaseOrderTotalsService');
const supplierInvoiceService = require('./supplierInvoiceService');
const defaultAudit = require('./auditService');
const defaultOutbox = require('./notificationOutboxService');

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

const postApVoucher = ({ repository, voucherId, actor, idempotencyKey, auditService = defaultAudit, outbox = defaultOutbox }) => {
  const key = String(idempotencyKey || '').trim();
  if (!key) throw fail('AP posting idempotency key is required', 'IDEMPOTENCY_KEY_REQUIRED');
  return repository.withTransaction(async (tx) => {
    await tx.lockApPostingOperation(key);
    const retry = await tx.findApPostingByIdempotency(key);
    if (retry) {
      if (String(retry.ap_voucher_id) !== String(voucherId)) throw fail('Idempotency key belongs to another voucher', 'IDEMPOTENCY_CONFLICT', 409);
      return { posting: retry, actualization: await tx.findActualizationByVoucher(voucherId), payable: await tx.findPayableByVoucher(voucherId), idempotent: true };
    }
    const voucher = await tx.lockApVoucher(voucherId);
    if (!voucher) throw fail('AP voucher not found', 'AP_VOUCHER_NOT_FOUND', 404);
    if (String(voucher.voucher_status).toLowerCase() !== 'verified') throw fail('Only a verified voucher can be posted', 'AP_VOUCHER_NOT_VERIFIED', 409);
    const invoice = await tx.lockInvoice(voucher.supplier_invoice_id);
    await supplierInvoiceService.assertInvoiceMatchApproved({ repository: tx, invoiceId: invoice.id });
    const debit = addDecimal(...voucher.lines.map((line) => line.debit_amount || '0'));
    const credit = addDecimal(...voucher.lines.map((line) => line.credit_amount || '0'));
    if (compareDecimal(debit, credit) || compareDecimal(credit, invoice.total_amount)) throw fail('Voucher totals do not reconcile to invoice', 'VOUCHER_INVOICE_MISMATCH', 409);
    const po = await tx.lockPurchaseOrder(invoice.purchase_order_id);
    const encumbrance = await tx.lockActivePoEncumbrance(po.id);
    if (!encumbrance || compareDecimal(invoice.total_amount, encumbrance.amount) > 0) throw fail('Invoice exceeds remaining PO commitment', 'PO_COMMITMENT_EXCEEDED', 409);
    const posting = await tx.insertFinancePosting({ request_id: invoice.request_id, ap_voucher_id: voucher.id, supplier_invoice_id: invoice.id, amount: invoice.total_amount, idempotency_key: key, posted_by: actor.id });
    const actualization = await tx.insertCommitmentActualization({ ...encumbrance, amount: invoice.total_amount, supplier_invoice_id: invoice.id, ap_voucher_id: voucher.id, idempotency_key: `ap-actual:${voucher.id}`, actor_id: actor.id });
    const reduced = await tx.reduceActiveEncumbrance(encumbrance.id, invoice.total_amount);
    if (!reduced) throw fail('PO commitment changed or cannot cover invoice', 'PO_COMMITMENT_EXCEEDED', 409);
    await tx.synchronizeBudgetConsumedProjection(encumbrance.budget_envelope_id);
    const payable = await tx.insertApPayable({ request_id: invoice.request_id, supplier_invoice_id: invoice.id, ap_voucher_id: voucher.id, supplier_name: invoice.supplier || invoice.supplier_name || String(invoice.supplier_id), invoice_total: invoice.total_amount, open_balance: invoice.total_amount, currency: invoice.currency, posted_by: actor.id });
    await tx.markVoucherPosted(voucher.id, actor.id);
    await tx.updateInvoiceLifecycle(invoice.id, 'AP_POSTED');
    await auditService.writeAuditEvent({ client: tx.client, entityType: 'ap_voucher', entityId: voucher.id, requestId: invoice.request_id, action: 'AP_VOUCHER_POSTED', actorUserId: actor.id, metadata: { posting_id: posting.id, actualization_id: actualization.id } });
    await outbox.enqueueNotification(tx.client, { type: 'AP_VOUCHER_POSTED', entityType: 'ap_voucher', entityId: voucher.id, payload: { posting_id: posting.id, payable_id: payable.id }, idempotencyKey: `ap-voucher-posted:${voucher.id}` });
    // Request completion remains derived by p2pCompletionService. Posting does
    // not write a lifecycle state because SQL 006 designates no such projection.
    return { posting, actualization, payable, idempotent: false };
  });
};

module.exports = { postApVoucher };