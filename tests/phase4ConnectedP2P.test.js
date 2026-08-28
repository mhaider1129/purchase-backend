const { evaluateSupplierEligibility } = require('../services/supplierEligibilityService');
const { selectPrice } = require('../services/procurementPricingService');
const { calculatePurchaseOrderTotals } = require('../services/purchaseOrderTotalsService');
const { matchInvoice } = require('../services/invoiceMatchingService');
const { deriveCompletion } = require('../services/p2pCompletionService');
const { planCancellation } = require('../services/p2pCancellationService');
const { postPayment } = require('../services/paymentService');

describe('Phase 4 connected P2P behavior', () => {
  test('supported supplier status and compliance facts determine eligibility', () => {
    expect(evaluateSupplierEligibility({ supplier: { status: 'inactive' } }).eligible).toBe(false);
    expect(evaluateSupplierEligibility({ supplier: { status: 'suspended' } }).eligible).toBe(false);
    expect(evaluateSupplierEligibility({ supplier: { status: 'active' }, complianceBlocked: true }).eligible).toBe(false);
    expect(evaluateSupplierEligibility({ supplier: { status: 'active' }, deferredChecks: ['CATEGORY_QUALIFICATION_NOT_AVAILABLE'] }).eligible).toBe(true);
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
describe('Phase 4 connection corrections', () => {
  test('award idempotency fingerprints conflict and locked cumulative quantity is decimal safe', async () => {
    const { createAward } = require('../services/procurementAwardService');
    const rows = new Map(); let sum = '0';
    const tx = {
      client: {}, lockRequestItem: async () => ({ id: 2, request_id: 1, approved_quantity: '100.0000' }),
      loadSupplierEligibilityFacts: async id => ({ supplier: { id, status: 'active' }, complianceBlocked: false, evaluationFacts: [], deferredChecks: [] }),
      findByIdempotencyKey: async key => rows.get(key), sumActiveAwards: async () => sum,
      insert: async row => { const saved={id:1,...row}; rows.set(row.idempotency_key, saved); sum = row.awarded_quantity; return saved; },
    };
    const repository = { withTransaction: work => work(tx) };
    const deps = { auditService: { writeAuditEvent: async () => {} }, outbox: { enqueueNotification: async () => {} } };
    const base = { awarded_quantity: '70', unit_price: '1.25', currency: 'USD', source_type: 'QUOTATION', source_id: 9, selection_reason: 'best', idempotency_key: 'award-1' };
    await createAward({ repository, requestItem: { id: 2 }, supplier: { id: 3 }, input: base, actor: { id: 4 }, ...deps });
    await expect(createAward({ repository, requestItem: { id: 2 }, supplier: { id: 3 }, input: { ...base, awarded_quantity: '71' }, actor: { id: 4 }, ...deps })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    tx.findByIdempotencyKey = async () => null;
    await expect(createAward({ repository, requestItem: { id: 2 }, supplier: { id: 4 }, input: { ...base, idempotency_key: 'award-2' }, actor: { id: 4 }, ...deps })).rejects.toMatchObject({ code: 'AWARD_QUANTITY_EXCEEDED' });
  });

  test('PO inherits award traceability and rejects a supplied wrong supplier', async () => {
    const { createPurchaseOrderFromAwards } = require('../services/purchaseOrderService');
    const award = { id: 8, request_id: 1, request_item_id: 2, supplier_id: 3, status: 'ACTIVE', awarded_quantity: '10', unit_price: '4', currency: 'USD', source_type: 'QUOTATION', source_id: 6, approved_product_id: 20, supplier_catalog_item_id: 30 };
    const tx = { lockAwards: async () => [award], getAwardConversion: async () => ({ remaining_quantity: '10' }), loadAwardUomSnapshot: async () => ({ generic_item_id: 3, source_uom_id: 4, source_uom: 'CASE', base_uom_id: 1, base_uom: 'EA', generic_base_uom_id: 1, inventory_uom_id: 1, supplier_conversion_factor: '10', package_quantity: '100' }), nextPurchaseOrderNumber: async () => ({ po_number: 'PO-2026-000001' }), findPurchaseOrderByNumber: async () => null, insertHeader: async row => ({ id: 9, ...row }), insertLine: async row => row };
    const repository = { withTransaction: work => work(tx) };
    const po = await createPurchaseOrderFromAwards({ repository, awardIds: [8], actor: { id: 7 } });
    expect(po).toMatchObject({ supplier_id: 3, request_id: 1, lines: [{ award_id: 8, request_item_id: 2, quantity: '10', price_source_type: 'QUOTATION' }] });
    await expect(createPurchaseOrderFromAwards({ repository, awardIds: [8], actor: { id: 7 }, input: { supplier_id: 99 } })).rejects.toMatchObject({ code: 'PO_SUPPLIER_MISMATCH' });
  });

  test('partial award conversion permits 60 plus 40 and rejects the next unit', async () => {
    const { createPurchaseOrderFromAwards } = require('../services/purchaseOrderService');
    const award = { id: 8, request_id: 1, request_item_id: 2, supplier_id: 3, status: 'ACTIVE', awarded_quantity: '100', unit_price: '1', currency: 'USD', source_type: 'AWARD', approved_product_id: 20, supplier_catalog_item_id: 30 };
    let ordered = 0;
    const repository = { withTransaction: async work => work({
      lockAwards: async () => [award],
      getAwardConversion: async () => ({ remaining_quantity: String(100 - ordered) }), loadAwardUomSnapshot: async () => ({ generic_item_id: 3, source_uom_id: 4, source_uom: 'CASE', base_uom_id: 1, base_uom: 'EA', generic_base_uom_id: 1, inventory_uom_id: 1, supplier_conversion_factor: '10', package_quantity: '100' }),
      nextPurchaseOrderNumber: async () => ({ po_number: `PO-2026-${String(ordered + 1).padStart(6, '0')}` }),
      findPurchaseOrderByNumber: async () => null,
      insertHeader: async () => ({ id: ordered + 1 }),
      insertLine: async row => { ordered += Number(row.quantity); return row; },
    }) };
    await createPurchaseOrderFromAwards({ repository, awardIds: [8], quantities: { 8: '60' }, actor: { id: 1 } });
    await createPurchaseOrderFromAwards({ repository, awardIds: [8], quantities: { 8: '40' }, actor: { id: 1 } });
    await expect(createPurchaseOrderFromAwards({ repository, awardIds: [8], quantities: { 8: '1' }, actor: { id: 1 } })).rejects.toMatchObject({ code: 'AWARD_QUANTITY_EXCEEDED' });
  });

  test('cumulative invoice quantities exclude voids and prevent 70 plus 70 against 100', () => {
    const { matchInvoice } = require('../services/invoiceMatchingService');
    const result = matchInvoice({ policy: 'THREE_WAY', purchaseOrder: { supplier_id: 1, currency: 'USD', lines: [{ id: 2, quantity: '100', unit_price: '1' }] }, receipts: [{ lines: [{ po_line_id: 2, quantity: '100' }] }], priorInvoices: [{ status: 'MATCH_VERIFIED', lines: [{ po_line_id: 2, quantity: '70' }] }, { status: 'VOIDED', lines: [{ po_line_id: 2, quantity: '99' }] }], invoice: { supplier_id: 1, currency: 'USD', lines: [{ id: 4, po_line_id: 2, quantity: '70', unit_price: '1' }] } });
    expect(result.variances).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'QUANTITY_VARIANCE', reason: 'OVER_INVOICED' })]));
  });
});