const {
  performInvoiceMatch,
  MATCH_POLICIES,
  canTransitionState,
  LIFECYCLE_STATES,
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
});