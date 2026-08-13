'use strict';

const { closePurchaseOrder } = require('../services/purchaseOrderService');

const actor = { id: 9 };
const makeHarness = ({ ordered = '1000', received = '900', encumbrance = '100', actuals = ['600', '300'], status = 'PO_PARTIAL', auditFails = false, outboxFails = false, closeFails = false } = {}) => {
  let state = {
    po: { id: 1, request_id: 5, status },
    commitments: [
      ...(encumbrance == null ? [] : [{ id: 1, purchase_order_id: 1, budget_envelope_id: 2, stage: 'encumbrance', state: 'ACTIVE', amount: encumbrance }]),
      ...actuals.map((amount, index) => ({ id: index + 2, purchase_order_id: 1, budget_envelope_id: 2, stage: 'actual', state: 'ACTIVE', amount })),
    ],
    consumed_amount: actuals.reduce((sum, amount) => sum + Number(amount), 0).toString(),
    audits: [],
    outbox: [],
  };
  const tx = {
    client: {},
    lockPurchaseOrder: async () => state.po,
    calculatePurchaseOrderReceiptTotals: async () => ({ ordered_quantity: ordered, received_quantity: received }),
    lockActivePoEncumbrance: async () => state.commitments.find(row => row.stage === 'encumbrance' && row.state === 'ACTIVE') || null,
    releaseCommitment: async id => {
      const row = state.commitments.find(item => item.id === id && item.stage === 'encumbrance' && item.state === 'ACTIVE');
      if (!row) return null;
      row.state = 'RELEASED';
      return { ...row };
    },
    synchronizeBudgetConsumedProjection: async () => {
      state.consumed_amount = state.commitments.filter(row => row.stage === 'actual' && row.state === 'ACTIVE').reduce((sum, row) => sum + Number(row.amount), 0).toString();
    },
    markPurchaseOrderClosed: async (_id, reason) => {
      if (closeFails) throw new Error('close write failed');
      state.po = { ...state.po, status: 'PO_CLOSED', amendment_reason: reason };
      return state.po;
    },
  };
  const repository = { withTransaction: async work => { const before = structuredClone(state); try { return await work(tx); } catch (error) { state = before; throw error; } } };
  const auditService = { writeAuditEvent: async event => { if (auditFails) throw new Error('audit failed'); state.audits.push(event.action); } };
  const outbox = { enqueueNotification: async (_client, event) => { if (outboxFails) throw new Error('outbox failed'); state.outbox.push(event.type); } };
  return { repository, auditService, outbox, get state() { return state; } };
};

const close = (harness, reason = 'supplier cannot fulfill remainder') => closePurchaseOrder({
  repository: harness.repository,
  purchaseOrderId: 1,
  reason,
  actor,
  auditService: harness.auditService,
  outbox: harness.outbox,
});

test('PO 1000 / actual 900 / remaining 100 releases only the remaining encumbrance', async () => {
  const harness = makeHarness();
  const beforeActuals = harness.state.commitments.filter(row => row.stage === 'actual').map(row => ({ ...row }));
  const result = await close(harness);
  expect(result.commitment).toMatchObject({ amount: '100', stage: 'encumbrance', state: 'RELEASED' });
  expect(harness.state.commitments.filter(row => row.stage === 'actual')).toEqual(beforeActuals);
  expect(harness.state.commitments.filter(row => row.stage === 'encumbrance' && row.state === 'ACTIVE' && Number(row.amount) > 0)).toHaveLength(0);
  expect(harness.state.consumed_amount).toBe('900');
});

test('a fully actualized PO closes without fabricating a release or changing actual evidence', async () => {
  const harness = makeHarness({ received: '1000', encumbrance: null, actuals: ['1000'], status: 'PO_DELIVERED' });
  const before = structuredClone(harness.state.commitments);
  const result = await close(harness, '');
  expect(result.commitment).toBeNull();
  expect(harness.state.commitments).toEqual(before);
  expect(harness.state.audits).toEqual(['PO_CLOSED']);
});

test('PO close retry is idempotent and does not duplicate financial effect, audit, or outbox', async () => {
  const harness = makeHarness();
  await close(harness);
  const afterFirst = structuredClone(harness.state);
  const result = await close(harness);
  expect(result).toMatchObject({ purchaseOrder: { status: 'PO_CLOSED' }, commitment: null });
  expect(harness.state).toEqual(afterFirst);
});

test('PO status failure rolls back the encumbrance release', async () => {
  const harness = makeHarness({ closeFails: true });
  await expect(close(harness)).rejects.toThrow('close write failed');
  expect(harness.state.po.status).toBe('PO_PARTIAL');
  expect(harness.state.commitments.find(row => row.stage === 'encumbrance')).toMatchObject({ amount: '100', state: 'ACTIVE' });
});

test.each([['audit', true, false], ['outbox', false, true]])('%s failure rolls back both PO close and release', async (_label, auditFails, outboxFails) => {
  const harness = makeHarness({ auditFails, outboxFails });
  await expect(close(harness)).rejects.toThrow();
  expect(harness.state.po.status).toBe('PO_PARTIAL');
  expect(harness.state.commitments.find(row => row.stage === 'encumbrance').state).toBe('ACTIVE');
  expect(harness.state.consumed_amount).toBe('900');
});

test('partial delivery requires a governed close reason before any financial mutation', async () => {
  const harness = makeHarness();
  await expect(close(harness, '')).rejects.toMatchObject({ code: 'PO_CLOSE_REASON_REQUIRED' });
  expect(harness.state.po.status).toBe('PO_PARTIAL');
  expect(harness.state.commitments.find(row => row.stage === 'encumbrance').state).toBe('ACTIVE');
});