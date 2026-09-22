'use strict';

const fs = require('fs');
const path = require('path');
const supplierInvoiceService = require('../services/supplierInvoiceService');
const accountsPayableService = require('../services/accountsPayableService');
const apPostingService = require('../services/apPostingService');

const noEvents = { writeAuditEvent: jest.fn(), enqueueNotification: jest.fn() };
const transactional = (tx) => ({ withTransaction: (work) => work(tx) });

describe('Batch 1 request-scoped transaction boundaries', () => {
  test('invoice matching rejects a mismatched route after locking the invoice', async () => {
    const tx = { lockInvoice: jest.fn(async () => ({ id: 7, request_id: 11 })) };
    await expect(supplierInvoiceService.runInvoiceMatch({ repository: transactional(tx), requestId: 12, invoiceId: 7, actor: { id: 1 }, auditService: noEvents, outbox: noEvents }))
      .rejects.toMatchObject({ code: 'REQUEST_SCOPE_MISMATCH', statusCode: 409 });
    expect(tx.lockInvoice).toHaveBeenCalledWith(7);
  });

  test('voucher creation rejects a mismatched route before idempotency replay', async () => {
    const tx = { lockApOperation: jest.fn(), lockInvoice: jest.fn(async () => ({ id: 7, request_id: 11 })) };
    await expect(accountsPayableService.createPayableFromVerifiedInvoice({ repository: transactional(tx), requestId: 12, invoiceId: 7, actor: { id: 1 }, idempotencyKey: 'scope', accountingLines: [], auditService: noEvents, outbox: noEvents }))
      .rejects.toMatchObject({ code: 'REQUEST_SCOPE_MISMATCH', statusCode: 409 });
  });

  test('AP posting rejects a mismatched route after locking the voucher', async () => {
    const tx = { lockApPostingOperation: jest.fn(), lockApVoucher: jest.fn(async () => ({ id: 3, request_id: 11 })) };
    await expect(apPostingService.postApVoucher({ repository: transactional(tx), requestId: 12, voucherId: 3, actor: { id: 1 }, idempotencyKey: 'scope', auditService: noEvents, outbox: noEvents }))
      .rejects.toMatchObject({ code: 'REQUEST_SCOPE_MISMATCH', statusCode: 409 });
  });
});

describe('Batch 1 migration and HTTP writer boundaries', () => {
  const root = path.resolve(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

  test('migration backfills supplier identity only through invoice and PO IDs', () => {
    const sql = read('sql/manual/031_p2p_batch1_authority_hardening.sql');
    expect(sql).toContain('po.supplier_id = si.supplier_id');
    expect(sql).toContain('ALTER COLUMN supplier_id SET NOT NULL');
    expect(sql).toContain('document_flow_links_unique_edge');
    expect(sql).not.toMatch(/supplier_name\s*=/i);
  });

  test('P2P HTTP controller never invokes runtime table ensure helpers', () => {
    expect(read('controllers/procureToPayController.js')).not.toMatch(/ensure[A-Za-z]+Tables/);
  });

  test('global PO command and legacy payment adapter are closed', () => {
    expect(read('routes/procureToPay.js')).toContain("code: 'UNSCOPED_PO_CREATION_DISABLED'");
    expect(read('services/paymentService.js')).toContain("'LEGACY_PAYMENT_DISABLED', 410");
    expect(read('services/paymentService.js')).not.toContain('postLegacyInvoicePayment');
  });
});