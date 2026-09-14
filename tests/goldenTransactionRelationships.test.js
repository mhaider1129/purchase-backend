'use strict';

const fs = require('fs');
const path = require('path');

const source = (name) => fs.readFileSync(path.join(__dirname, '..', 'services', name), 'utf8');

describe('Golden Transaction canonical writers', () => {
  test.each([
    ['procurementAwardService.js', "'PURCHASE_REQUEST', locked.request_id, 'PROCUREMENT_AWARD', award.id"],
    ['purchaseOrderService.js', "'PROCUREMENT_AWARD', award.id, 'PURCHASE_ORDER', header.id"],
    ['purchaseOrderService.js', "'PURCHASE_ORDER', po.id, 'BUDGET_COMMITMENT', commitment.id"],
    ['goodsReceiptService.js', "'PURCHASE_ORDER', po.id, 'GOODS_RECEIPT', receipt.id"],
    ['goodsReceiptService.js', "'GOODS_RECEIPT', receipt.id, 'INVENTORY_MOVEMENT', movementId"],
    ['supplierInvoiceService.js', "'PURCHASE_ORDER', po.id, 'AP_INVOICE', invoice.id"],
    ['supplierInvoiceService.js', "'AP_INVOICE', invoice.id, 'THREE_WAY_MATCH', saved.id"],
    ['accountsPayableService.js', "'AP_INVOICE', invoice.id, 'AP_VOUCHER', voucher.id"],
    ['apPostingService.js', "'AP_VOUCHER', voucher.id, 'FINANCE_POSTING', posting.id"],
    ['apPostingService.js', "'FINANCE_POSTING', posting.id, 'ACCOUNTS_PAYABLE', payable.id"],
    ['paymentService.js', "'ACCOUNTS_PAYABLE', payable.id, 'PAYMENT', payment.id"],
  ])('%s persists %s', (file, relationship) => {
    expect(source(file)).toContain(relationship);
  });

  test('document links are written through the transaction-bound repository', () => {
    const repository = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'connectedP2PRepository.js'), 'utf8');
    expect(repository).toContain('INSERT INTO document_flow_links');
    expect(repository).toContain('const createConnectedP2PRepository = (client)');
  });
});