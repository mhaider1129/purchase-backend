'use strict';
const { calculateLine, addDecimal, subtractDecimal, compareDecimal } = require('./purchaseOrderTotalsService');

const mapRows = (rows, value) => new Map((rows || []).map((row) => [String(row.purchase_order_item_id), String(row[value] || 0)]));
const matchInvoice = ({ invoice, purchaseOrder, acceptedReceipts = [], priorQuantities = [], priorValues = [], receipts = [], priorInvoices = [] }) => {
  // Legacy in-process callers are normalized at the boundary; database-backed
  // production callers supply the pre-aggregated accepted/prior rows above.
  if (!acceptedReceipts.length && receipts.length) {
    const sums = new Map();
    for (const receipt of receipts) for (const line of receipt.lines || []) sums.set(String(line.purchase_order_item_id ?? line.po_line_id), addDecimal(sums.get(String(line.purchase_order_item_id ?? line.po_line_id)) || 0, line.quantity));
    acceptedReceipts = [...sums].map(([purchase_order_item_id, accepted_quantity]) => ({ purchase_order_item_id, accepted_quantity }));
  }
  if (!priorQuantities.length && priorInvoices.length) {
    const qty = new Map(), value = new Map();
    for (const prior of priorInvoices.filter(x => !['CANCELLED','DECLINED','REJECTED','VOIDED','MATCH_EXCEPTION'].includes(String(x.status).toUpperCase()))) for (const line of prior.lines || []) {
      const id=String(line.purchase_order_item_id ?? line.po_line_id); qty.set(id,addDecimal(qty.get(id)||0,line.quantity)); value.set(id,addDecimal(value.get(id)||0,calculateLine(line).line_total));
    }
    priorQuantities=[...qty].map(([purchase_order_item_id,invoiced_quantity])=>({purchase_order_item_id,invoiced_quantity}));
    priorValues=[...value].map(([purchase_order_item_id,invoiced_value])=>({purchase_order_item_id,invoiced_value}));
  }
  const variances = [];
  if (String(invoice.supplier_id) !== String(purchaseOrder.supplier_id)) variances.push({ code: 'SUPPLIER_MISMATCH', expected: purchaseOrder.supplier_id, actual: invoice.supplier_id });
  if (String(invoice.currency).toUpperCase() !== String(purchaseOrder.currency).toUpperCase()) variances.push({ code: 'CURRENCY_MISMATCH', expected: purchaseOrder.currency, actual: invoice.currency });
  const received = mapRows(acceptedReceipts, 'accepted_quantity');
  const priorQty = mapRows(priorQuantities, 'invoiced_quantity');
  const priorValue = mapRows(priorValues, 'invoiced_value');
  const poLines = new Map((purchaseOrder.lines || []).map((line) => [String(line.id), line]));
  let hasThreeWay = false;
  for (const line of invoice.lines || []) {
    const lineIdentity = line.purchase_order_item_id ?? line.po_line_id;
    const id = String(lineIdentity);
    const poLine = poLines.get(id);
    if (!poLine) { variances.push({ code: 'PO_LINE_NOT_FOUND', purchase_order_item_id: lineIdentity }); continue; }
    const service = poLine.line_type === 'SERVICE';
    hasThreeWay ||= !service;
    if (compareDecimal(line.unit_price, poLine.unit_price) !== 0) variances.push({ code: 'PRICE_VARIANCE', purchase_order_item_id: poLine.id, expected: String(poLine.unit_price), actual: String(line.unit_price), difference: subtractDecimal(line.unit_price, poLine.unit_price), currency: purchaseOrder.currency });
    const cumulativeQty = addDecimal(priorQty.get(id) || 0, line.quantity);
    if (compareDecimal(cumulativeQty, poLine.quantity) > 0) {
      variances.push({ code: 'OVER_INVOICED', purchase_order_item_id: poLine.id, expected: String(poLine.quantity), actual: cumulativeQty, difference: subtractDecimal(cumulativeQty, poLine.quantity), uom: poLine.uom || null });
      variances.push({ code: 'QUANTITY_VARIANCE', reason: 'OVER_INVOICED', purchase_order_item_id: poLine.id, expected: String(poLine.quantity), actual: cumulativeQty, difference: subtractDecimal(cumulativeQty, poLine.quantity), uom: poLine.uom || null });
    }
    if (!service) {
      const accepted = received.get(id) || '0';
      if (compareDecimal(accepted, 0) === 0) variances.push({ code: 'MISSING_RECEIPT', purchase_order_item_id: poLine.id, expected: String(line.quantity), actual: accepted, uom: poLine.uom || null });
      if (compareDecimal(cumulativeQty, accepted) > 0) {
        if (compareDecimal(accepted, 0) !== 0) variances.push({ code: 'MISSING_RECEIPT', purchase_order_item_id: poLine.id, expected: cumulativeQty, actual: accepted, uom: poLine.uom || null });
        variances.push({ code: 'QUANTITY_VARIANCE', reason: 'OVER_ACCEPTED_RECEIPT', purchase_order_item_id: poLine.id, expected: accepted, actual: cumulativeQty, difference: subtractDecimal(cumulativeQty, accepted), uom: poLine.uom || null });
      }
    }
    const currentValue = calculateLine(line).line_total;
    const cumulativeValue = addDecimal(priorValue.get(id) || 0, currentValue);
    const poValue = calculateLine(poLine).line_total;
    if (compareDecimal(cumulativeValue, poValue) > 0) variances.push({ code: 'VALUE_VARIANCE', purchase_order_item_id: poLine.id, expected: poValue, actual: cumulativeValue, difference: subtractDecimal(cumulativeValue, poValue), currency: purchaseOrder.currency });
  }
  const status = variances.length ? 'MATCH_EXCEPTION' : 'MATCH_VERIFIED';
  return { policy: hasThreeWay ? 'THREE_WAY' : 'TWO_WAY', matched: !variances.length, status, variances };
};
module.exports = { matchInvoice };