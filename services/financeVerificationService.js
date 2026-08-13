'use strict';

const supplierInvoiceService = require('./supplierInvoiceService');
const defaultAudit = require('./auditService');
const defaultOutbox = require('./notificationOutboxService');

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const INACTIVE = new Set(['CANCELLED', 'VOIDED', 'DECLINED', 'SUPERSEDED', 'REPLACED']);

const verifyInvoiceForFinance = ({ repository, invoiceId, actor, auditService = defaultAudit, outbox = defaultOutbox }) =>
  repository.withTransaction(async (tx) => {
    const invoice = await tx.lockInvoice(invoiceId);
    if (!invoice) throw fail('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    if (INACTIVE.has(String(invoice.status).toUpperCase())) throw fail('Invoice is not financially active', 'INVOICE_NOT_FINANCE_ELIGIBLE', 409);
    if (await tx.findFinancePostingByInvoice?.(invoice.id)) throw fail('Invoice has already been financially posted', 'INVOICE_ALREADY_POSTED', 409);
    const purchaseOrder = await tx.loadInvoicePurchaseOrder(invoice.purchase_order_id);
    if (!purchaseOrder || String(purchaseOrder.supplier_id) !== String(invoice.supplier_id)) throw fail('Invoice supplier or purchase-order link is invalid', 'INVOICE_PO_LINK_INVALID', 409);
    await supplierInvoiceService.assertInvoiceMatchApproved({ repository: tx, invoiceId: invoice.id });
    if (tx.assertAccountingDimensions) await tx.assertAccountingDimensions(invoice, purchaseOrder);
    const updated = await tx.updateInvoiceLifecycle(invoice.id, 'FINANCE_VERIFIED');
    await auditService.writeAuditEvent({ client: tx.client, entityType: 'supplier_invoice', entityId: invoice.id, requestId: invoice.request_id, action: 'FINANCE_VERIFIED', actorUserId: actor.id });
    await outbox.enqueueNotification(tx.client, { type: 'FINANCE_VERIFIED', entityType: 'supplier_invoice', entityId: invoice.id, payload: { invoice_id: invoice.id }, idempotencyKey: `finance-verified:${invoice.id}` });
    return { invoice: updated, idempotent: false };
  });

const verifyRequestForFinance = async ({ repository, requestId, actor, auditService, outbox }) => {
  const ids = await repository.loadFinanceEligibleInvoiceIdsForRequest(requestId);
  if (!ids.length) throw fail('At least one financially active supplier invoice is required', 'NO_FINANCE_ELIGIBLE_INVOICES');
  const invoices = [];
  for (const invoiceId of ids) invoices.push((await verifyInvoiceForFinance({ repository, invoiceId, actor, auditService, outbox })).invoice);
  return { invoices };
};

module.exports = { verifyInvoiceForFinance, verifyRequestForFinance, INACTIVE_INVOICE_STATES: INACTIVE };