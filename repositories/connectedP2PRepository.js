'use strict';

// Concrete Phase 4 PostgreSQL gateway.  A repository is deliberately bound to
// one pg client so locks and the writes they protect cannot escape a transaction.
const one = async (client, sql, values) => (await client.query(sql, values)).rows[0] || null;

const createConnectedP2PRepository = (client) => ({
  client,

  lockRequestItem: (id) => one(client, 'SELECT * FROM requested_items WHERE id=$1 FOR UPDATE', [id]),
  loadActiveAwards: async (requestItemId) => (await client.query("SELECT * FROM procurement_awards WHERE request_item_id=$1 AND status='ACTIVE' ORDER BY id", [requestItemId])).rows,
  findAwardByIdempotency: (key) => one(client, 'SELECT * FROM procurement_awards WHERE idempotency_key=$1', [key]),
  insertAward: (a) => one(client, `INSERT INTO procurement_awards
    (request_id,request_item_id,supplier_id,awarded_quantity,unit_price,currency,source_type,source_id,idempotency_key,status,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10) RETURNING *`,
  [a.request_id,a.request_item_id,a.supplier_id,a.awarded_quantity,a.unit_price,a.currency,a.source_type,a.source_id,a.idempotency_key,a.created_by]),
  lockAwards: async (ids) => (await client.query('SELECT * FROM procurement_awards WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids])).rows,
  getAwardConversion: (awardId) => one(client, `SELECT a.awarded_quantity::text,
    COALESCE(SUM(CASE WHEN po.status NOT IN ('PO_CANCELLED','CANCELLED') THEN poi.quantity ELSE 0 END),0)::text ordered_quantity,
    (a.awarded_quantity-COALESCE(SUM(CASE WHEN po.status NOT IN ('PO_CANCELLED','CANCELLED') THEN poi.quantity ELSE 0 END),0))::text remaining_quantity
    FROM procurement_awards a LEFT JOIN purchase_order_items poi ON poi.award_id=a.id
    LEFT JOIN purchase_orders po ON po.id=poi.purchase_order_id WHERE a.id=$1 GROUP BY a.id`, [awardId]),

  insertPurchaseOrderHeader: (p) => one(client, `INSERT INTO purchase_orders
    (request_id,supplier_id,currency,status,expected_delivery_date,delivery_location,budget_cost_center,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [p.request_id,p.supplier_id,p.currency,p.status,p.expected_delivery_date||null,p.delivery_location||null,p.budget_cost_center||null,p.created_by]),
  insertPurchaseOrderLine: (l) => one(client, `INSERT INTO purchase_order_items
    (purchase_order_id,requested_item_id,award_id,quantity,unit_price,price_source_type,price_source_id,line_type)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [l.purchase_order_id,l.requested_item_id,l.award_id,l.quantity,l.unit_price,l.price_source_type,l.price_source_id,l.line_type||'NON_INVENTORY']),
  lockPurchaseOrder: (id) => one(client, 'SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [id]),
  loadPurchaseOrder: async (id) => { const header=await one(client,'SELECT * FROM purchase_orders WHERE id=$1',[id]); if (!header) return null; header.lines=(await client.query('SELECT * FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY id',[id])).rows; return header; },
  updatePurchaseOrderTotals: (id,t) => one(client,'UPDATE purchase_orders SET subtotal=$2,tax_amount=$3,total_amount=$4,updated_at=NOW() WHERE id=$1 RETURNING *',[id,t.subtotal,t.tax_amount||'0',t.grand_total]),
  releasePurchaseOrder: (id,t) => one(client,"UPDATE purchase_orders SET subtotal=$2,total_amount=$3,status='PO_ISSUED',issued_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[id,t.subtotal,t.grand_total]),

  lockBudgetEnvelope: (id) => one(client,'SELECT * FROM budget_envelopes WHERE id=$1 FOR UPDATE',[id]),
  sumActiveEncumbrances: async (id) => (await one(client,"SELECT COALESCE(SUM(amount),0)::text amount FROM commitment_ledger WHERE budget_envelope_id=$1 AND commitment_type='ENCUMBRANCE' AND status='ACTIVE'",[id])).amount,
  findCommitmentByIdempotency: (key) => one(client,'SELECT * FROM commitment_ledger WHERE idempotency_key=$1',[key]),
  insertEncumbrance: (c) => one(client,`INSERT INTO commitment_ledger (budget_envelope_id,purchase_order_id,commitment_type,status,amount,idempotency_key,created_by)
    VALUES ($1,$2,'ENCUMBRANCE','ACTIVE',$3,$4,$5) RETURNING *`,[c.budget_envelope_id,c.purchase_order_id,c.amount,c.idempotency_key,c.created_by]),
  releaseCommitment: (id,actorId) => one(client,"UPDATE commitment_ledger SET status='RELEASED',released_at=NOW(),released_by=$2 WHERE id=$1 AND status='ACTIVE' RETURNING *",[id,actorId]),

  lockPurchaseOrderLine: (id) => one(client,'SELECT * FROM purchase_order_items WHERE id=$1 FOR UPDATE',[id]),
  loadCumulativeReceipts: async (id) => (await one(client,"SELECT COALESCE(SUM(grl.accepted_quantity),0)::text quantity FROM goods_receipt_lines grl JOIN goods_receipts gr ON gr.id=grl.goods_receipt_id WHERE grl.purchase_order_item_id=$1 AND gr.status<>'CANCELLED'",[id])).quantity,
  findReceiptByIdempotency: (key) => one(client,'SELECT * FROM goods_receipts WHERE idempotency_key=$1',[key]),
  insertGoodsReceipt: (r) => one(client,'INSERT INTO goods_receipts (purchase_order_id,request_id,idempotency_key,received_at,received_by,status) VALUES ($1,$2,$3,COALESCE($4,NOW()),$5,\'POSTED\') RETURNING *',[r.purchase_order_id,r.request_id,r.idempotency_key,r.received_at,r.received_by]),
  insertGoodsReceiptLine: (l) => one(client,'INSERT INTO goods_receipt_lines (goods_receipt_id,purchase_order_item_id,accepted_quantity,line_type) VALUES ($1,$2,$3,$4) RETURNING *',[l.goods_receipt_id,l.purchase_order_item_id,l.accepted_quantity,l.line_type]),

  lockSupplierInvoiceIdentity: async (supplierId,number) => { await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${supplierId}:${String(number).toLowerCase()}`]); },
  loadInvoicePurchaseOrder: (id) => one(client,'SELECT * FROM purchase_orders WHERE id=$1',[id]),
  findInvoiceByIdempotency: (key) => one(client,'SELECT * FROM supplier_invoices WHERE idempotency_key=$1',[key]),
  insertSupplierInvoice: (i) => one(client,`INSERT INTO supplier_invoices (supplier_id,purchase_order_id,invoice_number,invoice_date,currency,idempotency_key,status,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,'SUBMITTED',$7) RETURNING *`,[i.supplier_id,i.purchase_order_id,i.invoice_number,i.invoice_date,i.currency,i.idempotency_key,i.created_by]),
  insertSupplierInvoiceLine: (l) => one(client,'INSERT INTO supplier_invoice_items (supplier_invoice_id,purchase_order_item_id,quantity,unit_price) VALUES ($1,$2,$3,$4) RETURNING *',[l.supplier_invoice_id,l.purchase_order_item_id,l.quantity,l.unit_price]),
  loadPriorValidInvoices: async (poId,excludeId) => (await client.query("SELECT sii.* FROM supplier_invoice_items sii JOIN supplier_invoices si ON si.id=sii.supplier_invoice_id WHERE si.purchase_order_id=$1 AND si.id<>$2 AND si.status NOT IN ('DECLINED','CANCELLED')",[poId,excludeId])).rows,
  insertMatchResult: (m) => one(client,'INSERT INTO invoice_match_results (supplier_invoice_id,policy,match_status,variances,matched_by,matched_at) VALUES ($1,$2,$3,$4::jsonb,$5,NOW()) RETURNING *',[m.supplier_invoice_id,m.policy,m.match_status,JSON.stringify(m.variances),m.actor_id]),
  updateInvoiceLifecycle: (id,status) => one(client,'UPDATE supplier_invoices SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,status]),

  lockInvoice: (id) => one(client,'SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE',[id]),
  sumPostedPayments: async (id) => (await one(client,"SELECT COALESCE(SUM(amount),0)::text amount FROM payment_records WHERE supplier_invoice_id=$1 AND status='POSTED'",[id])).amount,
  findPaymentByIdempotency: (key) => one(client,'SELECT * FROM payment_records WHERE idempotency_key=$1',[key]),
  insertPaymentRecord: (p) => one(client,"INSERT INTO payment_records (supplier_invoice_id,amount,status,idempotency_key,paid_by,paid_at) VALUES ($1,$2,'POSTED',$3,$4,NOW()) RETURNING *",[p.supplier_invoice_id,p.amount,p.idempotency_key,p.paid_by]),
  updateInvoicePaymentState: (id,status) => one(client,'UPDATE supplier_invoices SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,status]),

  // Names consumed by purchaseOrderService; still entity-specific SQL above.
  async findByIdempotencyKey(key){ return this.findAwardByIdempotency(key); },
  async sumActiveAwards(id){ return (await one(client,"SELECT COALESCE(SUM(awarded_quantity),0)::text amount FROM procurement_awards WHERE request_item_id=$1 AND status='ACTIVE'",[id])).amount; },
  insert(a){ return this.insertAward(a); },
  insertHeader(p){ return this.insertPurchaseOrderHeader(p); },
  insertLine(l){ return this.insertPurchaseOrderLine(l); },
  release(id,t){ return this.releasePurchaseOrder(id,t); },
});

const createTransactionalP2PRepository = (pool) => ({
  async withTransaction(work) { const client=await pool.connect(); try { await client.query('BEGIN'); const result=await work(createConnectedP2PRepository(client)); await client.query('COMMIT'); return result; } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } },
});

module.exports = { createConnectedP2PRepository, createTransactionalP2PRepository };