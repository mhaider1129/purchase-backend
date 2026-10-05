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

test('read-only baseline executes real catalog and reconciliation SQL without changing evidence', async () => {
  const c = await postedCase();
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
