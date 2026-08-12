'use strict';

const fs = require('fs');
const path = require('path');
const { getEffectiveInvoiceMatchState, assertInvoiceMatchApproved, runInvoiceMatch } = require('../services/supplierInvoiceService');
const { matchInvoice } = require('../services/invoiceMatchingService');
const { createConnectedP2PRepository } = require('../repositories/connectedP2PRepository');

const repositoryWithState = (state) => ({ getEffectiveInvoiceMatchState: jest.fn(async () => state) });
const effective = (state) => getEffectiveInvoiceMatchState({ repository: repositoryWithState(state), invoiceId: 8 });

describe('effective invoice match authority', () => {
  test('direct MATCH_VERIFIED allows finance verification', async () => {
    await expect(assertInvoiceMatchApproved({ repository: repositoryWithState({ match_status: 'MATCH_VERIFIED', match_result_id: 2 }), invoiceId: 8 })).resolves.toMatchObject({ effectiveStatus: 'MATCH_VERIFIED', overridden: false });
  });
  test('MATCH_EXCEPTION blocks finance verification', async () => {
    await expect(assertInvoiceMatchApproved({ repository: repositoryWithState({ match_status: 'MATCH_EXCEPTION', match_result_id: 2 }), invoiceId: 8 })).rejects.toMatchObject({ code: 'INVOICE_MATCH_NOT_APPROVED' });
  });
  test('approved override allows finance verification with provenance', async () => {
    await expect(effective({ match_status: 'MATCH_EXCEPTION', match_result_id: 2, override_decision: 'APPROVED', override_decision_id: 9, override_reason: 'governed variance', override_actor_id: 4 })).resolves.toEqual({ effectiveStatus: 'MATCH_VERIFIED_BY_OVERRIDE', matchResultId: 2, overridden: true, overrideDecisionId: 9, overrideReason: 'governed variance', overrideActorId: 4 });
  });
  test('declined override blocks finance verification', async () => {
    await expect(assertInvoiceMatchApproved({ repository: repositoryWithState({ match_status: 'MATCH_EXCEPTION', match_result_id: 2, override_decision: 'DECLINED' }), invoiceId: 8 })).rejects.toMatchObject({ code: 'INVOICE_MATCH_NOT_APPROVED' });
  });
  test('obsolete override cannot validate the latest exception', async () => {
    const repository = repositoryWithState({ match_status: 'MATCH_EXCEPTION', match_result_id: 3 });
    await expect(assertInvoiceMatchApproved({ repository, invoiceId: 8 })).rejects.toMatchObject({ code: 'INVOICE_MATCH_NOT_APPROVED' });
  });
  test('latest effective result controls downstream state', async () => {
    const repository = repositoryWithState({ match_status: 'MATCH_VERIFIED', match_result_id: 4 });
    await expect(assertInvoiceMatchApproved({ repository, invoiceId: 8 })).resolves.toMatchObject({ matchResultId: 4 });
  });
});

const matchingInput = (quantity, prior = '0') => matchInvoice({
  invoice: { supplier_id: 1, currency: 'USD', lines: [{ purchase_order_item_id: 5, quantity, unit_price: '1' }] },
  purchaseOrder: { supplier_id: 1, currency: 'USD', lines: [{ id: 5, quantity: '100', unit_price: '1', line_type: 'INVENTORY' }] },
  acceptedReceipts: [{ purchase_order_item_id: 5, accepted_quantity: '100' }],
  priorQuantities: [{ purchase_order_item_id: 5, invoiced_quantity: prior }],
  priorValues: [{ purchase_order_item_id: 5, invoiced_value: prior }],
});

describe('cumulative capacity', () => {
  test('pending or unmatched invoice does not consume capacity', () => expect(matchingInput('70')).toMatchObject({ status: 'MATCH_VERIFIED' }));
  test('first verified 70 makes second 70 exception regardless of submission order', () => {
    expect(matchingInput('70')).toMatchObject({ status: 'MATCH_VERIFIED' });
    expect(matchingInput('70', '70')).toMatchObject({ status: 'MATCH_EXCEPTION' });
  });
  test('approved override is selected for capacity, while declined override is not', async () => {
    const queries = [];
    const client = { query: jest.fn(async (sql) => { queries.push(sql); return { rows: [] }; }) };
    const repository = createConnectedP2PRepository(client);
    await repository.loadPriorValidInvoicedQuantitiesByPoLine(1, 2);
    const sql = queries[0];
    expect(sql).toContain("current_decision.decision='APPROVED'");
    expect(sql).not.toContain("current_decision.decision='DECLINED'");
    expect(sql).not.toContain('status NOT IN');
  });
});

test('repeated matching appends history', async () => {
  let nextId = 0;
  const history = [];
  const tx = {
    client: {}, lockInvoice: async () => ({ id: 8, request_id: 1, purchase_order_id: 2 }), lockPurchaseOrder: jest.fn(),
    loadInvoiceWithLines: async () => ({ supplier_id: 1, currency: 'USD', lines: [{ purchase_order_item_id: 5, quantity: '10', unit_price: '1' }] }),
    loadPurchaseOrderForInvoice: async () => ({ id: 2, supplier_id: 1, currency: 'USD' }), loadPurchaseOrderLines: async () => [{ id: 5, quantity: '100', unit_price: '1', line_type: 'INVENTORY' }],
    loadAcceptedReceiptQuantitiesByPoLine: async () => [{ purchase_order_item_id: 5, accepted_quantity: '100' }], loadPriorValidInvoicedQuantitiesByPoLine: async () => [], loadPriorValidInvoicedValuesByPoLine: async () => [],
    insertMatchResult: async (row) => { const saved = { id: ++nextId, ...row }; history.push(saved); return saved; }, updateInvoiceLifecycle: async (id, status) => ({ id, status }),
  };
  const repository = { withTransaction: (work) => work(tx) };
  const dependencies = { repository, invoiceId: 8, actor: { id: 3 }, auditService: { writeAuditEvent: jest.fn() }, outbox: { enqueueNotification: jest.fn() } };
  await runInvoiceMatch(dependencies); await runInvoiceMatch(dependencies);
  expect(history.map(row => row.id)).toEqual([1, 2]);
});

test('live finance verification contains no legacy match-state vocabulary', () => {
  const source = fs.readFileSync(path.join(__dirname, '../controllers/procureToPayController.js'), 'utf8');
  const finance = source.slice(source.indexOf('const verifyFinanceRecord'), source.indexOf('const createApVoucher'));
  expect(finance).not.toMatch(/MATCHED|OVERRIDDEN|PENDING_MATCH|MISMATCH/);
  expect(finance).toContain('assertInvoiceMatchApproved');
});