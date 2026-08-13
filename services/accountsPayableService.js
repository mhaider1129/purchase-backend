'use strict';

const crypto = require('crypto');
const { addDecimal, compareDecimal } = require('./purchaseOrderTotalsService');
const supplierInvoiceService = require('./supplierInvoiceService');
const defaultAudit = require('./auditService');
const defaultOutbox = require('./notificationOutboxService');

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const validateLines = (lines, invoiceTotal) => {
  if (!Array.isArray(lines) || !lines.length) throw fail('Accounting lines are required', 'ACCOUNTING_LINES_REQUIRED');
  const debit = addDecimal(...lines.map((line) => line.debit_amount || '0'));
  const credit = addDecimal(...lines.map((line) => line.credit_amount || '0'));
  if (compareDecimal(debit, credit) !== 0) throw fail('Voucher debit and credit totals must balance', 'UNBALANCED_VOUCHER');
  if (compareDecimal(credit, invoiceTotal) !== 0) throw fail('Voucher liability must reconcile to the supplier invoice', 'VOUCHER_INVOICE_MISMATCH');
  return { debit, credit };
};

const createPayableFromVerifiedInvoice = ({ repository, invoiceId, actor, idempotencyKey, accountingLines, auditService = defaultAudit, outbox = defaultOutbox }) => {
  const key = String(idempotencyKey || '').trim();
  if (!key) throw fail('AP idempotency key is required', 'IDEMPOTENCY_KEY_REQUIRED');
  return repository.withTransaction(async (tx) => {
    await tx.lockApOperation(key);
    const invoice = await tx.lockInvoice(invoiceId);
    if (!invoice) throw fail('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    const payloadFingerprint = fingerprint({ invoiceId: String(invoiceId), accountingLines });
    const retry = await tx.findApVoucherByIdempotency(key);
    if (retry) {
      if (retry.payload_fingerprint !== payloadFingerprint) throw fail('Idempotency key was used with a different AP payload', 'IDEMPOTENCY_CONFLICT', 409);
      return { voucher: retry, payable: await tx.findPayableByInvoice(invoice.id), idempotent: true };
    }
    if (invoice.status !== 'FINANCE_VERIFIED') throw fail('Invoice has not been finance verified', 'INVOICE_NOT_FINANCE_VERIFIED', 409);
    await supplierInvoiceService.assertInvoiceMatchApproved({ repository: tx, invoiceId: invoice.id });
    if (await tx.findPayableByInvoice(invoice.id)) throw fail('An active payable already exists for this invoice', 'DUPLICATE_PAYABLE', 409);
    const totals = validateLines(accountingLines, invoice.total_amount);
    const voucher = await tx.insertApVoucher({ request_id: invoice.request_id, supplier_invoice_id: invoice.id, currency: invoice.currency, total_amount: invoice.total_amount, created_by: actor.id, idempotency_key: key, payload_fingerprint: payloadFingerprint });
    for (const [index, line] of accountingLines.entries()) await tx.insertApVoucherLine({ ...line, ap_voucher_id: voucher.id, line_number: index + 1 });
    const payable = await tx.insertApPayable({ request_id: invoice.request_id, supplier_invoice_id: invoice.id, supplier_name: invoice.supplier || invoice.supplier_name || String(invoice.supplier_id), invoice_total: invoice.total_amount, open_balance: invoice.total_amount, posted_by: actor.id });
    await tx.updateInvoiceLifecycle(invoice.id, 'AP_VOUCHER_CREATED');
    if (tx.linkDocuments) await tx.linkDocuments(invoice.request_id, 'AP_INVOICE', invoice.id, 'AP_VOUCHER', voucher.id, actor.id);
    await auditService.writeAuditEvent({ client: tx.client, entityType: 'ap_voucher', entityId: voucher.id, requestId: invoice.request_id, action: 'AP_VOUCHER_CREATED', actorUserId: actor.id, metadata: totals });
    await outbox.enqueueNotification(tx.client, { type: 'AP_VOUCHER_CREATED', entityType: 'ap_voucher', entityId: voucher.id, payload: { invoice_id: invoice.id, payable_id: payable.id }, idempotencyKey: `ap-voucher-created:${voucher.id}` });
    return { voucher, payable, idempotent: false };
  });
};

module.exports = { createPayableFromVerifiedInvoice, validateLines };