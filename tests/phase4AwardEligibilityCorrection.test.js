'use strict';

const { createAward } = require('../services/procurementAwardService');
const { releasePurchaseOrder } = require('../services/purchaseOrderService');

const quietEvents = { auditService: { writeAuditEvent: async () => {} }, outbox: { enqueueNotification: async () => {} } };
const awardInput = { awarded_quantity: '70', unit_price: '1.25', currency: 'usd', source_type: 'QUOTATION', source_id: 9, selection_reason: 'best compliant offer', idempotency_key: 'award-1' };

const awardHarness = ({ blocked = false } = {}) => {
  const rows = new Map();
  let awarded = 0;
  let tail = Promise.resolve();
  const tx = {
    client: {},
    lockRequestItem: async () => ({ id: 2, request_id: 1, approved_quantity: '100' }),
    loadSupplierEligibilityFacts: async id => ({ supplier: { id, status: 'active' }, complianceBlocked: blocked, evaluationFacts: [{ overall_score: 90 }], deferredChecks: ['CATEGORY_QUALIFICATION_NOT_AVAILABLE', 'BLACKLIST_REGISTRY_NOT_AVAILABLE'] }),
    findByIdempotencyKey: async key => rows.get(key),
    sumActiveAwards: async () => String(awarded),
    insert: async row => { const saved = { id: rows.size + 1, status: 'ACTIVE', ...row }; rows.set(row.idempotency_key, saved); awarded += Number(row.awarded_quantity); return saved; },
  };
  return {
    facts: tx.loadSupplierEligibilityFacts,
    repository: { withTransaction: work => { const run = tail.then(() => work(tx)); tail = run.catch(() => {}); return run; } },
    rows,
  };
};

test('identical award retry is idempotent and changed fingerprint conflicts', async () => {
  const h = awardHarness();
  const args = { repository: h.repository, requestItem: { id: 2 }, supplier: { id: 3 }, input: awardInput, actor: { id: 4 }, ...quietEvents };
  const first = await createAward(args);
  expect(await createAward(args)).toBe(first);
  await expect(createAward({ ...args, input: { ...awardInput, currency: 'EUR' } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  expect(h.rows.size).toBe(1);
});

test('requested-item transaction lock prevents concurrent 70/70 awards against 100', async () => {
  const h = awardHarness();
  const make = idempotency_key => createAward({ repository: h.repository, requestItem: { id: 2 }, supplier: { id: 3 }, input: { ...awardInput, idempotency_key }, actor: { id: 4 }, ...quietEvents });
  const results = await Promise.allSettled([make('award-a'), make('award-b')]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ code: 'AWARD_QUANTITY_EXCEEDED' });
});

test('compliance block prevents award while compliant supplier and deferred checks pass', async () => {
  const blocked = awardHarness({ blocked: true });
  await expect(createAward({ repository: blocked.repository, requestItem: { id: 2 }, supplier: { id: 3 }, input: awardInput, actor: { id: 4 }, ...quietEvents })).rejects.toMatchObject({ code: 'SUPPLIER_INELIGIBLE', reasons: ['COMPLIANCE_BLOCKED'] });
  const active = awardHarness();
  await expect(createAward({ repository: active.repository, requestItem: { id: 2 }, supplier: { id: 3 }, input: awardInput, actor: { id: 4 }, ...quietEvents })).resolves.toMatchObject({ status: 'ACTIVE' });
  await expect(active.facts(3)).resolves.toMatchObject({ complianceBlocked: false, deferredChecks: ['CATEGORY_QUALIFICATION_NOT_AVAILABLE', 'BLACKLIST_REGISTRY_NOT_AVAILABLE'] });
});

const issueHarness = blocked => {
  const po = { id: 1, request_id: 5, supplier_id: 6, currency: 'USD', status: 'PO_APPROVED', approved_at: new Date(), approved_by: 8 };
  const line = { id: 1, award_id: 2, requested_item_id: 3, price_source_type: 'QUOTATION', price_source_id: 4, quantity: '10', unit_price: '1' };
  const tx = { client: {}, lockPurchaseOrder: async () => po, loadPurchaseOrderLines: async () => [line], loadSupplierEligibilityFacts: async () => ({ supplier: { id: 6, status: 'active' }, complianceBlocked: blocked, evaluationFacts: [], deferredChecks: [] }), resolveBudgetEnvelope: async () => ({ id: 2 }), lockBudgetEnvelope: async () => ({ id: 2, allocated_amount: '100', consumed_amount: '0' }), sumActiveEncumbrances: async () => '0', findCommitmentByIdempotency: async () => null, insertEncumbrance: async row => ({ id: 3, ...row }), markPurchaseOrderIssued: async (_id, totals) => ({ ...po, status: 'PO_ISSUED', total_amount: totals.grand_total }) };
  return { withTransaction: work => work(tx) };
};

test.each([[true, 'rejects'], [false, 'resolves']])('PO issue applies compliance facts (blocked=%s)', async (blocked, outcome) => {
  const operation = releasePurchaseOrder({ repository: issueHarness(blocked), purchaseOrderId: 1, actor: { id: 4 }, ...quietEvents });
  if (outcome === 'rejects') await expect(operation).rejects.toMatchObject({ code: 'SUPPLIER_INELIGIBLE', reasons: ['COMPLIANCE_BLOCKED'] });
  else await expect(operation).resolves.toMatchObject({ purchaseOrder: { status: 'PO_ISSUED' } });
});