'use strict';

jest.mock('../services/supplierInvoiceService', () => ({ assertInvoiceMatchApproved: jest.fn(async () => true) }));
const { postApVoucher } = require('../services/apPostingService');
const { postPayment } = require('../services/paymentService');
const { subtractDecimal } = require('../services/purchaseOrderTotalsService');

const silent = { writeAuditEvent: jest.fn(async () => {}) };
const outbox = { enqueueNotification: jest.fn(async () => {}) };

const postingRepository = (amount = '600') => {
  const state = { encumbrance: '1000', actuals: [], postings: [], payables: [] };
  const tx = {
    client: {}, lockApPostingOperation: async () => {}, findApPostingByIdempotency: async k => state.postings.find(p => p.idempotency_key === k),
    lockApVoucher: async () => ({ id: 7, request_id: 1, supplier_invoice_id: 4, voucher_status: 'verified', lines: [{ debit_amount: amount }, { credit_amount: amount }] }),
    lockInvoice: async () => ({ id: 4, request_id: 1, purchase_order_id: 2, total_amount: amount, currency: 'USD', supplier: 'S' }), lockPurchaseOrder: async () => ({ id: 2 }),
    lockActivePoEncumbrance: async () => ({ id: 3, request_id: 1, budget_envelope_id: 9, purchase_order_id: 2, amount: state.encumbrance, currency: 'USD' }),
    insertFinancePosting: async p => { const row={ id: 10, ...p }; state.postings.push(row); return row; },
    insertCommitmentActualization: async p => { const row={ id: 11, stage:'actual', ...p }; state.actuals.push(row); return row; },
    reduceActiveEncumbrance: async (_id, reduction) => { state.encumbrance=subtractDecimal(state.encumbrance,reduction); return { amount:state.encumbrance,state:state.encumbrance==='0.00'?'ACTUALIZED':'ACTIVE' }; }, synchronizeBudgetConsumedProjection: async () => {},
    insertApPayable: async p => { const row={ id:12, payable_status:'OPEN', ...p }; state.payables.push(row); return row; }, markVoucherPosted: async () => {}, updateInvoiceLifecycle: async () => {},
    findActualizationByVoucher: async id => state.actuals.find(a => String(a.ap_voucher_id)===String(id)), findPayableByVoucher: async id => state.payables.find(p => String(p.ap_voucher_id)===String(id)),
  };
  return { state, withTransaction: work => work(tx) };
};

describe('Phase 4D canonical accounting bridge', () => {
  beforeEach(() => jest.clearAllMocks());
  test('PO1000 invoice600 actualizes 600 and leaves encumbrance400; retry does not duplicate', async () => {
    const repository=postingRepository();
    const first=await postApVoucher({repository,voucherId:7,actor:{id:1},idempotencyKey:'post-7',auditService:silent,outbox});
    const retry=await postApVoucher({repository,voucherId:7,actor:{id:1},idempotencyKey:'post-7',auditService:silent,outbox});
    expect(first.actualization.amount).toBe('600'); expect(repository.state.encumbrance).toBe('400.00');
    expect(repository.state.actuals).toHaveLength(1); expect(retry.idempotent).toBe(true);
  });

  test('decimal 0.10 + 0.20 reconciles exactly to 0.30', async () => {
    const repository=postingRepository('0.30');
    const original=repository.withTransaction;
    repository.withTransaction=(work)=>original(async tx=>{ tx.lockApVoucher=async()=>({id:7,request_id:1,supplier_invoice_id:4,voucher_status:'verified',lines:[{debit_amount:'0.10'},{debit_amount:'0.20'},{credit_amount:'0.30'}]}); return work(tx); });
    await expect(postApVoucher({repository,voucherId:7,actor:{id:1},idempotencyKey:'decimal',auditService:silent,outbox})).resolves.toMatchObject({idempotent:false});
  });

  test.each([['draft'],['verified']])('%s voucher cannot authorize payment', async voucher_status => {
    const tx={ client:{}, lockPaymentOperation:async()=>{}, findPaymentByIdempotency:async()=>null, lockPayable:async()=>({id:1,request_id:1,supplier_invoice_id:1,invoice_total:'100',currency:'USD',payable_status:'OPEN'}), loadPayablePostingAuthority:async()=>({voucher_status}) };
    await expect(postPayment({repository:{withTransaction:w=>w(tx)},payableId:1,amount:'40',currency:'USD',idempotencyKey:`p-${voucher_status}`,actor:{id:1},auditService:silent,outbox})).rejects.toMatchObject({code:'PAYABLE_NOT_POSTED'});
  });

  test('missing payable currency fails closed', async () => {
    const tx={client:{},lockPaymentOperation:async()=>{},findPaymentByIdempotency:async()=>null,lockPayable:async()=>({id:1,invoice_total:'100',payable_status:'OPEN'}),loadPayablePostingAuthority:async()=>({voucher_status:'posted'})};
    await expect(postPayment({repository:{withTransaction:w=>w(tx)},payableId:1,amount:'40',currency:'USD',idempotencyKey:'p',actor:{id:1},auditService:silent,outbox})).rejects.toMatchObject({code:'PAYABLE_CURRENCY_UNAVAILABLE'});
  });

  test('audit/outbox failure rejects the atomic posting transaction', async () => {
    // The production pg repository owns rollback; this verifies failures are not swallowed.
    const repo=postingRepository();
    await expect(postApVoucher({repository:repo,voucherId:7,actor:{id:1},idempotencyKey:'fail',auditService:{writeAuditEvent:async()=>{throw new Error('audit down');}},outbox})).rejects.toThrow('audit down');
  });
});