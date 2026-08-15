'use strict';

const { createPurchaseOrderFromAwards } = require('../services/purchaseOrderService');
const { normalizeQuotationLines, submitLinkedRfxResponse } = require('../services/rfxResponseService');
const { priceNormalizedRfxResponse } = require('../services/rfxAwardPricingService');

const award = { id: 8, request_id: 1, request_item_id: 2, supplier_id: 3, status: 'ACTIVE', awarded_quantity: '10', unit_price: '4.25', currency: 'USD', source_type: 'QUOTATION', source_id: 6, approved_product_id: 20, supplier_catalog_item_id: 30 };
const poRepository = () => {
  let sequence = 0;
  const numbers = new Set();
  const tx = {
    lockAwards: async () => [award], getAwardConversion: async () => ({ remaining_quantity: '10' }), loadAwardUomSnapshot: async () => ({ source_uom_id: 4, source_uom: 'CASE', base_uom_id: 1, base_uom: 'EA', generic_base_uom_id: 1, inventory_uom_id: 1, supplier_conversion_factor: '10', package_quantity: '100' }),
    nextPurchaseOrderNumber: async () => ({ po_number: `PO-2026-${String(++sequence).padStart(6, '0')}` }),
    findPurchaseOrderByNumber: async number => numbers.has(number) ? { id: 1 } : null,
    insertHeader: async row => { if (numbers.has(row.po_number)) throw Object.assign(new Error('duplicate'), { code: '23505' }); numbers.add(row.po_number); return { id: numbers.size, ...row }; },
    insertLine: async row => row,
  };
  return { withTransaction: work => work(tx) };
};

describe('final RFx and PO identity correction', () => {
  test('generated PO identities are non-null, unique, and safe for concurrent callers', async () => {
    const repository = poRepository();
    const [first, second] = await Promise.all([1, 2].map(() => createPurchaseOrderFromAwards({ repository, awardIds: [8], actor: { id: 7 } })));
    expect(first.po_number).toMatch(/^PO-2026-\d{6}$/);
    expect(second.po_number).toMatch(/^PO-2026-\d{6}$/);
    expect(first.po_number).not.toBe(second.po_number);
    expect(first.status).toBe('PO_DRAFT');
  });

  test('governed explicit PO identity is normalized/preserved and duplicates are rejected', async () => {
    const repository = poRepository();
    const first = await createPurchaseOrderFromAwards({ repository, awardIds: [8], actor: { id: 7 }, input: { po_number: ' po-manual-7 ' } });
    expect(first.po_number).toBe('PO-MANUAL-7');
    await expect(createPurchaseOrderFromAwards({ repository, awardIds: [8], actor: { id: 7 }, input: { po_number: 'PO-MANUAL-7' } })).rejects.toMatchObject({ code: 'PO_NUMBER_DUPLICATE' });
  });

  test('generated PO collision retries only the PO-number constraint with the next sequence value', async () => {
    const repository = poRepository();
    const txWork = repository.withTransaction;
    let inserts = 0;
    repository.withTransaction = work => txWork(async tx => {
      const insert = tx.insertHeader;
      tx.insertHeader = async row => {
        inserts += 1;
        if (inserts === 1) throw Object.assign(new Error('collision'), { code: '23505', constraint: 'purchase_orders_po_number_key' });
        return insert(row);
      };
      return work(tx);
    });
    const po = await createPurchaseOrderFromAwards({ repository, awardIds: [8], actor: { id: 7 } });
    expect(po.po_number).toBe('PO-2026-000002');
    expect(inserts).toBe(2);
  });

  test('linked lines require real requested-item identity and reject foreign/duplicate items', () => {
    const items = [{ id: 11, approved_quantity: '1' }, { id: 12, approved_quantity: '1' }];
    expect(() => normalizeQuotationLines([{ quantity: '1', unit_cost: '2' }], items)).toThrow(expect.objectContaining({ code: 'RFX_REQUESTED_ITEM_REQUIRED' }));
    expect(() => normalizeQuotationLines([{ requested_item_id: 99, quantity: '1', unit_cost: '2' }], items)).toThrow(expect.objectContaining({ code: 'RFX_REQUESTED_ITEM_MISMATCH' }));
    expect(() => normalizeQuotationLines([{ requested_item_id: 11, quantity: '1', unit_cost: '2' }, { requested_item_id: 11, quantity: '1', unit_cost: '3' }], items)).toThrow(expect.objectContaining({ code: 'RFX_DUPLICATE_RESPONSE_ITEM' }));
  });

  test('exact distinct prices and free quantity produce the authoritative payable total', () => {
    const result = normalizeQuotationLines([
      { requested_item_id: 11, quoted_quantity: '2.0000', unit_price: '1.2345', free_quantity: '100', currency: 'usd' },
      { requested_item_id: 12, quoted_quantity: '3', unit_price: '7.0001', free_quantity: '0', currency: 'USD' },
    ], [{ id: 11, approved_quantity: '2' }, { id: 12, approved_quantity: '3' }]);
    expect(result.lines.map(line => line.unit_price)).toEqual(['1.2345', '7.0001']);
    expect(result.total).toBe('23.46930000');
    expect(result.currency).toBe('USD');
  });

  test('whole-request quotations require every line and the full payable quantity', () => {
    const items = [{ id: 11, approved_quantity: '100' }, { id: 12, quantity: '2' }];
    expect(() => normalizeQuotationLines([{ requested_item_id: 11, quoted_quantity: '100', unit_price: '1' }], items)).toThrow(expect.objectContaining({ code: 'RFX_INCOMPLETE_QUOTATION' }));
    expect(() => normalizeQuotationLines([{ requested_item_id: 11, quoted_quantity: '60', free_quantity: '40', unit_price: '1' }, { requested_item_id: 12, quoted_quantity: '2', unit_price: '1' }], items)).toThrow(expect.objectContaining({ code: 'RFX_QUOTATION_QUANTITY_MISMATCH' }));
    expect(normalizeQuotationLines([{ requested_item_id: 11, quoted_quantity: '100', free_quantity: '10', unit_price: '1' }, { requested_item_id: 12, quoted_quantity: '2', unit_price: '1' }], items).lines).toHaveLength(2);
  });

  test('quotation lines must use one currency', () => {
    const items = [{ id: 11, quantity: '1' }, { id: 12, quantity: '1' }];
    expect(() => normalizeQuotationLines([{ requested_item_id: 11, quantity: '1', unit_price: '1', currency: 'USD' }, { requested_item_id: 12, quantity: '1', unit_price: '1', currency: 'EUR' }], items)).toThrow(expect.objectContaining({ code: 'RFX_MIXED_CURRENCY_NOT_SUPPORTED' }));
  });

  test('award-time normalization fails before awards for incomplete/changed responses', () => {
    const items = [{ id: 11, approved_quantity: '100' }, { id: 12, approved_quantity: '2' }];
    expect(() => priceNormalizedRfxResponse({ responseItems: [{ requested_item_id: 11, quoted_quantity: '100', unit_price: '1', currency: 'USD' }], requestItems: items })).toThrow(expect.objectContaining({ code: 'RFX_INCOMPLETE_QUOTATION' }));
    expect(() => priceNormalizedRfxResponse({ responseItems: [{ requested_item_id: 11, quoted_quantity: '60', unit_price: '1', currency: 'USD' }, { requested_item_id: 12, quoted_quantity: '2', unit_price: '1', currency: 'USD' }], requestItems: items })).toThrow(expect.objectContaining({ code: 'RFX_QUOTATION_QUANTITY_MISMATCH' }));
    expect(priceNormalizedRfxResponse({ responseItems: [{ id: 1, requested_item_id: 11, quoted_quantity: '100', unit_price: '1', currency: 'USD' }, { id: 2, requested_item_id: 12, quoted_quantity: '2', unit_price: '3', currency: 'USD' }], requestItems: items })).toHaveLength(2);
  });

  test('submission persists governed lines and rejects a mismatched header total', async () => {
    const saved = [];
    const repository = { loadRequestedItems: async () => [{ id: 11, approved_quantity: '2' }], insertResponse: async row => ({ id: 5, ...row }), insertResponseItem: async row => { saved.push(row); return { id: 20, ...row }; } };
    await expect(submitLinkedRfxResponse({ repository, event: { id: 1, request_id: 2 }, supplierId: 3, bidAmount: '9', lines: [{ requested_item_id: 11, quoted_quantity: '2', unit_price: '5' }] })).rejects.toMatchObject({ code: 'RFX_QUOTATION_TOTAL_MISMATCH' });
    const response = await submitLinkedRfxResponse({ repository, event: { id: 1, request_id: 2 }, supplierId: 3, bidAmount: '10.00000000', lines: [{ requested_item_id: 11, quoted_quantity: '2', unit_price: '5', free_quantity: '9' }] });
    expect(response.quotation_total).toBe('10.00000000');
    expect(saved[0]).toMatchObject({ requested_item_id: 11, unit_price: '5.0000', free_quantity: '9.0000' });
  });
});