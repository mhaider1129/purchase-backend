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
    (request_id,request_item_id,supplier_id,awarded_quantity,unit_price,currency,source_type,source_id,selection_reason,actor_id,idempotency_key,payload_fingerprint,status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACTIVE') RETURNING *`,
  [a.request_id,a.request_item_id,a.supplier_id,a.awarded_quantity,a.unit_price,a.currency,a.source_type,a.source_id,a.selection_reason,a.actor_id,a.idempotency_key,a.payload_fingerprint]),
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
  loadPurchaseOrderLines: async (id) => (await client.query('SELECT * FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY id',[id])).rows,
  loadSupplier: (id) => one(client, 'SELECT * FROM suppliers WHERE id=$1', [id]),
  async loadSupplierEligibilityFacts(id) {
    const supplier = await one(client, 'SELECT * FROM suppliers WHERE id=$1', [id]);
    const complianceArtifacts = (await client.query(`SELECT id,artifact_type,name,expiry_date,status,blocked
      FROM supplier_compliance_artifacts WHERE supplier_id=$1
      AND status='active' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE) ORDER BY id`, [id])).rows;
    const evaluationFacts = (await client.query(`SELECT id,evaluation_date,overall_score,compliance_score,weighted_overall_score
      FROM supplier_evaluations WHERE supplier_id=$1 ORDER BY evaluation_date DESC,id DESC`, [id])).rows;
    return {
      supplier,
      complianceBlocked: complianceArtifacts.some((artifact) => artifact.blocked === true),
      complianceArtifacts,
      evaluationFacts,
      deferredChecks: ['CATEGORY_QUALIFICATION_NOT_AVAILABLE', 'BLACKLIST_REGISTRY_NOT_AVAILABLE'],
    };
  },
  resolveBudgetEnvelope: (po) => one(client, `SELECT be.* FROM requests r JOIN budget_envelopes be
    ON be.department_id=r.department_id AND COALESCE(be.project_id::text,'')=COALESCE(r.project_id::text,'')
    WHERE r.id=$1 AND be.currency=$2 AND be.fiscal_year=EXTRACT(YEAR FROM CURRENT_DATE)::integer
    ORDER BY be.id LIMIT 1`, [po.request_id, po.currency]),
  markPurchaseOrderSubmitted: (id,route) => one(client,"UPDATE purchase_orders SET status='PO_PENDING_APPROVAL',approval_required=TRUE,approval_route=COALESCE($2,approval_route,'SCM_APPROVAL_AUTHORITY'),updated_at=NOW() WHERE id=$1 RETURNING *",[id,route||null]),
  markPurchaseOrderApproved: (id,actorId) => one(client,"UPDATE purchase_orders SET status='PO_APPROVED',approval_required=TRUE,approved_by=$2,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[id,actorId]),
  markPurchaseOrderIssued: (id,t,actorId) => one(client,"UPDATE purchase_orders SET total_amount=$2,status='PO_ISSUED',issued_at=NOW(),issue_event_at=NOW(),issued_to_supplier_at=NOW(),issued_by=$3,updated_at=NOW() WHERE id=$1 RETURNING *",[id,t.grand_total,actorId]),
  markPurchaseOrderCancelled: (id,reason) => one(client,"UPDATE purchase_orders SET status='PO_CANCELLED',cancellation_reason=$2,updated_at=NOW() WHERE id=$1 RETURNING *",[id,reason]),
  hasPurchaseOrderReceipts: async (id) => Boolean(await one(client, `SELECT 1 FROM goods_receipts gr JOIN goods_receipt_items gri ON gri.goods_receipt_id=gr.id
    WHERE gr.purchase_order_id=$1 AND COALESCE(gri.received_quantity,0)>0 LIMIT 1`, [id])),

  lockBudgetEnvelope: (id) => one(client,'SELECT * FROM budget_envelopes WHERE id=$1 FOR UPDATE',[id]),
  sumActiveEncumbrances: async (id) => (await one(client,"SELECT COALESCE(SUM(amount),0)::text amount FROM commitment_ledger WHERE budget_envelope_id=$1 AND stage='encumbrance' AND state='ACTIVE'",[id])).amount,
  findCommitmentByIdempotency: (key) => one(client,'SELECT * FROM commitment_ledger WHERE idempotency_key=$1',[key]),
  insertEncumbrance: (c) => one(client,`INSERT INTO commitment_ledger (request_id,budget_envelope_id,purchase_order_id,stage,state,amount,currency,source_type,source_id,idempotency_key,actor_id)
    VALUES ($1,$2,$3,'encumbrance','ACTIVE',$4,$5,'purchase_order',$3::text,$6,$7) RETURNING *`,[c.request_id,c.budget_envelope_id,c.purchase_order_id,c.amount,c.currency,c.idempotency_key,c.actor_id]),
  releaseCommitment: (id) => one(client,"UPDATE commitment_ledger SET state='RELEASED' WHERE id=$1 AND stage='encumbrance' AND state='ACTIVE' RETURNING *",[id]),

  lockPurchaseOrderLine: (id) => one(client,'SELECT * FROM purchase_order_items WHERE id=$1 FOR UPDATE',[id]),
  lockPurchaseOrderLines: async (ids) => (await client.query('SELECT * FROM purchase_order_items WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[ids])).rows,
  loadCumulativeReceipts: async (id) => (await one(client,"SELECT COALESCE(SUM(gri.received_quantity),0)::text quantity FROM goods_receipt_items gri WHERE gri.purchase_order_item_id=$1",[id])).quantity,
  findReceiptByIdempotency: (key) => one(client,'SELECT * FROM goods_receipts WHERE idempotency_key=$1',[key]),
  loadReceiptWithLines: async (id) => { const receipt=await one(client,'SELECT * FROM goods_receipts WHERE id=$1',[id]); if(!receipt)return null; receipt.items=(await client.query('SELECT * FROM goods_receipt_items WHERE goods_receipt_id=$1 ORDER BY id',[id])).rows; return receipt; },
  insertGoodsReceipt: (r) => one(client,`WITH identity AS (SELECT nextval(pg_get_serial_sequence('goods_receipts','id')) AS id)
    INSERT INTO goods_receipts (id,purchase_order_id,request_id,idempotency_key,payload_fingerprint,receipt_number,warehouse_location,received_at,received_by,notes,discrepancy_notes)
    SELECT id,$1,$2,$3,$4,'GR-'||id,$5,COALESCE($6,NOW()),$7,$8,$9 FROM identity RETURNING *`,[r.purchase_order_id,r.request_id,r.idempotency_key,r.payload_fingerprint,r.warehouse_location||null,r.received_at,r.received_by,r.notes||null,r.discrepancy_notes||null]),
  insertGoodsReceiptLine: (l) => one(client,`INSERT INTO goods_receipt_items (goods_receipt_id,purchase_order_item_id,requested_item_id,item_name,ordered_quantity,received_quantity,damaged_quantity,short_quantity,unit_price,line_notes,batch_number,lot_number,serial_number,expiry_date,warehouse_id,stock_status,source_uom,base_uom,stock_item_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,[l.goods_receipt_id,l.purchase_order_item_id,l.requested_item_id,l.item_name,l.ordered_quantity,l.received_quantity,l.damaged_quantity||0,l.short_quantity||0,l.unit_price,l.line_notes||null,l.batch_number||null,l.lot_number||null,l.serial_number||null,l.expiry_date||null,l.warehouse_id||null,l.stock_status||'AVAILABLE',l.source_uom||null,l.base_uom||null,l.stock_item_id||null]),
  synchronizePurchaseOrderLineReceivedQuantity: (id) => one(client,`UPDATE purchase_order_items poi SET received_quantity=(SELECT COALESCE(SUM(gri.received_quantity-gri.damaged_quantity-gri.short_quantity),0) FROM goods_receipt_items gri WHERE gri.purchase_order_item_id=poi.id) WHERE poi.id=$1 RETURNING *`,[id]),
  calculatePurchaseOrderReceiptTotals: (id) => one(client,`SELECT COALESCE(SUM(quantity),0)::text ordered_quantity,COALESCE(SUM(received_quantity),0)::text received_quantity FROM purchase_order_items WHERE purchase_order_id=$1`,[id]),
  markPurchaseOrderPartiallyReceived: (id) => one(client,"UPDATE purchase_orders SET status='PO_PARTIAL',updated_at=NOW() WHERE id=$1 RETURNING *",[id]),
  markPurchaseOrderDelivered: (id) => one(client,"UPDATE purchase_orders SET status='PO_DELIVERED',updated_at=NOW() WHERE id=$1 RETURNING *",[id]),
  loadWarehouseScope: (id) => one(client,'SELECT * FROM warehouses WHERE id=$1',[id]),
  resolveReceiptStockItem: (requestedItemId) => one(client,`SELECT si.* FROM requested_items ri JOIN stock_items si ON si.generic_item_id=ri.generic_item_id WHERE ri.id=$1 ORDER BY si.id LIMIT 1`,[requestedItemId]),

  lockSupplierInvoiceIdentity: async (supplierId,number) => { await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${supplierId}:${String(number).toLowerCase()}`]); },
  loadInvoicePurchaseOrder: (id) => one(client,'SELECT * FROM purchase_orders WHERE id=$1',[id]),
  findInvoiceByIdempotency: (key) => one(client,'SELECT * FROM supplier_invoices WHERE idempotency_key=$1',[key]),
  insertSupplierInvoice: (i) => one(client,`INSERT INTO supplier_invoices (supplier_id,purchase_order_id,invoice_number,invoice_date,currency,idempotency_key,status,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,'SUBMITTED',$7) RETURNING *`,[i.supplier_id,i.purchase_order_id,i.invoice_number,i.invoice_date,i.currency,i.idempotency_key,i.created_by]),
  insertSupplierInvoiceLine: (l) => one(client,'INSERT INTO invoice_items (supplier_invoice_id,purchase_order_item_id,requested_item_id,description,quantity,unit_price,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[l.supplier_invoice_id,l.purchase_order_item_id,l.requested_item_id,l.description,l.quantity,l.unit_price,l.line_total]),
  loadPriorValidInvoices: async (poId,excludeId) => (await client.query("SELECT ii.* FROM invoice_items ii JOIN supplier_invoices si ON si.id=ii.supplier_invoice_id WHERE si.purchase_order_id=$1 AND si.id<>$2 AND si.status NOT IN ('DECLINED','CANCELLED')",[poId,excludeId])).rows,
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
});

const createTransactionalP2PRepository = (pool) => ({
  async withTransaction(work) { const client=await pool.connect(); try { await client.query('BEGIN'); const result=await work(createConnectedP2PRepository(client)); await client.query('COMMIT'); return result; } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } },
});

module.exports = { createConnectedP2PRepository, createTransactionalP2PRepository };