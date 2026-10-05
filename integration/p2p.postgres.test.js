'use strict';

const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { disposableDatabaseUrl } = require('./disposableDatabase');

// Validate before importing any application module that reads DATABASE_URL.
const url = disposableDatabaseUrl(process.env.P2P_LOCAL_DATABASE_URL);
process.env.DATABASE_URL = url;
const pool = new Pool({ connectionString: url, max: 10, options: '-c statement_timeout=10000 -c lock_timeout=5000' });
const defaultPool = require('../config/db');
const { createTransactionalP2PRepository, createConnectedP2PRepository } = require('../repositories/connectedP2PRepository');
const { createAward } = require('../services/procurementAwardService');
const poService = require('../services/purchaseOrderService');
const { createGoodsReceipt } = require('../services/goodsReceiptService');
const invoiceService = require('../services/supplierInvoiceService');
const { verifyInvoiceForFinance } = require('../services/financeVerificationService');
const apService = require('../services/accountsPayableService');
const { postApVoucher } = require('../services/apPostingService');
const { postPayment } = require('../services/paymentService');
const { deriveCompletion } = require('../services/p2pCompletionService');
const repository = createTransactionalP2PRepository(pool);
const one = async (sql, values = []) => (await pool.query(sql, values)).rows[0];
let keySequence = 0;
const key = label => `${label}-${++keySequence}`;

before(async () => {
  const existing = await one("SELECT COUNT(*)::int count FROM information_schema.tables WHERE table_schema='public'");
  assert.equal(existing.count, 0, 'Runner must supply a new empty database; existing schemas are never reset');
  await pool.query(fs.readFileSync(path.join(__dirname, 'fixtures/p2p.sql'), 'utf8'));
});
after(async () => { await pool.end(); await defaultPool.end(); });

async function createCase({ inventory = false, quantity = '10', price = '100', orderedQuantity = quantity } = {}) {
  const department = await one('INSERT INTO departments DEFAULT VALUES RETURNING *');
  const request = await one("INSERT INTO requests(department_id,status) VALUES($1,'Approved') RETURNING *", [department.id]);
  const budget = await one("INSERT INTO budget_envelopes(department_id,fiscal_year,currency,allocated_amount) VALUES($1,EXTRACT(YEAR FROM CURRENT_DATE),'USD',10000) RETURNING *", [department.id]);
  const generic = await one("INSERT INTO generic_items(base_uom_id,inventory_uom_id,lifecycle_status,is_active) VALUES(1,1,'active',TRUE) RETURNING *");
  const product = await one("INSERT INTO approved_products(generic_item_id,product_name,package_quantity,approval_status,is_active) VALUES($1,'Fixture product',1,'approved',TRUE) RETURNING *", [generic.id]);
  const catalog = await one('INSERT INTO supplier_catalog_items(supplier_id,approved_product_id,purchasing_uom_id,conversion_factor,is_active) VALUES(1,$1,1,1,TRUE) RETURNING *', [product.id]);
  const item = await one("INSERT INTO requested_items(request_id,generic_item_id,quantity,approved_quantity,request_mode,item_name,unit_of_measure) VALUES($1,$2,$3,$3,'generic','Fixture item','EA') RETURNING *", [request.id, generic.id, quantity]);
  const warehouse = await one("INSERT INTO warehouses(institute_id,name) VALUES(1,'Integration warehouse') RETURNING *");
  const stock = await one("INSERT INTO stock_items(generic_item_id,approved_product_id,inventory_uom_id,name,unit) VALUES($1,$2,1,'Fixture item','EA') RETURNING *", [generic.id, product.id]);
  const actor = { id: 1, institute_id: 1, warehouse_id: warehouse.id, permissions: ['inventory.receive'] };
  const award = await createAward({ repository, requestItem: item, supplier: { id: 1 }, actor, input: {
    awarded_quantity: quantity, unit_price: price, currency: 'USD',
    approved_product_id: product.id, supplier_catalog_item_id: catalog.id,
    source_type: 'RFX_RESPONSE', source_id: 'fixture-response', selection_reason: 'Integration fixture', idempotency_key: key('award'),
  } });
  const po = await poService.createPurchaseOrderFromAwards({ repository, requestId: request.id, awardIds: [award.id], quantities: { [award.id]: orderedQuantity }, actor });
  if (inventory) {
    // Existing classified inventory-PO fixture. Classification is not selected by
    // the current award-to-PO API; this branch tests receiving onward only.
    await pool.query("UPDATE purchase_order_items SET line_type='INVENTORY' WHERE purchase_order_id=$1", [po.id]);
  }
  return { request, budget, item, award, po, line: po.lines[0], actor, warehouse, stock };
}

async function issue(c) {
  await poService.submitPurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor });
  await poService.approvePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor });
  return poService.releasePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor });
}
const receiptArgs = (c, quantity, idempotencyKey = key('receipt')) => ({ repository,
  requestId: c.request.id, purchaseOrderId: c.po.id, actor: c.actor, idempotencyKey,
  lines: [{ purchase_order_item_id: c.line.id, received_quantity: quantity, warehouse_id: c.warehouse.id }],
});
async function invoice(c, quantity) {
  return (await invoiceService.submitSupplierInvoice({ repository, purchaseOrderId: c.po.id, supplierId: 1,
    invoiceNumber: key('INV'), invoiceDate: '2026-01-01', currency: 'USD', actor: c.actor, idempotencyKey: key('invoice'),
    lines: [{ purchase_order_item_id: c.line.id, quantity, unit_price: c.line.unit_price }],
  })).invoice;
}
async function voucher(c, inv, { verify = true } = {}) {
  assert.equal((await invoiceService.runInvoiceMatch({ repository, invoiceId: inv.id, actor: c.actor })).matched, true);
  await verifyInvoiceForFinance({ repository, invoiceId: inv.id, actor: c.actor });
  const created = await apService.createPayableFromVerifiedInvoice({ repository, invoiceId: inv.id, actor: c.actor,
    idempotencyKey: key('voucher'), accountingLines: [
      { account_code: 'FIXTURE-EXPENSE', debit_amount: inv.total_amount },
      { account_code: 'FIXTURE-AP', credit_amount: inv.total_amount },
    ],
  });
  if (verify) await apService.verifyApVoucher({ repository, voucherId: created.voucher.id, actor: c.actor });
  return created.voucher;
}
const paymentArgs = (c, payable, amount, idempotencyKey = key('payment')) => ({ repository,
  payableId: payable.id, amount, currency: 'USD', actor: c.actor, idempotencyKey,
});
async function completion(c) {
  const facts = await createConnectedP2PRepository(pool).loadRequestP2PCompletionFacts(c.request.id);
  return deriveCompletion({ approvedQuantity: facts.approved_quantity, orderedQuantity: facts.ordered_quantity,
    receivedQuantity: facts.received_quantity, financiallyActiveInvoiceCount: facts.financially_active_invoice_count,
    unsettledPayableCount: facts.unsettled_payable_count, activeCommitmentCount: facts.active_commitment_count,
    unresolvedFinancialObligationCount: facts.unresolved_financial_obligation_count,
  });
}
async function snapshot() {
  return one(`SELECT (SELECT COUNT(*) FROM goods_receipts) receipts,
    (SELECT COUNT(*) FROM inventory_transactions) movements,
    (SELECT COALESCE(SUM(quantity),0) FROM warehouse_stock_levels) stock,
    (SELECT COUNT(*) FROM finance_postings) postings,
    (SELECT COUNT(*) FROM ap_payables) payables,
    (SELECT COALESCE(SUM(amount),0) FROM commitment_ledger WHERE stage='actual') actual,
    (SELECT COALESCE(SUM(amount),0) FROM commitment_ledger WHERE stage='encumbrance' AND state='ACTIVE') remaining,
    (SELECT COUNT(*) FROM payment_allocations) allocations,
    (SELECT COUNT(*) FROM document_flow_links) links,
    (SELECT COUNT(*) FROM audit_logs) audits, (SELECT COUNT(*) FROM notification_outbox) notifications`);
}
async function postedCase() {
  const c = await createCase({ quantity: '1' });
  await issue(c); await createGoodsReceipt(receiptArgs(c, '1'));
  const inv = await invoice(c, '1');
  const v = await voucher(c, inv);
  const posted = await postApVoucher({ repository, voucherId: v.id, actor: c.actor, idempotencyKey: key('posting') });
  return { ...c, inv, voucher: v, payable: posted.payable };
}

test('approved demand through PO, partial receipts, two invoices, AP and full settlement', async () => {
  const c = await createCase();
  const released = await issue(c);
  assert.equal(released.commitment.amount, '1000.00');
  const issuedSnapshot = await snapshot();
  await poService.releasePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor });
  assert.deepEqual(await snapshot(), issuedSnapshot, 'Issue retry must not duplicate commitment, audit or outbox');
  const firstReceipt = receiptArgs(c, '6');
  firstReceipt.lines[0].damaged_quantity = '1';
  await createGoodsReceipt(firstReceipt);
  assert.equal((await completion(c)).receipt_complete, false);
  const firstInvoice = await invoice(c, '5');
  const firstVoucher = await voucher(c, firstInvoice);
  const postingKey = key('post');
  const posted = await postApVoucher({ repository, voucherId: firstVoucher.id, actor: c.actor, idempotencyKey: postingKey });
  assert.equal(posted.actualization.amount, '500.00');
  assert.equal((await one('SELECT amount FROM commitment_ledger WHERE id=$1', [released.commitment.id])).amount, '500.00');
  const postedSnapshot = await snapshot();
  assert.equal((await postApVoucher({ repository, voucherId: firstVoucher.id, actor: c.actor, idempotencyKey: postingKey })).idempotent, true);
  assert.deepEqual(await snapshot(), postedSnapshot);
  assert.equal((await postPayment(paymentArgs(c, posted.payable, '200'))).open_balance, '300.00');
  assert.equal((await completion(c)).financial_complete, false);
  await postPayment(paymentArgs(c, posted.payable, '300'));
  assert.equal((await completion(c)).financial_complete, false, 'The remaining PO commitment must keep finance open');
  await createGoodsReceipt(receiptArgs(c, '5'));
  const secondInvoice = await invoice(c, '5');
  const secondVoucher = await voucher(c, secondInvoice);
  const secondPosted = await postApVoucher({ repository, voucherId: secondVoucher.id, actor: c.actor, idempotencyKey: key('post') });
  assert.equal((await one('SELECT consumed_amount FROM budget_envelopes WHERE id=$1', [c.budget.id])).consumed_amount, '1000.00');
  await postPayment(paymentArgs(c, secondPosted.payable, '500'));
  assert.deepEqual(await completion(c), { procurement_complete: true, receipt_complete: true, financial_complete: true });
  const edges = (await pool.query('SELECT source_document_type,target_document_type FROM document_flow_links WHERE request_id=$1', [c.request.id])).rows;
  for (const [source, target] of [['PURCHASE_REQUEST','PROCUREMENT_AWARD'], ['PROCUREMENT_AWARD','PURCHASE_ORDER'],
    ['PURCHASE_ORDER','GOODS_RECEIPT'], ['AP_INVOICE','AP_VOUCHER'], ['AP_VOUCHER','FINANCE_POSTING'],
    ['FINANCE_POSTING','ACCOUNTS_PAYABLE'], ['ACCOUNTS_PAYABLE','PAYMENT']]) {
    assert.ok(edges.some(edge => edge.source_document_type === source && edge.target_document_type === target), `Missing ${source} -> ${target}`);
  }
});

test('PO issue rejects missing approval and insufficient budget without partial writes', async () => {
  const c = await createCase();
  await assert.rejects(poService.releasePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor }), { code: 'INVALID_PO_TRANSITION' });
  await pool.query('UPDATE budget_envelopes SET allocated_amount=999 WHERE id=$1', [c.budget.id]);
  await poService.submitPurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor });
  await poService.approvePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor });
  const before = await snapshot();
  await assert.rejects(poService.releasePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor }), { code: 'BUDGET_INSUFFICIENT' });
  assert.deepEqual(await snapshot(), before);
});

test('concurrent inventory receipt retries create one receipt, movement and allocation', async () => {
  const c = await createCase({ inventory: true }); await issue(c);
  const args = receiptArgs(c, '6');
  const results = await Promise.all([createGoodsReceipt(args), createGoodsReceipt(args)]);
  assert.equal(results.filter(result => result.idempotent).length, 1);
  assert.equal(results[0].receipt.id, results[1].receipt.id);
  assert.equal((await one('SELECT available_quantity FROM stock_items WHERE id=$1', [c.stock.id])).available_quantity, '6.0000');
  assert.equal((await one('SELECT COUNT(*)::int count FROM inventory_transactions WHERE stock_item_id=$1', [c.stock.id])).count, 1);
  assert.equal((await one('SELECT COUNT(*)::int count FROM inventory_transaction_allocations WHERE stock_item_id=$1', [c.stock.id])).count, 1);
  const before = await snapshot();
  await assert.rejects(createGoodsReceipt({ ...args, requestId: c.request.id + 1000 }), { code: 'REQUEST_SCOPE_MISMATCH' });
  await assert.rejects(createGoodsReceipt({ ...args, lines: [{ ...args.lines[0], received_quantity: '7' }] }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await snapshot(), before);
});

test('concurrent receipts cannot exceed ordered quantity or inflate stock', async () => {
  const c = await createCase({ inventory: true }); await issue(c);
  const results = await Promise.allSettled([createGoodsReceipt(receiptArgs(c, '6')), createGoodsReceipt(receiptArgs(c, '6'))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'OVER_RECEIPT');
  assert.equal((await one('SELECT available_quantity FROM stock_items WHERE id=$1', [c.stock.id])).available_quantity, '6.0000');
});

test('inventory permissions and institute scope are enforced with full rollback', async () => {
  const c = await createCase({ inventory: true }); await issue(c);
  const before = await snapshot();
  await assert.rejects(createGoodsReceipt({ ...receiptArgs(c, '1'), actor: { id: 1, institute_id: 1, warehouse_id: c.warehouse.id, permissions: [] } }), { code: 'INVENTORY_PERMISSION_DENIED' });
  await assert.rejects(createGoodsReceipt({ ...receiptArgs(c, '1'), actor: { ...c.actor, institute_id: 2 } }), { statusCode: 403 });
  assert.deepEqual(await snapshot(), before);
});

test('receipt audit failure rolls back receipt, stock, movement, allocations and outbox', async () => {
  const c = await createCase({ inventory: true }); await issue(c);
  const before = await snapshot();
  await assert.rejects(createGoodsReceipt({ ...receiptArgs(c, '4'), auditService: { writeAuditEvent: async () => { throw new Error('Injected audit failure'); } } }), /Injected audit failure/);
  assert.deepEqual(await snapshot(), before);
});

test('concurrent matches serialize capacity and preserve an over-invoicing exception', async () => {
  const c = await createCase(); await issue(c); await createGoodsReceipt(receiptArgs(c, '10'));
  const invoices = await Promise.all([invoice(c, '6'), invoice(c, '6')]);
  const results = await Promise.all(invoices.map(inv => invoiceService.runInvoiceMatch({ repository, invoiceId: inv.id, actor: c.actor })));
  assert.equal(results.filter(result => result.matched).length, 1);
  assert.equal(results.find(result => !result.matched).status, 'MATCH_EXCEPTION');
  assert.equal((await completion(c)).financial_complete, false);
});

test('AP outbox failure rolls back posting, payable, actualization and budget projection', async () => {
  const c = await createCase(); await issue(c); await createGoodsReceipt(receiptArgs(c, '10'));
  const inv = await invoice(c, '10'); const v = await voucher(c, inv);
  const before = await snapshot();
  await assert.rejects(postApVoucher({ repository, voucherId: v.id, actor: c.actor, idempotencyKey: key('post'),
    outbox: { enqueueNotification: async () => { throw new Error('Injected outbox failure'); } },
  }), /Injected outbox failure/);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await one('SELECT voucher_status FROM ap_vouchers WHERE id=$1', [v.id])).voucher_status, 'verified');
  assert.equal((await one('SELECT consumed_amount FROM budget_envelopes WHERE id=$1', [c.budget.id])).consumed_amount, '0.00');
});

test('concurrent AP posting retries create one liability and one actualization', async () => {
  const c = await createCase(); await issue(c); await createGoodsReceipt(receiptArgs(c, '10'));
  const inv = await invoice(c, '10'); const v = await voucher(c, inv);
  const args = { repository, voucherId: v.id, actor: c.actor, idempotencyKey: key('post') };
  const results = await Promise.all([postApVoucher(args), postApVoucher(args)]);
  assert.equal(results.filter(result => result.idempotent).length, 1);
  assert.equal(results[0].payable.id, results[1].payable.id);
  assert.equal((await one("SELECT COUNT(*)::int count FROM commitment_ledger WHERE ap_voucher_id=$1 AND stage='actual'", [v.id])).count, 1);
});

test('concurrent payments prevent overpayment and payment retry duplicates', async () => {
  const c = await postedCase();
  const results = await Promise.allSettled([postPayment(paymentArgs(c, c.payable, '70')), postPayment(paymentArgs(c, c.payable, '70'))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PAYMENT_AMOUNT_EXCEEDED');
  assert.equal((await one('SELECT open_balance FROM ap_payables WHERE id=$1', [c.payable.id])).open_balance, '30.00');
  const args = paymentArgs(c, c.payable, '30');
  await postPayment(args); const before = await snapshot();
  assert.equal((await postPayment(args)).idempotent, true);
  await assert.rejects(postPayment({ ...args, amount: '31' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await snapshot(), before);
  assert.equal((await completion(c)).financial_complete, true);
});

for (const stage of ['matched', 'finance-verified', 'draft-voucher', 'verified-voucher']) {
  test(`closing an order keeps a ${stage} invoice financially unresolved`, async () => {
    const c = await createCase(); await issue(c); await createGoodsReceipt(receiptArgs(c, '10'));
    const inv = await invoice(c, '10');
    if (stage.endsWith('voucher')) await voucher(c, inv, { verify: stage === 'verified-voucher' });
    else {
      assert.equal((await invoiceService.runInvoiceMatch({ repository, invoiceId: inv.id, actor: c.actor })).matched, true);
      if (stage === 'finance-verified') await verifyInvoiceForFinance({ repository, invoiceId: inv.id, actor: c.actor });
    }
    await poService.closePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor });
    assert.equal((await completion(c)).financial_complete, false, 'An invoice without posted AP remains an unresolved obligation');
  });
}

test('a cancelled replacement invoice does not keep an otherwise settled request open', async () => {
  const c = await postedCase(); await postPayment(paymentArgs(c, c.payable, '100'));
  const extra = await invoice(c, '1');
  assert.equal((await completion(c)).financial_complete, false);
  // Seed a terminal legacy/replacement state; this suite does not implement cancellation.
  await pool.query("UPDATE supplier_invoices SET status='CANCELLED' WHERE id=$1", [extra.id]);
  assert.equal((await completion(c)).financial_complete, true);
});

test('partial fulfilment releases unused commitment without claiming receipt completion', async () => {
  const c = await createCase(); await issue(c); await createGoodsReceipt(receiptArgs(c, '6'));
  const inv = await invoice(c, '6'); const v = await voucher(c, inv);
  const posted = await postApVoucher({ repository, voucherId: v.id, actor: c.actor, idempotencyKey: key('post') });
  await postPayment(paymentArgs(c, posted.payable, '600'));
  await assert.rejects(poService.closePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor }), { code: 'PO_CLOSE_REASON_REQUIRED' });
  const closed = await poService.closePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor, reason: 'Supplier cannot deliver remainder' });
  assert.equal(closed.commitment.amount, '400.00');
  assert.equal(closed.commitment.state, 'RELEASED');
  assert.deepEqual(await completion(c), { procurement_complete: true, receipt_complete: false, financial_complete: true });
});
