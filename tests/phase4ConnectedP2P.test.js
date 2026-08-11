const { evaluateSupplierEligibility } = require('../services/supplierEligibilityService');
const { selectPrice } = require('../services/procurementPricingService');
const { calculatePurchaseOrderTotals } = require('../services/purchaseOrderTotalsService');
const { matchInvoice } = require('../services/invoiceMatchingService');
const { deriveCompletion } = require('../services/p2pCompletionService');
const { planCancellation } = require('../services/p2pCancellationService');
const { postPayment } = require('../services/paymentService');

describe('Phase 4 connected P2P behavior', () => {
  test('inactive, suspended, unqualified and category-ineligible suppliers cannot be selected', () => {
    expect(evaluateSupplierEligibility({ is_active: false }).eligible).toBe(false);
    expect(evaluateSupplierEligibility({ status: 'suspended' }).eligible).toBe(false);
    expect(evaluateSupplierEligibility({ qualification_status: 'pending' }).eligible).toBe(false);
    expect(evaluateSupplierEligibility({ eligible_category_ids: [2] }, { categoryId: 1 }).eligible).toBe(false);
  });
  test('contract precedes quotation and provenance is returned', () => {
    const result = selectPrice({ contractPrice: { id: 7, unit_price: '3.25', currency: 'USD' }, award: { id: 9, source_type: 'QUOTATION', unit_price: '4.00', currency: 'USD' } });
    expect(result).toEqual({ unit_price: '3.25', currency: 'USD', price_source_type: 'CONTRACT_LINE', price_source_id: 7 });
  });
  test('quotation is used without contract and unauthorized override is rejected', () => {
    expect(selectPrice({ award: { id: 9, source_type: 'QUOTATION', source_id: 4, unit_price: '4.00', currency: 'USD' } }).price_source_id).toBe(4);
    expect(() => selectPrice({ manualOverride: { unit_price: 1, currency: 'USD' } })).toThrow('not authorized');
  });
  test('PO totals use decimal-safe central calculation with tax and discount', () => {
    expect(calculatePurchaseOrderTotals({ lines: [{ quantity: '0.1', unit_price: '0.2' }, { quantity: '2', unit_price: '10.00', discount_percent: '10', tax_percent: '5' }], freight: '1.00' })).toMatchObject({ subtotal: '20.02', discount: '2.00', tax: '0.90', grand_total: '19.92' });
  });
  test('structured three-way quantity and price variances are emitted', () => {
    const result = matchInvoice({ policy: 'THREE_WAY', purchaseOrder: { supplier_id: 1, currency: 'USD', lines: [{ id: 2, quantity: '100', unit_price: '2' }] }, receipts: [{ lines: [{ po_line_id: 2, quantity: '80' }] }], invoice: { supplier_id: 1, currency: 'USD', lines: [{ id: 3, po_line_id: 2, quantity: '90', unit_price: '3' }] } });
    expect(result.matched).toBe(false); expect(result.variances.map(v => v.code)).toEqual(expect.arrayContaining(['PRICE_VARIANCE', 'MISSING_RECEIPT']));
  });
  test('correct three-way match succeeds exactly', () => {
    const result = matchInvoice({ policy: 'THREE_WAY', purchaseOrder: { supplier_id: 1, currency: 'USD', lines: [{ id: 2, quantity: '40', unit_price: '2.00' }] }, receipts: [{ lines: [{ po_line_id: 2, quantity: '40' }] }], invoice: { supplier_id: 1, currency: 'USD', lines: [{ po_line_id: 2, quantity: '40', unit_price: '2.00' }] } }); expect(result).toMatchObject({ matched: true, variances: [] });
  });
  test('receipt complete can remain financially incomplete and final state closes', () => {
    expect(deriveCompletion({ approvedQuantity: 100, orderedQuantity: 100, receivedQuantity: 100, invoicedQuantity: 80, paidAmount: 0, payableAmount: 160 })).toEqual({ procurement_complete: true, receipt_complete: true, financial_complete: false });
    expect(deriveCompletion({ approvedQuantity: 100, orderedQuantity: 100, receivedQuantity: 100, invoicedQuantity: 100, paidAmount: 200, payableAmount: 200 }).financial_complete).toBe(true);
  });
  test('received PO and paid invoice require reversal rather than deletion', () => {
    expect(planCancellation({ entityType: 'PURCHASE_ORDER', receivedQuantity: 1 }).code).toBe('RECEIPT_RETURN_OR_REVERSAL_REQUIRED');
    expect(planCancellation({ entityType: 'INVOICE', paidAmount: 1 }).code).toBe('FINANCIAL_REVERSAL_REQUIRED');
    expect(planCancellation({ entityType: 'PURCHASE_ORDER' }).release_commitment).toBe(true);
  });
  test('partial, final, excessive and duplicate payments are guarded under invoice lock', async () => {
    let paid = 0; const records = new Map(); let status;
    const repository = { lockInvoice: async (_id, fn) => fn({ status: paid ? 'PARTIALLY_PAID' : 'APPROVED_FOR_PAYMENT', approved_payable_amount: 100 }), findByIdempotencyKey: async key => records.get(key), sumPostedPayments: async () => paid, insert: async row => { paid += Number(row.amount); records.set(row.idempotency_key, row); return row; }, setInvoiceStatus: async (_id, value) => { status = value; } };
    await postPayment({ repository, invoiceId: 1, amount: 40, idempotencyKey: 'a' }); expect(status).toBe('PARTIALLY_PAID');
    await postPayment({ repository, invoiceId: 1, amount: 40, idempotencyKey: 'a' }); expect(paid).toBe(40);
    await expect(postPayment({ repository, invoiceId: 1, amount: 61, idempotencyKey: 'b' })).rejects.toMatchObject({ code: 'PAYMENT_AMOUNT_EXCEEDED' });
    await postPayment({ repository, invoiceId: 1, amount: 60, idempotencyKey: 'c' }); expect(status).toBe('PAID');
  });
});