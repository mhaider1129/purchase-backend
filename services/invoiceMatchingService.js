'use strict';
const { calculateLine } = require('./purchaseOrderTotalsService');
const matchInvoice = ({ invoice, purchaseOrder, receipts = [], policy }) => {
  const variances = [];
  if (String(invoice.supplier_id) !== String(purchaseOrder.supplier_id)) variances.push({ code: 'SUPPLIER_MISMATCH' });
  if (invoice.currency !== purchaseOrder.currency) variances.push({ code: 'CURRENCY_MISMATCH', expected: purchaseOrder.currency, actual: invoice.currency });
  const receivedByLine = new Map();
  for (const receipt of receipts) for (const line of receipt.lines || []) receivedByLine.set(String(line.po_line_id), Number(receivedByLine.get(String(line.po_line_id)) || 0) + Number(line.quantity));
  for (const line of invoice.lines) {
    const poLine = purchaseOrder.lines.find((candidate) => String(candidate.id) === String(line.po_line_id));
    if (!poLine) { variances.push({ code: 'PO_REFERENCE_MISMATCH', invoice_line_id: line.id }); continue; }
    if (String(line.unit_price) !== String(poLine.unit_price)) variances.push({ code: 'PRICE_VARIANCE', invoice_line_id: line.id, expected: String(poLine.unit_price), actual: String(line.unit_price) });
    if (Number(line.quantity) > Number(poLine.quantity)) variances.push({ code: 'QUANTITY_VARIANCE', invoice_line_id: line.id, expected: String(poLine.quantity), actual: String(line.quantity) });
    if (policy === 'THREE_WAY' && Number(line.quantity) > Number(receivedByLine.get(String(poLine.id)) || 0)) variances.push({ code: 'MISSING_RECEIPT', invoice_line_id: line.id, received: String(receivedByLine.get(String(poLine.id)) || 0), invoiced: String(line.quantity) });
    const invoiceTotal = calculateLine(line).line_total;
    if (line.line_total != null && String(line.line_total) !== invoiceTotal) variances.push({ code: 'LINE_TOTAL_VARIANCE', invoice_line_id: line.id, expected: invoiceTotal, actual: String(line.line_total) });
  }
  return { policy, matched: variances.length === 0, status: variances.length ? 'MATCH_EXCEPTION' : 'MATCHED', variances };
};
module.exports = { matchInvoice };