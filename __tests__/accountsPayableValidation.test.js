'use strict';

jest.mock('../services/supplierInvoiceService', () => ({ assertInvoiceMatchApproved: jest.fn(async () => true) }));
const { createPayableFromVerifiedInvoice, verifyApVoucher } = require('../services/accountsPayableService');
const { postApVoucher } = require('../services/apPostingService');

const invalidLines = [
  ['negative lines', [{ debit_amount: '130' }, { debit_amount: '-10' }, { credit_amount: '120' }], 'INVALID_ACCOUNTING_AMOUNT'],
  ['storage-rounding mismatch', [{ debit_amount: '60.004' }, { debit_amount: '59.996' }, { credit_amount: '120' }], 'ACCOUNTING_AMOUNT_PRECISION'],
  ['two-sided line', [{ debit_amount: '130', credit_amount: '10' }, { credit_amount: '120' }], 'INVALID_ACCOUNTING_LINE'],
  ['unbalanced lines', [{ debit_amount: '120' }, { credit_amount: '119.99' }], 'UNBALANCED_VOUCHER'],
  ['source-total mismatch', [{ debit_amount: '119.99' }, { credit_amount: '119.99' }], 'VOUCHER_INVOICE_MISMATCH'],
];

const transaction = (lines, status = 'draft') => ({
  client: {},
  lockApOperation: jest.fn(async () => {}),
  lockApPostingOperation: jest.fn(async () => {}),
  lockInvoice: jest.fn(async () => ({ id: 4, request_id: 1, status: 'FINANCE_VERIFIED', total_amount: '120', currency: 'USD' })),
  lockApVoucher: jest.fn(async () => ({ id: 7, request_id: 1, supplier_invoice_id: 4, voucher_status: status, lines })),
  findApVoucherByIdempotency: jest.fn(async () => null),
  findPayableByInvoice: jest.fn(async () => null),
  findApPostingByIdempotency: jest.fn(async () => null),
  insertApVoucher: jest.fn(async () => ({ id: 7 })),
  insertApVoucherLine: jest.fn(async () => {}),
  updateInvoiceLifecycle: jest.fn(async () => {}),
  markVoucherVerified: jest.fn(async () => ({ id: 7, voucher_status: 'verified' })),
  insertFinancePosting: jest.fn(async () => ({ id: 10 })),
  insertCommitmentActualization: jest.fn(async () => ({ id: 11 })),
  insertApPayable: jest.fn(async () => ({ id: 12 })),
  markVoucherPosted: jest.fn(async () => {}),
});

const options = tx => ({
  repository: { withTransaction: work => work(tx) },
  invoiceId: 4, voucherId: 7, actor: { id: 1 }, idempotencyKey: 'ap-test',
  auditService: { writeAuditEvent: jest.fn(async () => {}) },
  outbox: { enqueueNotification: jest.fn(async () => {}) },
});

describe('accounting validation at AP lifecycle boundaries', () => {
  test.each(invalidLines)('creation, verification and posting reject %s before financial writes', async (_name, lines, code) => {
    for (const boundary of ['create', 'verify', 'post']) {
      const tx = transaction(lines, boundary === 'post' ? 'verified' : 'draft');
      const args = options(tx);
      const run = boundary === 'create'
        ? createPayableFromVerifiedInvoice({ ...args, accountingLines: lines })
        : boundary === 'verify' ? verifyApVoucher(args) : postApVoucher(args);
      const postingMismatch = boundary === 'post' && ['UNBALANCED_VOUCHER', 'VOUCHER_INVOICE_MISMATCH'].includes(code);
      await expect(run).rejects.toMatchObject({
        code: postingMismatch ? 'VOUCHER_INVOICE_MISMATCH' : code,
        statusCode: postingMismatch ? 409 : 400,
      });
      for (const method of ['insertApVoucher', 'insertApVoucherLine', 'markVoucherVerified', 'insertFinancePosting', 'insertCommitmentActualization', 'insertApPayable', 'markVoucherPosted', 'updateInvoiceLifecycle']) {
        expect(tx[method]).not.toHaveBeenCalled();
      }
      expect(args.auditService.writeAuditEvent).not.toHaveBeenCalled();
      expect(args.outbox.enqueueNotification).not.toHaveBeenCalled();
    }
  });

  test('valid split lines create a draft voucher and verify without creating a payable', async () => {
    const lines = [{ account_code: 'EXP', debit_amount: '100.10' }, { account_code: 'TAX', debit_amount: '19.90' }, { account_code: 'AP', credit_amount: '120' }];
    const tx = transaction(lines);
    const args = options(tx);
    await expect(createPayableFromVerifiedInvoice({ ...args, accountingLines: lines }))
      .resolves.toMatchObject({ voucher: { id: 7 }, payable: null, idempotent: false });
    expect(tx.insertApVoucherLine).toHaveBeenCalledTimes(3);
    await expect(verifyApVoucher(args)).resolves.toMatchObject({ voucher: { voucher_status: 'verified' } });
    expect(tx.insertApPayable).not.toHaveBeenCalled();
    expect(args.auditService.writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { debit: '120.00', credit: '120.00' } }));
  });
});
