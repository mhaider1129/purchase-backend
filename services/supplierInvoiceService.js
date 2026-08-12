'use strict';

const crypto = require('crypto');
const { calculatePurchaseOrderTotals } = require('./purchaseOrderTotalsService');
const { matchInvoice } = require('./invoiceMatchingService');
const defaultAudit = require('./auditService');
const defaultOutbox = require('./notificationOutboxService');

const error = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const normalizeInvoiceNumber = (value) => String(value || '').trim().toLowerCase();
const canonicalPayload = ({ supplierId, purchaseOrderId, invoiceNumber, invoiceDate, currency, lines }) => ({
  supplier_id: String(supplierId), purchase_order_id: String(purchaseOrderId),
  invoice_number: normalizeInvoiceNumber(invoiceNumber), invoice_date: String(invoiceDate),
  currency: String(currency || '').trim().toUpperCase(),
  lines: (lines || []).map((line) => ({ purchase_order_item_id: String(line.purchase_order_item_id), quantity: String(line.quantity), unit_price: String(line.unit_price), tax_amount: String(line.tax_amount || 0), discount_amount: String(line.discount_amount || 0) })),
});
const fingerprintInvoice = (input) => crypto.createHash('sha256').update(JSON.stringify(canonicalPayload(input))).digest('hex');

const emit = async (tx, auditService, outbox, action, invoice, actor, metadata = {}) => {
  await auditService.writeAuditEvent({ client: tx.client, entityType: 'supplier_invoice', entityId: invoice.id, requestId: invoice.request_id, action, actorUserId: actor.id, metadata });
  await outbox.enqueueNotification(tx.client, { type: action, entityType: 'supplier_invoice', entityId: invoice.id, payload: { supplier_invoice_id: invoice.id, purchase_order_id: invoice.purchase_order_id, ...metadata }, idempotencyKey: `${action.toLowerCase()}:${invoice.id}:${metadata.match_result_id || 'submission'}` });
};

const submitSupplierInvoice = async ({ repository, purchaseOrderId, supplierId, invoiceNumber, invoiceDate, currency, lines, idempotencyKey, actor, attachmentMetadata = null, auditService = defaultAudit, outbox = defaultOutbox }) => {
  if (!String(idempotencyKey || '').trim()) throw error('A non-empty idempotency key is required', 'IDEMPOTENCY_KEY_REQUIRED');
  if (!purchaseOrderId || !supplierId || !String(invoiceNumber || '').trim() || !invoiceDate || !currency || !Array.isArray(lines) || !lines.length) throw error('Purchase order, supplier, invoice number/date, currency and lines are required', 'INVALID_INVOICE');
  const payloadFingerprint = fingerprintInvoice({ supplierId, purchaseOrderId, invoiceNumber, invoiceDate, currency, lines });
  return repository.withTransaction(async (tx) => {
    await tx.lockInvoiceOperation(idempotencyKey);
    const retry = await tx.findInvoiceByIdempotency(idempotencyKey);
    if (retry) {
      if (retry.payload_fingerprint !== payloadFingerprint) throw error('Idempotency key was already used with a different invoice payload', 'IDEMPOTENCY_CONFLICT', 409);
      return { invoice: await tx.loadInvoiceWithLines(retry.id), idempotent: true };
    }
    const normalized = normalizeInvoiceNumber(invoiceNumber);
    await tx.lockSupplierInvoiceIdentity(supplierId, normalized);
    if (await tx.findSupplierInvoiceByNormalizedNumber(supplierId, normalized)) throw error('Duplicate supplier invoice', 'DUPLICATE_INVOICE', 409);
    const po = await tx.lockPurchaseOrder(purchaseOrderId);
    if (!po) throw error('Purchase order not found', 'PURCHASE_ORDER_NOT_FOUND', 404);
    if (String(po.supplier_id) !== String(supplierId)) throw error('Invoice supplier does not match purchase order supplier', 'SUPPLIER_MISMATCH', 409);
    if (!['PO_ISSUED', 'PO_PARTIAL', 'PO_DELIVERED'].includes(po.status)) throw error(`Purchase order status ${po.status} does not permit invoicing`, 'PO_NOT_INVOICEABLE', 409);
    const poLines = await tx.loadPurchaseOrderLines(po.id);
    const byId = new Map(poLines.map((line) => [String(line.id), line]));
    const calculated = calculatePurchaseOrderTotals({ lines });
    const persistedLines = lines.map((line, index) => {
      const poLine = byId.get(String(line.purchase_order_item_id));
      if (!poLine) throw error(`Invoice line ${index} does not belong to the purchase order`, 'PO_LINE_NOT_FOUND', 409);
      return { ...line, ...calculated.lines[index], purchase_order_item_id: poLine.id, requested_item_id: poLine.requested_item_id, description: poLine.description || line.description || `PO line ${poLine.id}` };
    });
    const invoice = await tx.insertSupplierInvoice({ request_id: po.request_id, supplier_id: supplierId, purchase_order_id: po.id, invoice_number: String(invoiceNumber).trim(), normalized_invoice_number: normalized, invoice_date: invoiceDate, currency: String(currency).toUpperCase(), idempotency_key: idempotencyKey.trim(), payload_fingerprint: payloadFingerprint, subtotal_amount: calculated.subtotal, tax_amount: calculated.tax, discount_amount: calculated.discount, total_amount: calculated.grand_total, attachment_metadata: attachmentMetadata, submitted_by: actor.id });
    for (const line of persistedLines) await tx.insertSupplierInvoiceLine({ ...line, supplier_invoice_id: invoice.id });
    await emit(tx, auditService, outbox, 'SUPPLIER_INVOICE_SUBMITTED', invoice, actor, { supplier_id: supplierId, totals: calculated });
    return { invoice: await tx.loadInvoiceWithLines(invoice.id), idempotent: false };
  });
};

const runInvoiceMatch = ({ repository, invoiceId, actor, auditService = defaultAudit, outbox = defaultOutbox }) => repository.withTransaction(async (tx) => {
  const invoice = await tx.lockInvoice(invoiceId); if (!invoice) throw error('Invoice not found', 'INVOICE_NOT_FOUND', 404);
  await tx.lockPurchaseOrder(invoice.purchase_order_id); // serializes competing matches for the PO
  const fullInvoice = await tx.loadInvoiceWithLines(invoice.id);
  const po = await tx.loadPurchaseOrderForInvoice(invoice.id); if (!po) throw error('Invoice purchase order not found', 'PURCHASE_ORDER_NOT_FOUND', 404);
  po.lines = await tx.loadPurchaseOrderLines(po.id);
  const accepted = await tx.loadAcceptedReceiptQuantitiesByPoLine(po.id);
  const priorQuantities = await tx.loadPriorValidInvoicedQuantitiesByPoLine(po.id, invoice.id);
  const priorValues = await tx.loadPriorValidInvoicedValuesByPoLine(po.id, invoice.id);
  const result = matchInvoice({ invoice: fullInvoice, purchaseOrder: po, acceptedReceipts: accepted, priorQuantities, priorValues });
  const saved = await tx.insertMatchResult({ request_id: invoice.request_id, supplier_invoice_id: invoice.id, policy: result.policy, match_status: result.status, variances: result.variances, actor_id: actor.id });
  const updated = await tx.updateInvoiceLifecycle(invoice.id, result.status);
  await emit(tx, auditService, outbox, result.matched ? 'INVOICE_MATCH_VERIFIED' : 'INVOICE_MATCH_EXCEPTION', updated, actor, { match_result_id: saved.id, policy: result.policy, variances: result.variances });
  return { ...result, match_result: saved, invoice: updated };
});

const decideMatchOverride = async ({ repository, matchResultId, decision, reason, actor, auditService = defaultAudit, outbox = defaultOutbox }) => {
  if (!String(reason || '').trim()) throw error('Override reason is required', 'OVERRIDE_REASON_REQUIRED');
  if (!['APPROVED', 'DECLINED'].includes(decision)) throw error('Invalid override decision', 'INVALID_OVERRIDE_DECISION');
  return repository.withTransaction(async (tx) => {
    const current = await tx.lockMatchResult(matchResultId); if (!current) throw error('Match result not found', 'MATCH_RESULT_NOT_FOUND', 404);
    if (current.match_status !== 'MATCH_EXCEPTION') throw error('Only a match exception can be overridden', 'MATCH_OVERRIDE_NOT_ALLOWED', 409);
    const history = await tx.insertMatchOverrideDecision({ invoice_match_result_id: current.id, decision, reason: reason.trim(), actor_id: actor.id, original_variances: current.variances || current.mismatch_reasons || [] });
    const status = decision === 'APPROVED' ? 'MATCH_VERIFIED' : 'MATCH_EXCEPTION';
    const updated = await tx.updateInvoiceLifecycle(current.supplier_invoice_id, status);
    await emit(tx, auditService, outbox, `INVOICE_MATCH_OVERRIDE_${decision}`, updated, actor, { match_result_id: current.id, override_decision_id: history.id, reason: reason.trim(), original_variances: history.original_variances });
    return { decision: history, invoice: updated, original_match: current };
  });
};

const assertPayable = (invoice) => { if (invoice.status !== 'APPROVED_FOR_PAYMENT') throw error('Invoice is not approved for payment', 'INVOICE_NOT_PAYABLE', 409); };
module.exports = { submitSupplierInvoice, runInvoiceMatch, decideMatchOverride, fingerprintInvoice, normalizeInvoiceNumber, assertPayable };