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

module.exports = { priceAggregateRfxResponse };