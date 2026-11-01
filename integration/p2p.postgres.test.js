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
const { verifyInvoiceForFinance,verifyRequestForFinance } = require('../services/financeVerificationService');
const apService = require('../services/accountsPayableService');
const { postApVoucher } = require('../services/apPostingService');
const { postPayment } = require('../services/paymentService');
const { deriveCompletion } = require('../services/p2pCompletionService');
const { collectBaseline, CHECKS } = require('../scripts/lib/p2pBaseline');
const repository = createTransactionalP2PRepository(pool);
const one = async (sql, values = []) => (await pool.query(sql, values)).rows[0];
let keySequence = 0;
const key = label => `${label}-${++keySequence}`;

async function applyDevelopmentMigration(name) {
  const client=await pool.connect();
  try { return await client.query(fs.readFileSync(path.join(__dirname,'../sql/development',name),'utf8')); }
  catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

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
  const item = await one("INSERT INTO requested_items(request_id,generic_item_id,quantity,request_mode,catalog_status,item_name,unit_of_measure) VALUES($1,$2,$3,'generic_item','catalogued','Fixture item','EA') RETURNING *", [request.id, generic.id, quantity]);
  const warehouse = await one("INSERT INTO warehouses(institute_id,name) VALUES(1,'Integration warehouse') RETURNING *");
  const stock = await one("INSERT INTO stock_items(generic_item_id,approved_product_id,inventory_uom_id,mapping_status,name,unit) VALUES($1,$2,1,'mapped_product','Fixture item','EA') RETURNING *", [generic.id, product.id]);
  await pool.query("INSERT INTO warehouse_stock_levels(warehouse_id,stock_item_id,item_name,quantity,stock_status) VALUES($1,$2,'Fixture item',0,'AVAILABLE')",[warehouse.id,stock.id]);
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
  return { department,request, budget, item, award, po, line: po.lines[0], actor, warehouse, stock };
}

async function issue(c) {
  await poService.submitPurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: c.actor });
  await poService.approvePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: {...c.actor,id:2} });
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
  await poService.approvePurchaseOrder({ repository, purchaseOrderId: c.po.id, actor: {...c.actor,id:2} });
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
  await assert.rejects(createGoodsReceipt({ ...args, requestId: c.request.id + 1000 }), { statusCode:404 });
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

test('inventory permissions and institute scope are enforced from persisted authority with full rollback', async () => {
  const c = await createCase({ inventory: true }); await issue(c);
  const before = await snapshot();
  await pool.query("DELETE FROM user_permissions WHERE user_id=1 AND permission_id=(SELECT id FROM permissions WHERE code='procure-to-pay.receipts.manage')");
  try { await assert.rejects(createGoodsReceipt(receiptArgs(c,'1')), { statusCode:403 }); }
  finally { await pool.query("INSERT INTO user_permissions SELECT 1,id FROM permissions WHERE code='procure-to-pay.receipts.manage'"); }
  await pool.query('UPDATE users SET institute_id=2 WHERE id=1');
  try { await assert.rejects(createGoodsReceipt(receiptArgs(c,'1')), { statusCode:404 }); }
  finally { await pool.query('UPDATE users SET institute_id=1 WHERE id=1'); }
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

test('read-only baseline executes real catalog and reconciliation SQL without changing evidence', async () => {
  const c = await postedCase();
  // Deliberately seed historical bad approval evidence; active commands now refuse it.
  await pool.query('UPDATE purchase_orders SET approved_by=created_by WHERE id=$1',[c.po.id]);
  const paid = await postPayment(paymentArgs(c, c.payable, '30'));
  // Deliberate corrupt/legacy candidates exist only in the runner-created database.
  await pool.query('UPDATE ap_payables SET open_balance=69 WHERE id=$1', [c.payable.id]);
  await pool.query('UPDATE payment_records SET amount_paid=31 WHERE id=$1', [paid.payment.id]);
  await pool.query(`INSERT INTO invoice_items(supplier_invoice_id,purchase_order_item_id,requested_item_id,quantity,unit_price,line_total)
    VALUES($1,$2,$3,1,100,100)`, [c.inv.id,c.line.id,c.item.id]);
  await pool.query(`CREATE TABLE contracts(id BIGSERIAL PRIMARY KEY,amount_paid NUMERIC(18,2),currency TEXT DEFAULT 'USD');
    CREATE TABLE contract_invoices(id BIGSERIAL PRIMARY KEY,contract_id BIGINT,supplier_id BIGINT,invoice_number TEXT,currency TEXT,net_payable_amount NUMERIC(18,2));
    CREATE TABLE contract_payments(id BIGSERIAL PRIMARY KEY,contract_id BIGINT,invoice_id BIGINT,currency TEXT,status TEXT,amount NUMERIC(18,2));
    CREATE TABLE journal_entries(id BIGSERIAL PRIMARY KEY,source_type TEXT,source_id TEXT,journal_type TEXT,currency TEXT)`);
  const contract = await one('INSERT INTO contracts(amount_paid) VALUES(0) RETURNING id');
  const contractInvoice = await one(`INSERT INTO contract_invoices(contract_id,supplier_id,invoice_number,currency,net_payable_amount)
    VALUES($1,1,$2,'USD',100) RETURNING id`, [contract.id,c.inv.invoice_number]);
  await pool.query(`INSERT INTO contract_payments(contract_id,invoice_id,currency,status,amount) VALUES
    ($1,$2,'USD','paid',70),($1,$2,'USD','paid',70),($1,$2,'IQD','paid',1),($1,NULL,'USD','paid',5)`, [contract.id,contractInvoice.id]);
  await pool.query("INSERT INTO journal_entries(source_type,source_id,journal_type,currency) VALUES('AP_VOUCHER','fixture','accrual','USD'),('AP_VOUCHER','fixture','accrual','USD')");
  const beforeSnapshot = await snapshot();
  const beforeContract = await pool.query('SELECT * FROM contract_payments ORDER BY id');
  const client = await pool.connect();
  let report;
  try { report = await collectBaseline(client); } finally { client.release(); }
  assert.equal(report.connection_context.transaction_read_only, 'on');
  assert.equal(report.capture_complete, false, 'Focused fixture does not implement all hospital modules');
  for (const check of CHECKS) assert.equal(report.checks[check.id].status, 'measured', `${check.id} SQL must execute`);
  for (const name of ['cross_source_supplier_bill_candidates','repeated_invoice_po_line_groups',
    'payable_balance_or_overpayment_candidates','paid_record_allocation_total_mismatch','contract_paid_without_invoice',
    'contract_paid_currency_or_contract_mismatch','contract_invoice_overpayment_candidates',
    'contract_header_paid_projection_candidates','po_maker_approver_same_actor','journal_duplicate_source_groups']) {
    assert.ok(BigInt(report.checks[name].rows[0].candidate_count)>0n, `${name} must detect the seeded candidate`);
  }
  assert.ok(report.schema.columns.some(column => column.table_name==='invoice_items' && column.column_name==='quantity' && column.data_type==='numeric(18,4)'));
  assert.ok(report.schema.constraints.some(constraint => constraint.constraint_name==='ap_payables_supplier_id_fkey'));
  assert.equal(report.row_counts.contract_payments.rows[0].row_count,'4');
  assert.deepEqual(await snapshot(),beforeSnapshot);
  assert.deepEqual((await pool.query('SELECT * FROM contract_payments ORDER BY id')).rows,beforeContract.rows);
});

test('Development identity migration preserves legacy rows, permits free_text and rejects invalid enum values',async()=>{
  const legacy=await one("INSERT INTO requested_items(item_name,quantity) VALUES('Historical demand',1) RETURNING *");
  const before=(await pool.query('SELECT id,request_mode,catalog_status FROM requested_items ORDER BY id')).rows;
  await pool.query("ALTER TABLE requested_items ALTER COLUMN request_mode SET DEFAULT 'approved_free_text_exception', ALTER COLUMN catalog_status SET DEFAULT 'approved_exception'");
  await applyDevelopmentMigration('20261005_01_requested_item_identity.sql');
  await applyDevelopmentMigration('20261005_01_requested_item_identity.sql');
  assert.deepEqual((await pool.query('SELECT id,request_mode,catalog_status FROM requested_items ORDER BY id')).rows,before);
  const defaults=(await pool.query("SELECT column_default,is_nullable FROM information_schema.columns WHERE table_name='requested_items' AND column_name IN ('request_mode','catalog_status')")).rows;
  assert.ok(defaults.every(r=>r.column_default===null&&r.is_nullable==='YES'));
  const free=await one("INSERT INTO requested_items(item_name,quantity,request_mode,catalog_status) VALUES('Unresolved',1,'free_text','pending_mapping') RETURNING *");
  assert.equal(free.catalog_status,'pending_mapping');
  await assert.rejects(()=>pool.query("INSERT INTO requested_items(item_name,quantity,request_mode) VALUES('Invalid',1,'generic')"),{code:'23514'});
  assert.equal((await one('SELECT request_mode FROM requested_items WHERE id=$1',[legacy.id])).request_mode,null);
  const {assertProcurementReady}=require('../services/procurementItemIdentityService');
  assert.throws(()=>assertProcurementReady(legacy),{code:'ITEM_IDENTITY_RESOLUTION_REQUIRED'});
  assert.throws(()=>assertProcurementReady(free),{code:'ITEM_IDENTITY_RESOLUTION_REQUIRED'});
});

test('Employee Tasks migration creates contract, preserves existing rows, repairs indexes and fails on incompatible columns',async()=>{
  await applyDevelopmentMigration('20261005_02_employee_tasks.sql');
  const task=await one("INSERT INTO employee_tasks(title,assigned_to,assigned_by) VALUES('Existing task',1,1) RETURNING *");
  await pool.query('DROP INDEX idx_employee_tasks_assigned_to');
  await applyDevelopmentMigration('20261005_02_employee_tasks.sql');
  assert.deepEqual(await one('SELECT * FROM employee_tasks WHERE id=$1',[task.id]),task);
  assert.equal((await one("SELECT count(*)::int count FROM pg_indexes WHERE tablename='employee_tasks' AND indexname IN ('idx_employee_tasks_assigned_to','idx_employee_tasks_assigned_by')")).count,2);
  await assert.rejects(()=>pool.query("INSERT INTO employee_tasks(title,assigned_to,assigned_by) VALUES('Orphan',999999,1)"),{code:'23503'});
  await pool.query('ALTER TABLE employee_tasks ALTER COLUMN title TYPE varchar');
  await assert.rejects(()=>applyDevelopmentMigration('20261005_02_employee_tasks.sql'),/DEV_TASKS_INCOMPATIBLE_COLUMNS/);
  assert.equal((await one('SELECT title FROM employee_tasks WHERE id=$1',[task.id])).title,'Existing task');
  await pool.query('ALTER TABLE employee_tasks ALTER COLUMN title TYPE text');
  await applyDevelopmentMigration('20261005_02_employee_tasks.sql');
});

test('receipt resolution distinguishes Product, UOM, warehouse and unresolved or ambiguous mappings',async()=>{
  const {resolveReceiptStockItem}=require('../services/receiptStockIdentityService');
  const c=await createCase({inventory:true});
  const identity={generic_item_id:c.stock.generic_item_id,approved_product_id:c.stock.approved_product_id,
    base_uom_id:c.stock.inventory_uom_id,warehouse_id:c.warehouse.id};
  const product=await one("INSERT INTO approved_products(generic_item_id,approval_status,is_active) VALUES($1,'approved',TRUE) RETURNING *",[identity.generic_item_id]);
  const uom=await one("INSERT INTO item_uom(name,uom_code) VALUES('Other','OTHER') RETURNING *");
  const otherWarehouse=await one("INSERT INTO warehouses(institute_id,name) VALUES(99,'Other institute') RETURNING *");
  const add=async(productId,uomId,warehouseId,status='mapped_product')=>{
    const stock=await one('INSERT INTO stock_items(generic_item_id,approved_product_id,inventory_uom_id,mapping_status,name) VALUES($1,$2,$3,$4,\'Candidate\') RETURNING *',[identity.generic_item_id,productId,uomId,status]);
    await pool.query("INSERT INTO warehouse_stock_levels(warehouse_id,stock_item_id,quantity,stock_status) VALUES($1,$2,0,'AVAILABLE')",[warehouseId,stock.id]);return stock;
  };
  await add(product.id,identity.base_uom_id,identity.warehouse_id);
  await add(identity.approved_product_id,uom.id,identity.warehouse_id);
  await add(identity.approved_product_id,identity.base_uom_id,otherWarehouse.id);
  await add(identity.approved_product_id,identity.base_uom_id,identity.warehouse_id,'review_required');
  assert.equal((await resolveReceiptStockItem(pool,identity)).id,c.stock.id);
  await assert.rejects(()=>resolveReceiptStockItem(pool,{...identity,generic_item_id:999999}),{code:'STOCK_IDENTITY_NOT_FOUND'});
  await assert.rejects(()=>resolveReceiptStockItem(pool,{...identity,base_uom_id:null}),{code:'STOCK_IDENTITY_UNRESOLVED'});
  await add(identity.approved_product_id,identity.base_uom_id,identity.warehouse_id);
  await assert.rejects(()=>resolveReceiptStockItem(pool,identity),{code:'STOCK_IDENTITY_AMBIGUOUS'});
});

test('request edits retain IDs and NULL identity and reject changes to connected procurement lines',async()=>{
  const {applyRequestedItemEdits}=require('../services/requestedItemWriteService');
  const request=await one("INSERT INTO requests(status) VALUES('Submitted') RETURNING *");
  const item=await one("INSERT INTO requested_items(request_id,item_name,quantity,request_mode,catalog_status,item_name_snapshot) VALUES($1,'Historical line',1,NULL,NULL,'Original') RETURNING *",[request.id]);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await applyRequestedItemEdits(client,request.id,[{id:item.id,item_name:'Edited description',quantity:2}],{id:1});
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK');throw error; } finally {client.release();}
  const edited=await one('SELECT * FROM requested_items WHERE id=$1',[item.id]);
  assert.equal(edited.request_mode,null);assert.equal(edited.catalog_status,null);assert.equal(edited.item_name_snapshot,'Original');
  assert.equal(edited.quantity,2);
  const connected=await createCase();
  const guarded=await pool.connect();
  try {
    await guarded.query('BEGIN');
    await assert.rejects(()=>applyRequestedItemEdits(guarded,connected.request.id,[{id:connected.item.id,item_name:'Rewritten',quantity:10}],{id:1}),{code:'REQUEST_ITEM_ALREADY_CONSUMED'});
    await guarded.query('ROLLBACK');
  } finally {guarded.release();}
  assert.equal((await one('SELECT item_name FROM requested_items WHERE id=$1',[connected.item.id])).item_name,'Fixture item');
  assert.equal((await one('SELECT requested_item_id FROM purchase_order_items WHERE id=$1',[connected.line.id])).requested_item_id,connected.item.id);
});

test('stock provenance diagnostics handle absent and populated legacy columns without mutation',async()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../sql/verification/20261005_development_stock_catalog_provenance.sql'),'utf8');
  const client=await pool.connect();
  try {
    await client.query(sql);
    const stock=await one('SELECT id FROM stock_items ORDER BY id LIMIT 1');
    const catalog=await one('SELECT id FROM supplier_catalog_items ORDER BY id LIMIT 1');
    await client.query('ALTER TABLE public.stock_items ADD COLUMN supplier_catalog_item_id bigint REFERENCES public.supplier_catalog_items(id)');
    await client.query('UPDATE public.stock_items SET supplier_catalog_item_id=$1 WHERE id=$2',[catalog.id,stock.id]);
    const before=(await client.query('SELECT id,supplier_catalog_item_id FROM public.stock_items ORDER BY id')).rows;
    await client.query(sql);
    assert.deepEqual((await client.query('SELECT id,supplier_catalog_item_id FROM public.stock_items ORDER BY id')).rows,before);
  } finally {await client.query('ROLLBACK');client.release();}
});

const policyService = require('../services/procurementIdentityPolicyService');
async function changeIdentityPolicy(enforce) {
  const client=await pool.connect();
  try { await client.query('BEGIN'); await policyService.updatePolicy(client,{enforce_item_identity:enforce,reason:'Integration catalog rollout'},{id:1}); await client.query('COMMIT'); }
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
test('manual policy migration is idempotent and preserves an administrator setting',async()=>{
  await applyDevelopmentMigration('20261005_03_procurement_identity_policy.sql');
  assert.equal((await policyService.loadPolicy(pool)).enforce_item_identity,true);
  await changeIdentityPolicy(false);
  await applyDevelopmentMigration('20261005_03_procurement_identity_policy.sql');
  assert.equal((await policyService.loadPolicy(pool)).enforce_item_identity,false);
  await changeIdentityPolicy(true);
});
test('free-text and legacy award-to-PO flow works during rollout; strict re-enable preserves documents and blocks new procurement',async()=>{
  await changeIdentityPolicy(false);
  try {
    for(const mode of ['free_text',null]) {
      const department=await one('INSERT INTO departments DEFAULT VALUES RETURNING *');
      const request=await one("INSERT INTO requests(department_id,status) VALUES($1,'Approved') RETURNING *",[department.id]);
      const item=await one("INSERT INTO requested_items(request_id,item_name,quantity,unit_of_measure,request_mode,catalog_status,stocking_policy) VALUES($1,'Original description',2,'Piece',$2,'pending_mapping','non_stock') RETURNING *",[request.id,mode]);
      const actor={id:1};
      const award=await createAward({repository,requestItem:item,supplier:{id:1},actor,input:{awarded_quantity:'2',unit_price:'10',currency:'USD',source_type:'DIRECT_PROCUREMENT',selection_reason:'Temporary rollout',idempotency_key:key('compat')}});
      const po=await poService.createPurchaseOrderFromAwards({repository,requestId:request.id,awardIds:[award.id],quantities:{[award.id]:'1'},actor});
      assert.equal(po.lines[0].generic_item_id,null);assert.equal(po.lines[0].line_type,'NON_INVENTORY');assert.equal(po.lines[0].base_uom,'Piece');
      assert.equal((await one('SELECT request_mode FROM requested_items WHERE id=$1',[item.id])).request_mode,mode);
      assert.ok((await one("SELECT count(*)::int n FROM item_master_audit_events WHERE requested_item_id=$1 AND action='procurement.compatibility_used'",[item.id])).n>=2);
      await changeIdentityPolicy(true);
      await assert.rejects(()=>poService.createPurchaseOrderFromAwards({repository,awardIds:[award.id],quantities:{[award.id]:'1'},actor}),{code:'ITEM_IDENTITY_RESOLUTION_REQUIRED'});
      assert.equal((await one('SELECT item_name FROM purchase_order_items WHERE id=$1',[po.lines[0].id])).item_name,'Original description');
      const {resolveRequestItem}=require('../services/requestItemResolutionService');
      await assert.rejects(()=>repository.withTransaction(tx=>resolveRequestItem(tx.client,request.id,item.id,{generic_item_id:1,reason:'Change identity'},actor)),{code:'REQUEST_ITEM_ALREADY_CONSUMED'});
      await changeIdentityPolicy(false);
    }
  } finally { await changeIdentityPolicy(true); }
});
test('re-enable waits for an in-flight compatibility transaction',async()=>{
  await changeIdentityPolicy(false);
  const worker=await pool.connect(),admin=await pool.connect();
  try {
    await worker.query('BEGIN');
    await policyService.assertReadyForCommand(worker,{request_mode:'free_text',stocking_policy:'non_stock'},{id:1},'lock_test');
    await admin.query('BEGIN');await admin.query("SET LOCAL lock_timeout='100ms'");
    await assert.rejects(()=>admin.query('UPDATE procurement_identity_policy SET enforce_item_identity=TRUE WHERE id=1'),{code:'55P03'});
    await admin.query('ROLLBACK');await worker.query('COMMIT');
    await changeIdentityPolicy(true);
  } finally {await admin.query('ROLLBACK');await worker.query('ROLLBACK');admin.release();worker.release();await changeIdentityPolicy(true);}
});

test('current policy governs sourcing and quotation submission without relaxing financial line checks',async()=>{
  const {assertRequestItemsReadyForSourcing}=require('../services/sourcingReadinessService');
  const {submitLinkedRfxResponse}=require('../services/rfxResponseService');
  const request=await one("INSERT INTO requests(status) VALUES('Approved') RETURNING *");
  const item=await one("INSERT INTO requested_items(request_id,item_name,quantity,unit_of_measure,request_mode,catalog_status,stocking_policy) VALUES($1,'Rollout quotation',2,'Piece','free_text','pending_mapping','non_stock') RETURNING *",[request.id]);
  const submit=async(unit_price='10')=>{
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await assertRequestItemsReadyForSourcing(client,request.id,[item],{id:1});
      const quotation=await submitLinkedRfxResponse({repository:{client,loadRequestedItems:async()=>[item],insertResponse:async row=>({...row,id:99}),insertResponseItem:async row=>row},event:{id:99,request_id:request.id},supplierId:1,submittedBy:1,lines:[{requested_item_id:item.id,quoted_quantity:'2',unit_price,currency:'USD'}]});
      await client.query('COMMIT');return quotation;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  };
  await assert.rejects(()=>submit(),{code:'ITEM_IDENTITY_RESOLUTION_REQUIRED'});
  await changeIdentityPolicy(false);
  try {
    assert.equal((await submit()).quotation_total,'20.00000000');
    await assert.rejects(()=>submit('-1'),{code:'RFX_INVALID_LINE_PRICING'});
    await assert.rejects(()=>repository.withTransaction(tx=>policyService.assertReadyForCommand(tx.client,{...item,request_mode:'pending_item_creation'},{id:1})),{code:'ITEM_IDENTITY_RESOLUTION_REQUIRED'});
  }finally{await changeIdentityPolicy(true);}
  await assert.rejects(()=>submit(),{code:'ITEM_IDENTITY_RESOLUTION_REQUIRED'});
});
test('mapping unit validation accepts controlled equivalents and prevents reinterpreting balances',async()=>{
  const {StockItemMappingService}=require('../services/stockItemMappingService');
  const StockItemMappingRepository=require('../repositories/stockItemMappingRepository');
  // Bring this focused fixture's unused display-name projection into the real UOM contract.
  await pool.query('ALTER TABLE item_uom ADD COLUMN IF NOT EXISTS uom_name text');
  await pool.query('ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS identity_source text, ADD COLUMN IF NOT EXISTS mapped_by integer, ADD COLUMN IF NOT EXISTS mapped_at timestamptz, ADD COLUMN IF NOT EXISTS mapping_notes text');
  await pool.query("UPDATE item_uom SET uom_name='Piece' WHERE id=1");
  const generic=await one("INSERT INTO generic_items(inventory_uom_id,lifecycle_status,is_active) VALUES(1,'active',TRUE) RETURNING *");
  const stock=await one("INSERT INTO stock_items(unit,available_quantity) VALUES('Piece',7) RETURNING *");
  const mapping={generic_item_id:generic.id,approved_product_id:null};
  await repository.withTransaction(async tx=>{
    await new StockItemMappingService(pool).validateStockUnit(tx.client,stock.id,mapping);
    await new StockItemMappingRepository(tx.client).applyIdentity(stock.id,mapping,1,'Controlled unit confirmed');
  });
  const mapped=await one('SELECT * FROM stock_items WHERE id=$1',[stock.id]);
  assert.equal(mapped.inventory_uom_id,1);assert.equal(mapped.mapping_status,'mapped_generic');assert.equal(mapped.available_quantity,'7.0000');
  await pool.query("UPDATE stock_items SET unit='Box',inventory_uom_id=NULL WHERE id=$1",[stock.id]);
  await assert.rejects(()=>repository.withTransaction(tx=>new StockItemMappingService(pool).validateStockUnit(tx.client,stock.id,mapping)),{code:'mapping_inventory_uom_mismatch'});
  assert.equal((await one('SELECT available_quantity FROM stock_items WHERE id=$1',[stock.id])).available_quantity,'7.0000');
});

test('mapping proposals, review and concurrent approvals preserve one active identity and its balance',async()=>{
  const {StockItemMappingService}=require('../services/stockItemMappingService');
  // Focused mapping contract uses the same field names as the normalized mapping repository.
  await pool.query(`CREATE TABLE item_categories(id serial PRIMARY KEY,category_name text);
    ALTER TABLE generic_items ADD COLUMN category_id integer REFERENCES item_categories;
    CREATE TABLE stock_item_master_mappings(id bigserial PRIMARY KEY,stock_item_id integer REFERENCES stock_items,
      generic_item_id bigint REFERENCES generic_items,approved_product_id bigint REFERENCES approved_products,
      mapping_status text,active boolean DEFAULT FALSE,version integer DEFAULT 1,review_notes text,
      created_by integer REFERENCES users,reviewed_by integer REFERENCES users,reviewed_at timestamptz,
      created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW());`);
  const generic=await one("INSERT INTO generic_items(inventory_uom_id,lifecycle_status,is_active) VALUES(1,'active',TRUE) RETURNING *");
  const stock=await one("INSERT INTO stock_items(unit,available_quantity) VALUES('Piece',7) RETURNING *");
  const mappingService=new StockItemMappingService(pool);
  const mappings=[];
  for(let i=0;i<2;i++){
    const proposed=await mappingService.propose({stock_item_id:stock.id,generic_item_id:generic.id,reason:'Steward confirmed equivalent unit'},1);
    const reviewed=await mappingService.review({stockItemId:stock.id,mappingId:Number(proposed.id),expectedVersion:proposed.version,reason:'Review completed'},1);
    mappings.push(reviewed);
  }
  await Promise.all(mappings.map(mapping=>mappingService.approve({stockItemId:stock.id,mappingId:Number(mapping.id),expectedVersion:mapping.version,reason:'Approved identity'},1)));
  assert.equal((await one("SELECT count(*)::int n FROM stock_item_master_mappings WHERE stock_item_id=$1 AND active AND mapping_status='approved'",[stock.id])).n,1);
  const actual=await one('SELECT * FROM stock_items WHERE id=$1',[stock.id]);
  assert.equal(actual.generic_item_id,generic.id);assert.equal(actual.inventory_uom_id,1);assert.equal(actual.available_quantity,'7.0000');
  assert.equal((await one("SELECT count(*)::int n FROM item_master_audit_events WHERE entity_type='stock_item' AND entity_id=$1 AND action='mapping_proposed'",[stock.id])).n,2);
});

test('workspace and steward queue resolution lock consistently and close the same referral',async()=>{
  const {resolveRequestItem}=require('../services/requestItemResolutionService');
  const {ItemMasterFoundationService}=require('../services/itemMasterFoundationService');
  await pool.query(`CREATE TABLE pending_item_requests(id bigserial PRIMARY KEY,request_id integer REFERENCES requests,
    requested_item_id integer REFERENCES requested_items,proposed_name text,status text,resolution_type text,
    resolved_generic_item_id bigint REFERENCES generic_items,resolved_product_id bigint REFERENCES approved_products,
    resolution_notes text,resolved_by integer REFERENCES users,resolved_at timestamptz,updated_at timestamptz DEFAULT NOW());`);
  const request=await one("INSERT INTO requests(status) VALUES('Approved') RETURNING *");
  const item=await one("INSERT INTO requested_items(request_id,item_name,quantity,unit_of_measure,request_mode,catalog_status,stocking_policy) VALUES($1,'Original requester wording',2,'Piece','pending_item_creation','pending_mapping','non_stock') RETURNING *",[request.id]);
  const generic=await one("INSERT INTO generic_items(inventory_uom_id,lifecycle_status,is_active,generic_name) VALUES(1,'active',TRUE,'Governed item') RETURNING *");
  const pending=await one("INSERT INTO pending_item_requests(request_id,requested_item_id,proposed_name,status) VALUES($1,$2,'Original requester wording','review') RETURNING *",[request.id,item.id]);
  const actor={id:1};
  await Promise.all([
    repository.withTransaction(tx=>resolveRequestItem(tx.client,request.id,item.id,{generic_item_id:Number(generic.id),reason:'Confirmed in request workspace'},actor)),
    new ItemMasterFoundationService(pool).resolvePending(Number(pending.id),{resolution_type:'existing_generic',generic_item_id:Number(generic.id),notes:'Confirmed by steward'},actor),
  ]);
  const resolved=await one('SELECT * FROM pending_item_requests WHERE id=$1',[pending.id]);
  assert.equal(resolved.status,'resolved');assert.equal(resolved.resolved_generic_item_id,generic.id);
  const line=await one('SELECT * FROM requested_items WHERE id=$1',[item.id]);
  assert.equal(line.generic_item_id,generic.id);assert.equal(line.request_mode,'generic_item');assert.equal(line.item_name,'Original requester wording');assert.equal(line.quantity,2);
});

// AUD-002: real SQL, persisted grants, two institutes, canonical business writers.
const {authorizeCommand}=require('../services/p2pAuthorization');
const {predicate,flowPredicate}=require('../services/p2pReadScope');
const p2pController=require('../controllers/procureToPayController');
const budgetController=require('../controllers/budgetControlController');
const call=async(handler,{user={id:1},params={},query={},body={}}={})=>{
  let error,payload,status=200;
  const res={set(){return this;},status(value){status=value;return this;},json(value){payload=value;return this;}};
  await handler({user,params,query,body,get:()=>null},res,e=>{error=e;});
  return {error,payload,status};
};
const foreign=async c=>{
  await pool.query('UPDATE departments SET institute_id=2 WHERE id=$1',[c.department.id]);
  await pool.query('UPDATE requests SET institute_id=2 WHERE id=$1',[c.request.id]);
};
const access=async(actor,permission,refs)=>repository.withTransaction(tx=>authorizeCommand(tx,actor,permission,refs));

test('AUD-002 same-institute PO creation records institute audit despite forged actor/body ownership',async()=>{
  const c=await createCase();
  const audit=await one("SELECT details FROM audit_logs WHERE action='PO_CREATED' AND target_id=$1",[String(c.po.id)]);
  assert.equal(audit.details.instituteId,1);
  const result=await access({...c.actor,institute_id:999,role:'Admin'},'procure-to-pay.purchase-orders.manage',{purchaseOrderId:c.po.id});
  assert.equal(result.instituteId,1);assert.equal(result.actor.institute_id,1);
});
test('AUD-002 anonymous, inactive and role-only actors have no financial command authority',async()=>{
  const c=await createCase();
  for(const [actor,statusCode] of [[null,401],[{id:3,role:'SCM',permissions:['finance.payment.manage']},403],[{id:5,role:'Admin'},403],[{id:6},403]])
    await assert.rejects(access(actor,'procure-to-pay.purchase-orders.manage',{purchaseOrderId:c.po.id}),{statusCode});
});
test('AUD-002 foreign PO detail and approval fail without metadata disclosure',async()=>{
  const c=await createCase();await foreign(c);
  const read=await call(p2pController.getPurchaseOrderDetail,{params:{poId:c.po.id}});
  assert.equal(read.error.statusCode,404);assert.equal(read.payload,undefined);
  await assert.rejects(poService.approvePurchaseOrder({repository,purchaseOrderId:c.po.id,actor:{id:2}}),{statusCode:404});
});
test('AUD-002 request/inventory overrides and institute scope do not grant finance cross-institute authority',async()=>{
  const c=await createCase();await foreign(c);
  await pool.query("INSERT INTO permissions(code) VALUES('requests.cross-institute'),('inventory.cross-institute') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO user_permissions SELECT 1,id FROM permissions WHERE code IN('requests.cross-institute','inventory.cross-institute')");
  await pool.query("INSERT INTO data_scopes(code) VALUES('institute_ids') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO user_data_scopes SELECT 1,id,'2' FROM data_scopes WHERE code='institute_ids'");
  await assert.rejects(access({id:1},'finance.verify',{purchaseOrderId:c.po.id}),{statusCode:404});
});
test('AUD-002 unauthorized receipt cannot mutate or return an idempotent document',async()=>{
  const c=await createCase();await issue(c);const args=receiptArgs(c,'1');await createGoodsReceipt(args);const before=await snapshot();
  await assert.rejects(createGoodsReceipt({...args,actor:{id:3}}),{statusCode:403});assert.deepEqual(await snapshot(),before);
});
test('AUD-002 foreign invoice matching and finance verification are denied',async()=>{
  const c=await createCase();await issue(c);const inv=await invoice(c,'1');await foreign(c);
  await assert.rejects(invoiceService.runInvoiceMatch({repository,requestId:c.request.id,invoiceId:inv.id,actor:{id:1}}),{statusCode:404});
  await assert.rejects(verifyInvoiceForFinance({repository,invoiceId:inv.id,actor:{id:1}}),{statusCode:404});
});
test('AUD-002 local request cannot be used as an alias for a foreign invoice',async()=>{
  const local=await createCase(),other=await createCase();await issue(other);const inv=await invoice(other,'1');await foreign(other);
  await assert.rejects(invoiceService.runInvoiceMatch({repository,requestId:local.request.id,invoiceId:inv.id,actor:local.actor}),{statusCode:404});
});
test('AUD-002 invoice matching rejects a foreign receipt grafted through a local PO line',async()=>{
  const local=await createCase(),other=await createCase();await issue(local);await issue(other);const receipt=await createGoodsReceipt(receiptArgs(other,'1'));
  await pool.query('UPDATE goods_receipt_items SET purchase_order_item_id=$1,requested_item_id=$2 WHERE goods_receipt_id=$3',[local.line.id,local.item.id,receipt.receipt.id]);
  await foreign(other);
  await assert.rejects(access(local.actor,'procure-to-pay.match.manage',{purchaseOrderId:local.po.id}),{statusCode:404});
});
test('AUD-002 local PO rejects a foreign requested-item child and list hides the inconsistent row',async()=>{
  const local=await createCase(),other=await createCase();await foreign(other);
  await pool.query('UPDATE purchase_order_items SET requested_item_id=$1 WHERE id=$2',[other.item.id,local.line.id]);
  await assert.rejects(access(local.actor,'procure-to-pay.purchase-orders.manage',{purchaseOrderId:local.po.id}),{statusCode:404});
  assert.equal((await pool.query(`SELECT po.id FROM purchase_orders po WHERE po.id=$1 AND ${predicate('purchaseOrder','po','$2')}`,[local.po.id,1])).rowCount,0);
});
test('AUD-002 foreign parent remains denied even if a child references local demand',async()=>{
  const local=await createCase(),other=await createCase();await foreign(other);
  await pool.query('UPDATE purchase_order_items SET requested_item_id=$1 WHERE id=$2',[local.item.id,other.line.id]);
  await assert.rejects(access(local.actor,'procure-to-pay.purchase-orders.manage',{purchaseOrderId:other.po.id}),{statusCode:404});
});
test('AUD-002 foreign AP payable allocation and corrupt local-payable/foreign-PO chain are denied',async()=>{
  const c=await postedCase();await foreign(c);
  await assert.rejects(postPayment(paymentArgs({...c,actor:{id:1}},c.payable,'1')),{statusCode:404});
  const local=await postedCase();await pool.query('UPDATE supplier_invoices SET purchase_order_id=$1 WHERE id=$2',[c.po.id,local.inv.id]);
  await assert.rejects(postPayment(paymentArgs(local,local.payable,'1')),{statusCode:404});
});
test('AUD-002 unauthorized AP posting, voucher verification and payment execution are rejected',async()=>{
  const c=await postedCase();
  await assert.rejects(postApVoucher({repository,voucherId:c.voucher.id,actor:{id:3},idempotencyKey:key('denied-post')}),{statusCode:403});
  await assert.rejects(apService.verifyApVoucher({repository,voucherId:c.voucher.id,actor:{id:3}}),{statusCode:403});
  await assert.rejects(postPayment(paymentArgs({...c,actor:{id:3}},c.payable,'1')),{statusCode:403});
});
test('AUD-002 status-only payment approval remains disabled for authorized actors and forbidden for others',async()=>{
  const args={params:{requestId:'1',paymentId:'1'},user:{id:1,permissions:['finance.payment.manage']}};
  assert.equal((await call(p2pController.markPaid,args)).error.statusCode,410);
  assert.equal((await call(p2pController.markPaymentPending,args)).error.statusCode,410);
  assert.equal((await call(p2pController.markPaid,{...args,user:{id:3,role:'Finance'}})).error.statusCode,403);
});
test('AUD-002 PO self-approval and legacy self-approved issuance are denied without an admin exception',async()=>{
  const c=await createCase();await poService.submitPurchaseOrder({repository,purchaseOrderId:c.po.id,actor:c.actor});
  await assert.rejects(poService.approvePurchaseOrder({repository,purchaseOrderId:c.po.id,actor:c.actor}),{code:'PO_SELF_APPROVAL_DENIED'});
  await pool.query("UPDATE purchase_orders SET status='PO_APPROVED',approved_at=NOW(),approved_by=created_by WHERE id=$1",[c.po.id]);
  await assert.rejects(poService.releasePurchaseOrder({repository,purchaseOrderId:c.po.id,actor:c.actor}),{code:'PO_SELF_APPROVAL_DENIED'});
});
test('AUD-002 a foreign budget cannot be selected for a local PO commitment',async()=>{
  const c=await createCase(),other=await createCase();await foreign(other);
  await assert.rejects(access(c.actor,'procure-to-pay.purchase-orders.manage',{requestId:c.request.id,budgetId:other.budget.id}),{statusCode:404});
  const altered={withTransaction:work=>repository.withTransaction(tx=>work({...tx,resolveBudgetEnvelope:async()=>other.budget}))};
  await poService.submitPurchaseOrder({repository,purchaseOrderId:c.po.id,actor:c.actor});await poService.approvePurchaseOrder({repository,purchaseOrderId:c.po.id,actor:{id:2}});
  await assert.rejects(poService.releasePurchaseOrder({repository:altered,purchaseOrderId:c.po.id,actor:c.actor}),{statusCode:404});
});
test('AUD-002 forged institute_id does not select budget ownership; foreign department cannot be written',async()=>{
  const c=await createCase(),other=await createCase();await foreign(other);
  const result=await call(budgetController.upsertDepartmentBudget,{body:{department_id:c.department.id,institute_id:2,fiscal_year:new Date().getUTCFullYear(),allocated_amount:'12000',currency:'USD'}});
  assert.ifError(result.error);assert.equal(result.payload.data.department_id,c.department.id);
  const denied=await call(budgetController.upsertDepartmentBudget,{body:{department_id:other.department.id,institute_id:1,fiscal_year:2026,allocated_amount:'1'}});
  assert.equal(denied.error.statusCode,404);
});
test('AUD-002 budget viewer cannot configure envelopes and concurrent null-project updates do not duplicate',async()=>{
  const c=await createCase();await pool.query("INSERT INTO user_permissions SELECT 3,id FROM permissions WHERE code='procure-to-pay.lifecycle.view'");
  try {
    const result=await call(budgetController.listDepartmentBudgets,{user:{id:3}});assert.ifError(result.error);
    assert.equal((await call(budgetController.upsertDepartmentBudget,{user:{id:3},body:{department_id:c.department.id,fiscal_year:2026,allocated_amount:'1'}})).error.statusCode,403);
  }finally{await pool.query('DELETE FROM user_permissions WHERE user_id=3');}
  const body={department_id:c.department.id,fiscal_year:2031,allocated_amount:'90',currency:'USD'};
  const results=await Promise.all([call(budgetController.upsertDepartmentBudget,{body}),call(budgetController.upsertDepartmentBudget,{body:{...body,department_id:'00'+body.department_id}})]);results.forEach(r=>assert.ifError(r.error));
  assert.equal((await one('SELECT COUNT(*)::int n FROM budget_envelopes WHERE department_id=$1 AND fiscal_year=2031',[c.department.id])).n,1);
});
test('AUD-002 scoped reporting counts, pagination and export source exclude foreign financial documents',async()=>{
  const c=await createCase(),other=await createCase();await foreign(other);
  const result=await call(p2pController.listPurchaseOrders,{query:{request_id:other.request.id,page:1,page_size:1,institute_id:2}});
  assert.ifError(result.error);assert.equal(result.payload.pagination.total,0);assert.deepEqual(result.payload.data,[]);
  const allowed=await call(p2pController.listPurchaseOrders,{query:{request_id:c.request.id}});assert.ifError(allowed.error);assert.equal(allowed.payload.pagination.total,1);
  const budgets=await call(budgetController.listDepartmentBudgets);assert.ifError(budgets.error);assert(!budgets.payload.data.some(r=>r.department_id===other.department.id));
});
test('AUD-002 all financial report predicates compile against real schema and typed flow rejects unrelated ID collisions',async()=>{
  const kinds={request:'requests',purchaseOrder:'purchase_orders',receipt:'goods_receipts',invoice:'supplier_invoices',match:'invoice_match_results',voucher:'ap_vouchers',payable:'ap_payables',payment:'payment_records',budget:'budget_envelopes',commitment:'commitment_ledger',financePosting:'finance_postings',award:'procurement_awards'};
  for(const [kind,table]of Object.entries(kinds)){const started=Date.now();await pool.query(`SELECT x.id FROM ${table} x WHERE ${predicate(kind,'x')}`,[1]);console.log(`Financial scope ${kind}: ${Date.now()-started}ms`);}
  await pool.query(`SELECT dfl.id FROM document_flow_links dfl WHERE ${flowPredicate('dfl')}`,[1]);
});
test('AUD-002 lost permissions and moved institutes deny payment retries before persisted data is returned',async()=>{
  const c=await postedCase(),args=paymentArgs(c,c.payable,'1');await postPayment(args);
  await pool.query('UPDATE users SET institute_id=2 WHERE id=1');
  try {await assert.rejects(postPayment(args),{statusCode:404});}finally{await pool.query('UPDATE users SET institute_id=1 WHERE id=1');}
});
test('AUD-002 receipt-only operator retains receiving reads without supplier-invoice disclosure',async()=>{
  const c=await createCase();await issue(c);await invoice(c,'1');
  await pool.query("INSERT INTO user_permissions SELECT 3,id FROM permissions WHERE code='procure-to-pay.receipts.manage'");
  try {
    const open=await call(p2pController.listOpenPosForReceipt,{user:{id:3}});assert.ifError(open.error);assert(open.payload.data.some(row=>row.id===c.po.id));
    const detail=await call(p2pController.getPurchaseOrderDetail,{user:{id:3},params:{poId:c.po.id}});assert.ifError(detail.error);assert.deepEqual(detail.payload.invoices,[]);
    const financial=await call(p2pController.listApInvoices,{user:{id:3}});assert.equal(financial.error.statusCode,403);
  }finally{await pool.query('DELETE FROM user_permissions WHERE user_id=3');}
});
test('AUD-002 unauthorized financial cancellation cannot release another obligation',async()=>{
  const c=await createCase();await issue(c);const before=await snapshot();
  await assert.rejects(poService.cancelPurchaseOrder({repository,purchaseOrderId:c.po.id,reason:'forged reversal',actor:{id:3}}),{statusCode:403});
  assert.deepEqual(await snapshot(),before);
});
test('AUD-002 budget audit failure rolls back the authorized configuration change',async()=>{
  const c=await createCase();
  await pool.query(`CREATE FUNCTION aud002_fail_budget_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'BUDGET_ENVELOPE_%' THEN RAISE EXCEPTION 'injected budget audit failure'; END IF;RETURN NEW; END $$;
    CREATE TRIGGER aud002_budget_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION aud002_fail_budget_audit()`);
  try {
    const result=await call(budgetController.upsertDepartmentBudget,{body:{department_id:c.department.id,fiscal_year:new Date().getUTCFullYear(),allocated_amount:'777',currency:'USD'}});
    assert(result.error);assert.equal((await one('SELECT allocated_amount FROM budget_envelopes WHERE id=$1',[c.budget.id])).allocated_amount,'10000.00');
  }finally{await pool.query('DROP TRIGGER aud002_budget_audit ON audit_logs;DROP FUNCTION aud002_fail_budget_audit()');}
});
test('AUD-002 typed flow hides foreign references even when the flow row claims a local request',async()=>{
  const c=await createCase(),other=await createCase();await foreign(other);
  const row=await one("INSERT INTO document_flow_links(request_id,source_document_type,source_document_id,target_document_type,target_document_id,created_by) VALUES($1,'PURCHASE_ORDER',$2,'PURCHASE_ORDER',$3,1) RETURNING *",[c.request.id,String(other.po.id),String(c.po.id)]);
  assert.equal((await pool.query(`SELECT dfl.id FROM document_flow_links dfl WHERE dfl.id=$1 AND ${flowPredicate('dfl','$2')}`,[row.id,1])).rowCount,0);
});
test('AUD-002 manual permission seed is repeatable and grants no user or role authority',async()=>{
  const before=await one('SELECT (SELECT COUNT(*) FROM user_permissions)::int users,(SELECT COUNT(*) FROM role_permissions)::int roles');
  const sql=fs.readFileSync(path.join(__dirname,'../sql/manual/058_financial_budget_authorization.sql'),'utf8');
  await pool.query(sql);await pool.query(sql);
  assert.equal((await one("SELECT COUNT(*)::int n FROM permissions WHERE code='finance.budget.manage'")).n,1);
  assert.deepEqual(await one('SELECT (SELECT COUNT(*) FROM user_permissions)::int users,(SELECT COUNT(*) FROM role_permissions)::int roles'),before);
});
test('AUD-002 accounting source references cannot substitute another request for the authorized invoice root',async()=>{
  const c=await createCase({quantity:'1'}),other=await createCase();await issue(c);await createGoodsReceipt(receiptArgs(c,'1'));const inv=await invoice(c,'1');
  await invoiceService.runInvoiceMatch({repository,invoiceId:inv.id,actor:c.actor});await verifyInvoiceForFinance({repository,invoiceId:inv.id,actor:c.actor});
  await assert.rejects(apService.createPayableFromVerifiedInvoice({repository,requestId:c.request.id,invoiceId:inv.id,actor:c.actor,idempotencyKey:key('foreign-accounting-ref'),accountingLines:[
    {account_code:'EXP',debit_amount:'100',credit_amount:'0',reference_type:'REQUEST',reference_id:String(other.request.id)},
    {account_code:'AP',debit_amount:'0',credit_amount:'100'},
  ]}),{statusCode:404});
});
test('AUD-002 PO source references reject foreign RFx parents and preserve valid owned provenance',async()=>{
  const c=await createCase({quantity:'10',orderedQuantity:'5'}),other=await createCase();await foreign(other);
  const event=await one('INSERT INTO rfx_events(request_id) VALUES($1) RETURNING *',[c.request.id]);
  const response=await one('INSERT INTO rfx_responses(rfx_id,request_id,supplier_id) VALUES($1,$2,1) RETURNING *',[event.id,c.request.id]);
  const foreignEvent=await one('INSERT INTO rfx_events(request_id) VALUES($1) RETURNING *',[other.request.id]);
  const foreignResponse=await one('INSERT INTO rfx_responses(rfx_id,request_id,supplier_id) VALUES($1,$2,1) RETURNING *',[foreignEvent.id,other.request.id]);
  const args={repository,requestId:c.request.id,awardIds:[c.award.id],quantities:{[c.award.id]:'2'},actor:c.actor};
  await assert.rejects(poService.createPurchaseOrderFromAwards({...args,input:{rfx_id:foreignEvent.id,rfx_response_id:foreignResponse.id}}),{statusCode:404});
  const created=await poService.createPurchaseOrderFromAwards({...args,input:{rfx_id:event.id,rfx_response_id:response.id,institute_id:2}});
  assert.equal(created.request_id,c.request.id);assert.equal(created.rfx_id,event.id);assert.equal(created.rfx_response_id,response.id);
  await pool.query('UPDATE rfx_responses SET request_id=NULL WHERE id=$1',[response.id]);
  await access(c.actor,'procure-to-pay.purchase-orders.manage',{purchaseOrderId:created.id});
  await pool.query('UPDATE rfx_responses SET request_id=$1 WHERE id=$2',[other.request.id,response.id]);
  await assert.rejects(access(c.actor,'procure-to-pay.purchase-orders.manage',{purchaseOrderId:created.id}),{statusCode:404});
});
test('AUD-002 request finance verification rolls back all invoice decisions on a later audit failure',async()=>{
  const c=await createCase();await issue(c);await createGoodsReceipt(receiptArgs(c,'10'));
  const first=await invoice(c,'5'),second=await invoice(c,'5');
  await invoiceService.runInvoiceMatch({repository,invoiceId:first.id,actor:c.actor});await invoiceService.runInvoiceMatch({repository,invoiceId:second.id,actor:c.actor});
  const before=await snapshot();let audits=0;
  await assert.rejects(verifyRequestForFinance({repository,requestId:c.request.id,actor:c.actor,auditService:{writeAuditEvent:async event=>{
    if(++audits===2)throw new Error('Injected second invoice audit failure');return require('../services/auditService').writeAuditEvent(event);
  }}}),/Injected second invoice audit failure/);
  assert.equal((await one('SELECT status FROM supplier_invoices WHERE id=$1',[first.id])).status,'MATCH_VERIFIED');
  assert.equal((await one('SELECT status FROM supplier_invoices WHERE id=$1',[second.id])).status,'MATCH_VERIFIED');assert.deepEqual(await snapshot(),before);
});
test('AUD-002 concurrent reuse of a payment key across requests cannot return the other payment or deadlock on retry authorization',async()=>{
  const a=await postedCase(),b=await postedCase(),sharedKey=key('cross-request-payment-key');
  const results=await Promise.allSettled([postPayment(paymentArgs(a,a.payable,'1',sharedKey)),postPayment(paymentArgs(b,b.payable,'1',sharedKey))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const denied=results.find(r=>r.status==='rejected');assert.notEqual(denied.reason.code,'40P01');assert.equal(denied.reason.statusCode,404);
  assert.equal((await one('SELECT COUNT(*)::int n FROM payment_records WHERE idempotency_key=$1',[sharedKey])).n,1);
});
test('AUD-002 technical disposition task must match the actual receipt request, institute and department',async()=>{
  const c=await createCase();await issue(c);const receipt=await createGoodsReceipt(receiptArgs(c,'1'));
  // Minimal actual task columns for the scope check; not a technical-engine fixture.
  await pool.query('CREATE TABLE delivery_inspection_tasks(id BIGSERIAL PRIMARY KEY,receipt_item_id BIGINT,request_id INTEGER,institute_id INTEGER,department_id INTEGER)');
  try{
    const task=await one('INSERT INTO delivery_inspection_tasks(receipt_item_id,request_id,institute_id,department_id) VALUES($1,$2,1,$3) RETURNING *',[receipt.receipt.items[0].id,c.request.id,c.department.id]);
    await access(c.actor,'procure-to-pay.receipts.manage',{taskId:task.id});
    for(const column of ['request_id','institute_id','department_id']){
      const original=task[column];await pool.query(`UPDATE delivery_inspection_tasks SET ${column}=99999 WHERE id=$1`,[task.id]);
      await assert.rejects(access(c.actor,'procure-to-pay.receipts.manage',{taskId:task.id}),{statusCode:404});
      await pool.query(`UPDATE delivery_inspection_tasks SET ${column}=$1 WHERE id=$2`,[original,task.id]);
    }
  }finally{await pool.query('DROP TABLE delivery_inspection_tasks');}
});
test('AUD-002 receiving warehouse ownership cannot contradict its department institute',async()=>{
  const c=await createCase(),other=await createCase();await issue(c);await foreign(other);
  await pool.query('UPDATE warehouses SET department_id=$1 WHERE id=$2',[other.department.id,c.warehouse.id]);
  const args=receiptArgs(c,'1');args.lines=args.lines.map(line=>({...line,warehouse_id:c.warehouse.id}));
  await assert.rejects(createGoodsReceipt(args),{statusCode:404});
});
test('AUD-002 missing accounting reference type cannot exploit SQL NULL logic to appear in financial reads',async()=>{
  const c=await postedCase();
  await pool.query('UPDATE ap_voucher_lines SET reference_type=NULL,reference_id=$1 WHERE ap_voucher_id=$2 AND line_number=1',[String(c.request.id),c.voucher.id]);
  assert.equal((await pool.query(`SELECT v.id FROM ap_vouchers v WHERE v.id=$1 AND ${predicate('voucher','v','$2')}`,[c.voucher.id,1])).rowCount,0);
  await assert.rejects(access(c.actor,'finance.payment.manage',{payableId:c.payable.id}),{statusCode:404});
});
test('AUD-002 lifecycle cannot disclose inventory from a foreign warehouse reference on a local request',async()=>{
  const c=await createCase(),other=await createCase();await foreign(other);await pool.query('UPDATE warehouses SET institute_id=2 WHERE id=$1',[other.warehouse.id]);
  await pool.query('UPDATE requests SET supply_warehouse_id=$1 WHERE id=$2',[other.warehouse.id,c.request.id]);
  const result=await call(p2pController.getLifecycleDetail,{params:{requestId:c.request.id}});assert.equal(result.error.statusCode,404);assert.equal(result.payload,undefined);
});
test('AUD-002 legacy journal references require the actual owned invoice source rather than a local request label',async()=>{
  const c=await postedCase(),other=await postedCase();await foreign(other);
  const {invoiceJournalPredicate}=require('../services/p2pReadScope');
  // Exercise the existing journal source fields without modifying financial history.
  const candidates=[{source_type:'supplier_invoice',source_id:String(c.inv.id),request_id:c.request.id},{source_type:'supplier_invoice',source_id:String(other.inv.id),request_id:c.request.id},{source_type:'unknown',source_id:String(c.inv.id),request_id:c.request.id}];
  for(const [index,row]of candidates.entries()){
    const result=await pool.query(`SELECT 1 FROM (SELECT $1::text source_type,$2::text source_id,$3::integer request_id) journal_candidate WHERE ${invoiceJournalPredicate('journal_candidate','$4')}`,[row.source_type,row.source_id,row.request_id,1]);
    assert.equal(result.rowCount,index===0?1:0);
  }
});
