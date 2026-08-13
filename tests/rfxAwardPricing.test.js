'use strict';

const { priceAggregateRfxResponse } = require('../services/rfxAwardPricingService');
const { calculatePurchaseOrderTotals } = require('../services/purchaseOrderTotalsService');

describe('RFx aggregate quotation pricing authority', () => {
  test('single-item RFx uses the exact supplier quotation price', () => {
    const [priced] = priceAggregateRfxResponse({
      bidAmount: '30.00', requestItems: [{ id: 11, approved_quantity: '3.0000' }], currency: 'USD',
    });
    expect(priced).toMatchObject({ quantity: '3.0000', unitPrice: '10.0000', currency: 'USD' });
    expect(calculatePurchaseOrderTotals({ lines: [{ quantity: priced.quantity, unit_price: priced.unitPrice }] }).grand_total).toBe('30.00');
  });

  test('aggregate-only multi-item RFx cannot fabricate heterogeneous item prices', () => {
    expect(() => priceAggregateRfxResponse({
      bidAmount: '30.00',
      requestItems: [{ id: 11, approved_quantity: '1' }, { id: 12, approved_quantity: '2' }],
    })).toThrow(expect.objectContaining({ code: 'RFX_LINE_PRICING_REQUIRED' }));
  });

  test('non-reconciling aggregate quotation fails closed instead of rounding', () => {
    expect(() => priceAggregateRfxResponse({
      bidAmount: '10.00', requestItems: [{ id: 11, approved_quantity: '3' }],
    })).toThrow(expect.objectContaining({ code: 'RFX_PRICING_INCONSISTENT' }));
  });
});