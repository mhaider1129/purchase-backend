'use strict';

const { parseDecimal, formatDecimal, compareDecimal, calculatePurchaseOrderTotals } = require('./purchaseOrderTotalsService');

const fail = (message, code) => Object.assign(new Error(message), { code, statusCode: 409 });

/**
 * Controlled compatibility for legacy aggregate responses that predate the
 * governed rfx_response_items relation. It is authoritative only for one item.
 */
function priceAggregateRfxResponse({ bidAmount, requestItems, currency = 'USD' }) {
  if (!Array.isArray(requestItems) || requestItems.length === 0) {
    throw fail('RFX request has no approved request items to award', 'RFX_ITEMS_REQUIRED');
  }
  if (requestItems.length !== 1) {
    throw fail(
      'Item-level quotation pricing is required before a multi-item RFX can create procurement awards',
      'RFX_LINE_PRICING_REQUIRED'
    );
  }

  const item = requestItems[0];
  const quantity = String(item.approved_quantity ?? item.quantity ?? '');
  let amount;
  let quantityScaled;
  try {
    amount = parseDecimal(bidAmount);
    quantityScaled = parseDecimal(quantity);
  } catch (_error) {
    throw fail('Winning quotation requires a valid aggregate price and approved quantity', 'RFX_INVALID_PRICING');
  }
  if (amount < 0n || quantityScaled <= 0n) {
    throw fail('Winning quotation requires a valid aggregate price and approved quantity', 'RFX_INVALID_PRICING');
  }

  // parseDecimal uses the project's fixed four-place scale.  Preserve that
  // scale during division and reject a quote that cannot be represented exactly.
  const scaledUnitNumerator = amount * 10000n;
  if (scaledUnitNumerator % quantityScaled !== 0n) {
    throw fail('Aggregate quotation cannot be represented as an exact unit price', 'RFX_PRICING_INCONSISTENT');
  }
  const unitPrice = formatDecimal(scaledUnitNumerator / quantityScaled, 4);
  const totals = calculatePurchaseOrderTotals({ lines: [{ quantity, unit_price: unitPrice }] });
  if (compareDecimal(totals.grand_total, bidAmount) !== 0) {
    throw fail('Quotation total does not reconcile to the award price', 'RFX_PRICING_INCONSISTENT');
  }

  return [{ requestItem: item, quantity, unitPrice, currency }];
}

function priceNormalizedRfxResponse({ responseItems, requestItems }) {
  if (!Array.isArray(responseItems) || !responseItems.length) throw fail('RFx response has no normalized quotation lines', 'RFX_LINE_PRICING_REQUIRED');
  const requested = new Map(requestItems.map(item => [String(item.id), item]));
  const seen = new Set();
  const currencies = new Set();
  const priced = responseItems.map((line) => {
    const key = String(line.requested_item_id);
    const requestItem = requested.get(key);
    if (!requestItem) throw fail('RFx response line is not linked to this request', 'RFX_REQUESTED_ITEM_MISMATCH');
    if (seen.has(key)) throw fail('RFx response contains duplicate requested items', 'RFX_DUPLICATE_RESPONSE_ITEM');
    seen.add(key);
    const required = String(requestItem.approved_quantity ?? requestItem.quantity ?? '');
    if (compareDecimal(line.quoted_quantity, required) !== 0) throw fail('Winning response quantity no longer covers the governed request', 'RFX_QUOTATION_QUANTITY_MISMATCH');
    currencies.add(String(line.currency).toUpperCase());
    return { requestItem, responseItem: line, quantity: line.quoted_quantity, unitPrice: line.unit_price, currency: String(line.currency).toUpperCase(), sourceId: line.id };
  });
  if (seen.size !== requested.size) throw fail('Winning response must cover every requested item', 'RFX_INCOMPLETE_QUOTATION');
  if (currencies.size !== 1) throw fail('Winning response must use one currency', 'RFX_MIXED_CURRENCY_NOT_SUPPORTED');
  return priced;
}

module.exports = { priceAggregateRfxResponse, priceNormalizedRfxResponse };