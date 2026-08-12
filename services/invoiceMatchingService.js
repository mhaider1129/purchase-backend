'use strict';
const { calculateLine, addDecimal, compareDecimal } = require('./purchaseOrderTotalsService');
const matchInvoice = ({ invoice, purchaseOrder, receipts = [], priorInvoices = [], policy }) => {
  const variances = [];
  if (String(invoice.supplier_id) !== String(purchaseOrder.supplier_id)) variances.push({ code: 'SUPPLIER_MISMATCH' });
  if (invoice.currency !== purchaseOrder.currency) variances.push({ code: 'CURRENCY_MISMATCH', expected: purchaseOrder.currency, actual: invoice.currency });
  const sumLines = (documents) => { const result = new Map(); for (const document of documents) for (const line of document.lines || []) result.set(String(line.po_line_id), addDecimal(result.get(String(line.po_line_id)) || 0, line.quantity)); return result; };
  const receivedByLine = sumLines(receipts);
  const previouslyInvoicedByLine = sumLines(priorInvoices.filter(({ status }) => !['CANCELLED', 'REJECTED', 'VOIDED'].includes(String(status).toUpperCase())));
  for (const line of invoice.lines) {
    const poLine = purchaseOrder.lines.find((candidate) => String(candidate.id) === String(line.po_line_id));
    if (!poLine) { variances.push({ code: 'PO_REFERENCE_MISMATCH', invoice_line_id: line.id }); continue; }
    if (String(line.unit_price) !== String(poLine.unit_price)) variances.push({ code: 'PRICE_VARIANCE', invoice_line_id: line.id, expected: String(poLine.unit_price), actual: String(line.unit_price) });
    const cumulative = addDecimal(previouslyInvoicedByLine.get(String(poLine.id)) || 0, line.quantity);
    if (compareDecimal(cumulative, poLine.quantity) > 0) variances.push({ code: 'QUANTITY_VARIANCE', reason: 'OVER_INVOICED', invoice_line_id: line.id, ordered: String(poLine.quantity), previously_invoiced: previouslyInvoicedByLine.get(String(poLine.id)) || '0.00', current: String(line.quantity) });
    if (policy === 'THREE_WAY' && compareDecimal(cumulative, receivedByLine.get(String(poLine.id)) || 0) > 0) variances.push({ code: 'MISSING_RECEIPT', reason: 'OVER_INVOICED', invoice_line_id: line.id, received: receivedByLine.get(String(poLine.id)) || '0.00', cumulative_invoiced: cumulative });
    const invoiceTotal = calculateLine(line).line_total;
    if (line.line_total != null && String(line.line_total) !== invoiceTotal) variances.push({ code: 'LINE_TOTAL_VARIANCE', invoice_line_id: line.id, expected: invoiceTotal, actual: String(line.line_total) });
  }
  return { policy, matched: variances.length === 0, status: variances.length ? 'MATCH_EXCEPTION' : 'MATCHED', variances };
};
module.exports = { matchInvoice };