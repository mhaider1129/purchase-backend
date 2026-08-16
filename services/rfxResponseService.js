'use strict';

const { parseDecimal, formatDecimal } = require('./purchaseOrderTotalsService');

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const currencyPattern = /^[A-Z]{3}$/;
const exactInput = (value) => /^\d+(\.\d{1,4})?$/.test(String(value ?? '').trim());
const formatProduct = (scaledEight) => `${scaledEight / 100000000n}.${String(scaledEight % 100000000n).padStart(8, '0')}`;
const parseEight = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,8})?$/.test(text)) throw fail('Quotation total must be an exact decimal', 'RFX_INVALID_PRICING');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100000000n + BigInt((fraction + '00000000').slice(0, 8));
};

function normalizeQuotationLines(lines, requestedItems, currency = 'USD') {
  if (!Array.isArray(lines) || !lines.length) throw fail('Linked RFx responses require quotation lines', 'RFX_LINE_PRICING_REQUIRED');
  const requested = new Map(requestedItems.map((item) => [String(item.id), item]));
  const seen = new Set();
  const currencies = new Set();
  let total = 0n;
  const normalized = lines.map((line) => {
    const requestedItemId = line.requested_item_id;
    if (requestedItemId === undefined || requestedItemId === null || requestedItemId === '') throw fail('Each quotation line requires requested_item_id', 'RFX_REQUESTED_ITEM_REQUIRED');
    const key = String(requestedItemId);
    if (!requested.has(key)) throw fail('Quotation requested item does not belong to the linked request', 'RFX_REQUESTED_ITEM_MISMATCH');
    if (seen.has(key)) throw fail('A requested item may appear only once per response', 'RFX_DUPLICATE_RESPONSE_ITEM');
    seen.add(key);
    let quantity; let freeQuantity; let unitPrice;
    try {
      if (!exactInput(line.quoted_quantity ?? line.quantity) || !exactInput(line.free_quantity ?? '0') || !exactInput(line.unit_price ?? line.unit_cost)) throw new TypeError('precision');
      quantity = parseDecimal(line.quoted_quantity ?? line.quantity);
      freeQuantity = parseDecimal(line.free_quantity ?? '0');
      unitPrice = parseDecimal(line.unit_price ?? line.unit_cost);
    } catch (_error) { throw fail('Quotation quantities and prices must be exact decimals', 'RFX_INVALID_LINE_PRICING'); }
    if (quantity <= 0n || freeQuantity < 0n || unitPrice < 0n) throw fail('Quotation quantity must be positive and prices/free quantity non-negative', 'RFX_INVALID_LINE_PRICING');
    const lineCurrency = String(line.currency || currency).trim().toUpperCase();
    if (!currencyPattern.test(lineCurrency)) throw fail('Quotation currency must be a three-letter code', 'RFX_INVALID_CURRENCY');
    currencies.add(lineCurrency);
    const requiredQuantity = requested.get(key).approved_quantity ?? requested.get(key).quantity;
    try {
      if (requiredQuantity === undefined || requiredQuantity === null || compareScaled(quantity, parseDecimal(requiredQuantity)) !== 0) {
        throw fail('Quoted payable quantity must equal the governed requested quantity', 'RFX_QUOTATION_QUANTITY_MISMATCH');
      }
    } catch (error) {
      if (error.code) throw error;
      throw fail('Requested item has no valid governed quantity', 'RFX_INVALID_REQUIRED_QUANTITY');
    }
    // Multiplying two four-place scaled integers retains all eight decimal places.
    total += quantity * unitPrice;
    const requestedItem=requested.get(key); const mode=String(requestedItem.request_mode||''); const physical=Boolean(mode)&&!['service','approved_free_text_exception'].includes(mode); if(physical&&(!line.approved_product_id||!line.supplier_catalog_item_id))throw fail('Physical quotation line requires offered Product and Supplier Catalog Item','RFX_CATALOG_IDENTITY_REQUIRED',409); return { requested_item_id: requestedItem.id, quoted_quantity: formatDecimal(quantity, 4), free_quantity: formatDecimal(freeQuantity, 4), unit_price: formatDecimal(unitPrice, 4), currency: lineCurrency, brand: line.brand || null, offered_specs: line.offered_specs ?? line.specs ?? null, notes: line.notes || null, approved_product_id:line.approved_product_id||null, supplier_catalog_item_id:line.supplier_catalog_item_id||null };
  });
  if (seen.size !== requested.size) throw fail('Quotation must cover every requested item', 'RFX_INCOMPLETE_QUOTATION');
  if (currencies.size !== 1) throw fail('A quotation response must use one currency', 'RFX_MIXED_CURRENCY_NOT_SUPPORTED');
  return { lines: normalized, total: formatProduct(total), currency: currencies.values().next().value };
}

const compareScaled = (left, right) => left < right ? -1 : left > right ? 1 : 0;

async function submitLinkedRfxResponse({ repository, event, supplierId, submittedBy, bidAmount, notes, responseData, lines }) {
  const requestedItems = await repository.loadRequestedItems(event.request_id);
  const quotation = normalizeQuotationLines(lines, requestedItems);
  if (bidAmount !== undefined && bidAmount !== null && bidAmount !== '' && parseEight(quotation.total) !== parseEight(bidAmount)) throw fail('Header bid amount does not match authoritative quotation lines', 'RFX_QUOTATION_TOTAL_MISMATCH', 409);
  const response = await repository.insertResponse({ rfx_id: event.id, request_id: event.request_id, supplier_id: supplierId, submitted_by: submittedBy, bid_amount: quotation.total, currency: quotation.currency, notes, response_data: responseData });
  const persistedLines = [];
  for (const line of quotation.lines) { if(repository.assertOfferIdentity) await repository.assertOfferIdentity(line,supplierId); persistedLines.push(await repository.insertResponseItem({ ...line, rfx_response_id: response.id })); }
  return { ...response, bid_amount: quotation.total, quotation_total: quotation.total, currency: quotation.currency, items: persistedLines };
}

module.exports = { normalizeQuotationLines, submitLinkedRfxResponse };