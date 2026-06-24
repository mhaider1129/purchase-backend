const {
  performInvoiceMatch,
  MATCH_POLICIES,
  canTransitionState,
  LIFECYCLE_STATES,
  derivePurchaseOrderStatus,
  getPurchaseOrderStatusMetadata,
  validatePurchaseOrderForIssuance,
} = require('../services/procureToPayService');

describe('procureToPayService', () => {
  test('happy path: 3-way match passes', () => {
    const result = performInvoiceMatch({
      policy: MATCH_POLICIES.THREE_WAY,
      requestItems: [{ quantity: 10, unit_cost: 5 }],
      receiptItems: [{ quantity: 10, unit_price: 5 }],
      invoiceItems: [{ quantity: 10, unit_price: 5 }],
    });

    expect(result.matched).toBe(true);
    expect(result.mismatch_reasons).toHaveLength(0);
  });

  test('partial receipt path: 3-way detects mismatch', () => {
    const result = performInvoiceMatch({
      policy: MATCH_POLICIES.THREE_WAY,
      requestItems: [{ quantity: 10, unit_cost: 5 }],
      receiptItems: [{ quantity: 5, unit_price: 5 }],
      invoiceItems: [{ quantity: 10, unit_price: 5 }],
    });

    expect(result.matched).toBe(false);
    expect(result.mismatch_reasons).toContain('Invoice quantity exceeds received quantity');
  });

  test('mismatch path: invoice total exceeds request total', () => {
    const result = performInvoiceMatch({
      policy: MATCH_POLICIES.TWO_WAY,
      requestItems: [{ quantity: 10, unit_cost: 5 }],
      invoiceItems: [{ quantity: 10, unit_price: 7 }],
    });

    expect(result.matched).toBe(false);
    expect(result.mismatch_reasons).toContain('Invoice total exceeds requested/PO total');
  });

  test('finance verification transition path', () => {
    expect(canTransitionState(LIFECYCLE_STATES.FINANCE_REVIEW_PENDING, LIFECYCLE_STATES.FINANCE_VERIFIED)).toBe(true);
    expect(canTransitionState(LIFECYCLE_STATES.FINANCE_REVIEW_PENDING, LIFECYCLE_STATES.PAID)).toBe(false);
  });

  test('voucher/payment completion path', () => {
    expect(canTransitionState(LIFECYCLE_STATES.FINANCE_VERIFIED, LIFECYCLE_STATES.AP_VOUCHER_CREATED)).toBe(true);
    expect(canTransitionState(LIFECYCLE_STATES.PAYMENT_PENDING, LIFECYCLE_STATES.PAID)).toBe(true);
  });

  test('void/reversal-like protection path', () => {
    expect(canTransitionState(LIFECYCLE_STATES.PAID, LIFECYCLE_STATES.CANCELLED)).toBe(false);
  });

  test('maps business and system PO statuses', () => {
    expect(getPurchaseOrderStatusMetadata('PO_ISSUED')).toEqual(
      expect.objectContaining({ business_status: 'Issued / Sent to Supplier', system_code: 'PO_ISSUED' })
    );
    expect(getPurchaseOrderStatusMetadata('PO_PARTIAL')).toEqual(
      expect.objectContaining({ business_status: 'Partially Received', system_code: 'PO_PARTIAL' })
    );
  });

  test('derives delivered and partial PO states from quantities', () => {
    expect(derivePurchaseOrderStatus({ currentStatus: 'PO_ISSUED', orderedQuantity: 10, receivedQuantity: 4, issuedAt: new Date() })).toBe('PO_PARTIAL');
    expect(derivePurchaseOrderStatus({ currentStatus: 'PO_ISSUED', orderedQuantity: 10, receivedQuantity: 10, issuedAt: new Date() })).toBe('PO_DELIVERED');
  });

  test('validates mandatory issuance fields', () => {
    expect(validatePurchaseOrderForIssuance({ supplierName: 'ACME', items: [], deliveryDate: null })).toEqual(
      expect.arrayContaining([
        'At least one PO item is required',
        'Delivery date is required',
        'Delivery location is required',
        'Budget / cost center is required',
        'Tax terms are required',
        'Payment terms are required',
      ])
    );
  });
});