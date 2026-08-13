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
  markPurchaseOrderClosed: (id,reason) => one(client,"UPDATE purchase_orders SET status='PO_CLOSED',amendment_reason=COALESCE($2,amendment_reason),updated_at=NOW() WHERE id=$1 RETURNING *",[id,reason]),
  hasPurchaseOrderReceipts: async (id) => Boolean(await one(client, `SELECT 1 FROM goods_receipts gr JOIN goods_receipt_items gri ON gri.goods_receipt_id=gr.id
    WHERE gr.purchase_order_id=$1 AND COALESCE(gri.received_quantity,0)>0 LIMIT 1`, [id])),

  lockBudgetEnvelope: (id) => one(client,'SELECT * FROM budget_envelopes WHERE id=$1 FOR UPDATE',[id]),
  sumActiveEncumbrances: async (id) => (await one(client,"SELECT COALESCE(SUM(amount),0)::text amount FROM commitment_ledger WHERE budget_envelope_id=$1 AND stage='encumbrance' AND state='ACTIVE'",[id])).amount,
  findCommitmentByIdempotency: (key) => one(client,'SELECT * FROM commitment_ledger WHERE idempotency_key=$1',[key]),
  insertEncumbrance: (c) => one(client,`INSERT INTO commitment_ledger (request_id,budget_envelope_id,purchase_order_id,stage,state,amount,currency,source_type,source_id,idempotency_key,actor_id)
    VALUES ($1,$2,$3,'encumbrance','ACTIVE',$4,$5,'purchase_order',$3::text,$6,$7) RETURNING *`,[c.request_id,c.budget_envelope_id,c.purchase_order_id,c.amount,c.currency,c.idempotency_key,c.actor_id]),
  releaseCommitment: (id) => one(client,"UPDATE commitment_ledger SET state='RELEASED' WHERE id=$1 AND stage='encumbrance' AND state='ACTIVE' RETURNING *",[id]),
  async lockActivePoEncumbrance(id) {
    const rows = (await client.query("SELECT * FROM commitment_ledger WHERE purchase_order_id=$1 AND stage='encumbrance' AND state='ACTIVE' FOR UPDATE", [id])).rows;
    if (rows.length > 1) throw Object.assign(new Error(`Multiple active encumbrances exist for purchase order ${id}`), { code: 'MULTIPLE_ACTIVE_PO_ENCUMBRANCES' });
    return rows[0] || null;
  },
  // The locked row is reduced atomically.  A fully consumed encumbrance is
  // ACTUALIZED so a zero row can never block completion or availability.
  reduceActiveEncumbrance: (id,reduction) => one(client,`UPDATE commitment_ledger
    SET amount=amount-$2, state=CASE WHEN amount-$2=0 THEN 'ACTUALIZED' ELSE 'ACTIVE' END
    WHERE id=$1 AND stage='encumbrance' AND state='ACTIVE' AND amount >= $2 AND $2 >= 0
    RETURNING *`,[id,reduction]),
  insertCommitmentActualization: (c) => one(client,`INSERT INTO commitment_ledger
    (request_id,budget_envelope_id,purchase_order_id,stage,state,amount,currency,source_type,source_id,parent_commitment_id,supplier_invoice_id,ap_voucher_id,idempotency_key,actor_id)
    VALUES ($1,$2,$3,'actual','ACTIVE',$4,$5,'ap_voucher',$6::text,$7,$8,$6,$9,$10) RETURNING *`,
  [c.request_id,c.budget_envelope_id,c.purchase_order_id,c.amount,c.currency,c.ap_voucher_id,c.parent_commitment_id||c.id,c.supplier_invoice_id,c.idempotency_key,c.actor_id]),
  async findActualizationByVoucher(id) {
    const rows=(await client.query("SELECT * FROM commitment_ledger WHERE ap_voucher_id=$1 AND stage='actual'",[id])).rows;
    if(rows.length>1) throw Object.assign(new Error(`Multiple actualizations exist for AP voucher ${id}`),{code:'MULTIPLE_VOUCHER_ACTUALIZATIONS'});
    return rows[0]||null;
  },
  // ACTIVE actual rows are immutable, financially-effective evidence.  This
  // assignment (rather than an increment) makes the projection repairable.
  synchronizeBudgetConsumedProjection: (id) => one(client,`UPDATE budget_envelopes be
    SET consumed_amount=(SELECT COALESCE(SUM(amount),0) FROM commitment_ledger
      WHERE budget_envelope_id=be.id AND stage='actual' AND state='ACTIVE')
    WHERE be.id=$1 RETURNING *`,[id]),

  lockPurchaseOrderLine: (id) => one(client,'SELECT * FROM purchase_order_items WHERE id=$1 FOR UPDATE',[id]),
  lockPurchaseOrderLines: async (ids) => (await client.query('SELECT * FROM purchase_order_items WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[ids])).rows,
  lockGoodsReceiptOperation: (key) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`goods-receipt:${key}`]),
  loadCumulativeAcceptedReceipts: async (id) => (await one(client,"SELECT COALESCE(SUM(gri.received_quantity-gri.damaged_quantity-gri.short_quantity),0)::text quantity FROM goods_receipt_items gri WHERE gri.purchase_order_item_id=$1",[id])).quantity,
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

  lockInvoiceOperation: (key) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`supplier-invoice-operation:${key}`]),
  lockSupplierInvoiceIdentity: (supplierId,number) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`supplier-invoice:${supplierId}:${String(number).trim().toLowerCase()}`]),
  loadInvoicePurchaseOrder: (id) => one(client,'SELECT * FROM purchase_orders WHERE id=$1',[id]),
  findInvoiceByIdempotency: (key) => one(client,'SELECT * FROM supplier_invoices WHERE idempotency_key=$1',[key]),
  findSupplierInvoiceByNormalizedNumber: (supplierId,number) => one(client,'SELECT * FROM supplier_invoices WHERE supplier_id=$1 AND normalized_invoice_number=$2',[supplierId,number]),
  insertSupplierInvoice: (i) => one(client,`INSERT INTO supplier_invoices (request_id,supplier_id,purchase_order_id,invoice_number,normalized_invoice_number,invoice_date,currency,idempotency_key,payload_fingerprint,status,subtotal_amount,tax_amount,discount_amount,total_amount,attachment_metadata,submitted_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AP_INVOICE_SUBMITTED',$10,$11,$12,$13,$14::jsonb,$15) RETURNING *`,[i.request_id,i.supplier_id,i.purchase_order_id,i.invoice_number,i.normalized_invoice_number,i.invoice_date,i.currency,i.idempotency_key,i.payload_fingerprint,i.subtotal_amount,i.tax_amount,i.discount_amount,i.total_amount,JSON.stringify(i.attachment_metadata),i.submitted_by]),
  insertSupplierInvoiceLine: (l) => one(client,'INSERT INTO invoice_items (supplier_invoice_id,purchase_order_item_id,requested_item_id,description,quantity,unit_price,line_total,tax_amount,discount_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[l.supplier_invoice_id,l.purchase_order_item_id,l.requested_item_id,l.description,l.quantity,l.unit_price,l.line_total,l.tax,l.discount]),
  loadInvoiceWithLines: async (id) => { const invoice=await one(client,'SELECT * FROM supplier_invoices WHERE id=$1',[id]); if(!invoice)return null; invoice.lines=(await client.query('SELECT * FROM invoice_items WHERE supplier_invoice_id=$1 ORDER BY id',[id])).rows; return invoice; },
  loadPurchaseOrderForInvoice: (id) => one(client,'SELECT po.* FROM supplier_invoices si JOIN purchase_orders po ON po.id=si.purchase_order_id WHERE si.id=$1',[id]),
  loadAcceptedReceiptQuantitiesByPoLine: async (poId) => (await client.query(`SELECT gri.purchase_order_item_id,COALESCE(SUM(gri.received_quantity-gri.damaged_quantity-gri.short_quantity),0)::text accepted_quantity FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id WHERE gr.purchase_order_id=$1 GROUP BY gri.purchase_order_item_id`,[poId])).rows,
  loadPriorValidInvoicedQuantitiesByPoLine: async (poId,excludeId) => (await client.query(`SELECT ii.purchase_order_item_id,COALESCE(SUM(ii.quantity),0)::text invoiced_quantity FROM invoice_items ii JOIN supplier_invoices si ON si.id=ii.supplier_invoice_id JOIN LATERAL (SELECT imr.id,imr.match_status FROM invoice_match_results imr WHERE imr.supplier_invoice_id=si.id ORDER BY imr.matched_at DESC,imr.id DESC LIMIT 1) current_match ON TRUE LEFT JOIN LATERAL (SELECT d.decision FROM invoice_match_override_decisions d WHERE d.invoice_match_result_id=current_match.id ORDER BY d.decided_at DESC,d.id DESC LIMIT 1) current_decision ON TRUE WHERE si.purchase_order_id=$1 AND si.id<>$2 AND si.status IN ('MATCH_VERIFIED','FINANCE_REVIEW_PENDING','FINANCE_VERIFIED','AP_VOUCHER_CREATED','AP_POSTED','PAYMENT_PENDING','PARTIALLY_PAID','PAID','CLOSED') AND (current_match.match_status='MATCH_VERIFIED' OR (current_match.match_status='MATCH_EXCEPTION' AND current_decision.decision='APPROVED')) GROUP BY ii.purchase_order_item_id`,[poId,excludeId])).rows,
  loadPriorValidInvoicedValuesByPoLine: async (poId,excludeId) => (await client.query(`SELECT ii.purchase_order_item_id,COALESCE(SUM(ii.line_total),0)::text invoiced_value FROM invoice_items ii JOIN supplier_invoices si ON si.id=ii.supplier_invoice_id JOIN LATERAL (SELECT imr.id,imr.match_status FROM invoice_match_results imr WHERE imr.supplier_invoice_id=si.id ORDER BY imr.matched_at DESC,imr.id DESC LIMIT 1) current_match ON TRUE LEFT JOIN LATERAL (SELECT d.decision FROM invoice_match_override_decisions d WHERE d.invoice_match_result_id=current_match.id ORDER BY d.decided_at DESC,d.id DESC LIMIT 1) current_decision ON TRUE WHERE si.purchase_order_id=$1 AND si.id<>$2 AND si.status IN ('MATCH_VERIFIED','FINANCE_REVIEW_PENDING','FINANCE_VERIFIED','AP_VOUCHER_CREATED','AP_POSTED','PAYMENT_PENDING','PARTIALLY_PAID','PAID','CLOSED') AND (current_match.match_status='MATCH_VERIFIED' OR (current_match.match_status='MATCH_EXCEPTION' AND current_decision.decision='APPROVED')) GROUP BY ii.purchase_order_item_id`,[poId,excludeId])).rows,
  loadPriorValidInvoices: async (poId,excludeId) => (await client.query("SELECT ii.* FROM invoice_items ii JOIN supplier_invoices si ON si.id=ii.supplier_invoice_id WHERE si.purchase_order_id=$1 AND si.id<>$2 AND si.status NOT IN ('DECLINED','CANCELLED','VOIDED')",[poId,excludeId])).rows,
  insertMatchResult: (m) => one(client,'INSERT INTO invoice_match_results (request_id,supplier_invoice_id,match_policy,match_status,mismatch_reasons,variances,matched_by,matched_at) VALUES ($1,$2,$3,$4,$5::jsonb,$5::jsonb,$6,NOW()) RETURNING *',[m.request_id,m.supplier_invoice_id,m.policy,m.match_status,JSON.stringify(m.variances),m.actor_id]),
  updateInvoiceLifecycle: (id,status) => one(client,'UPDATE supplier_invoices SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,status]),

  lockInvoice: (id) => one(client,'SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE',[id]),
  lockMatchResult: (id) => one(client,'SELECT * FROM invoice_match_results WHERE id=$1 FOR UPDATE',[id]),
  getEffectiveInvoiceMatchState: (invoiceId) => one(client,`SELECT current_match.match_status,current_match.id AS match_result_id,current_decision.id AS override_decision_id,current_decision.decision AS override_decision,current_decision.reason AS override_reason,current_decision.actor_id AS override_actor_id FROM LATERAL (SELECT imr.* FROM invoice_match_results imr WHERE imr.supplier_invoice_id=$1 ORDER BY imr.matched_at DESC,imr.id DESC LIMIT 1) current_match LEFT JOIN LATERAL (SELECT d.* FROM invoice_match_override_decisions d WHERE d.invoice_match_result_id=current_match.id ORDER BY d.decided_at DESC,d.id DESC LIMIT 1) current_decision ON TRUE`,[invoiceId]),
  loadInvoiceIdsForRequest: async (requestId) => (await client.query('SELECT id FROM supplier_invoices WHERE request_id=$1 ORDER BY id',[requestId])).rows.map(row=>row.id),
  loadFinanceEligibleInvoiceIdsForRequest: async (requestId) => (await client.query("SELECT id FROM supplier_invoices WHERE request_id=$1 AND status IN ('MATCH_VERIFIED','FINANCE_REVIEW_PENDING','FINANCE_VERIFIED','AP_VOUCHER_CREATED','AP_POSTED','PAYMENT_PENDING','PARTIALLY_PAID','PAID','CLOSED') ORDER BY id",[requestId])).rows.map(row=>row.id),
  loadRequestFinanceReadiness: async (requestId) => { const rows=(await client.query("SELECT id FROM supplier_invoices WHERE request_id=$1 AND UPPER(status) NOT IN ('CANCELLED','VOIDED','DECLINED','SUPERSEDED','REPLACED') ORDER BY id",[requestId])).rows; const approved=[],unresolved=[]; for(const row of rows){ const state=await one(client,`SELECT m.match_status,d.decision override_decision FROM LATERAL (SELECT * FROM invoice_match_results WHERE supplier_invoice_id=$1 ORDER BY matched_at DESC,id DESC LIMIT 1) m LEFT JOIN LATERAL (SELECT * FROM invoice_match_override_decisions WHERE invoice_match_result_id=m.id ORDER BY decided_at DESC,id DESC LIMIT 1) d ON TRUE`,[row.id]); ((state?.match_status==='MATCH_VERIFIED'||state?.override_decision==='APPROVED')?approved:unresolved).push(row.id); } return {activeInvoiceCount:rows.length,approvedMatchInvoiceCount:approved.length,approvedInvoiceIds:approved,unresolvedInvoiceIds:unresolved}; },
  insertMatchOverrideDecision: (d) => one(client,`INSERT INTO invoice_match_override_decisions (invoice_match_result_id,decision,reason,actor_id,original_variances) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,[d.invoice_match_result_id,d.decision,d.reason,d.actor_id,JSON.stringify(d.original_variances)]),
  findFinancePostingByInvoice: (id) => one(client,`SELECT fp.* FROM finance_postings fp JOIN ap_vouchers av ON av.id=fp.ap_voucher_id WHERE av.supplier_invoice_id=$1 AND fp.posting_status='posted' LIMIT 1`,[id]),
  lockApOperation: (key) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ap-operation:${key}`]),
  lockApPostingOperation: (key) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ap-posting:${key}`]),
  findApPostingByIdempotency: (key) => one(client,'SELECT * FROM finance_postings WHERE idempotency_key=$1',[key]),
  findApVoucherByIdempotency: (key) => one(client,'SELECT * FROM ap_vouchers WHERE idempotency_key=$1',[key]),
  findPayableByInvoice: (id) => one(client,"SELECT * FROM ap_payables WHERE supplier_invoice_id=$1 AND payable_status IN ('OPEN','PARTIALLY_PAID','PAID') ORDER BY id DESC LIMIT 1",[id]),
  lockPayable: (id) => one(client,'SELECT * FROM ap_payables WHERE id=$1 FOR UPDATE',[id]),
  insertApVoucher: (v) => one(client,`INSERT INTO ap_vouchers (request_id,supplier_invoice_id,voucher_number,voucher_status,currency,total_amount,created_by,idempotency_key,payload_fingerprint) VALUES ($1,$2,'APV-'||$1||'-'||nextval(pg_get_serial_sequence('ap_vouchers','id')),'draft',$3,$4,$5,$6,$7) RETURNING *`,[v.request_id,v.supplier_invoice_id,v.currency,v.total_amount,v.created_by,v.idempotency_key,v.payload_fingerprint]),
  insertApVoucherLine: (l) => one(client,`INSERT INTO ap_voucher_lines (ap_voucher_id,line_number,account_code,description,debit_amount,credit_amount,reference_type,reference_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[l.ap_voucher_id,l.line_number,l.account_code||null,l.description||`Line ${l.line_number}`,l.debit_amount||'0',l.credit_amount||'0',l.reference_type||null,l.reference_id||null]),
  insertApPayable: (p) => one(client,`INSERT INTO ap_payables (request_id,supplier_invoice_id,ap_voucher_id,supplier_name,invoice_total,open_balance,currency,payable_status,posted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8) RETURNING *`,[p.request_id,p.supplier_invoice_id,p.ap_voucher_id,p.supplier_name,p.invoice_total,p.open_balance,p.currency,p.posted_by]),
  findPayableByVoucher: (id) => one(client,'SELECT * FROM ap_payables WHERE ap_voucher_id=$1',[id]),
  loadApVoucher: async (id) => { const voucher=await one(client,'SELECT * FROM ap_vouchers WHERE id=$1',[id]); if(voucher) voucher.lines=(await client.query('SELECT * FROM ap_voucher_lines WHERE ap_voucher_id=$1 ORDER BY line_number',[id])).rows; return voucher; },
  lockApVoucher: async (id) => { const voucher=await one(client,'SELECT * FROM ap_vouchers WHERE id=$1 FOR UPDATE',[id]); if(voucher) voucher.lines=(await client.query('SELECT * FROM ap_voucher_lines WHERE ap_voucher_id=$1 ORDER BY line_number',[id])).rows; return voucher; },
  markVoucherVerified: (id,actorId) => one(client,"UPDATE ap_vouchers SET voucher_status='verified',verified_by=$2,verified_at=NOW() WHERE id=$1 RETURNING *",[id,actorId]),
  markVoucherPosted: (id,actorId) => one(client,"UPDATE ap_vouchers SET voucher_status='posted',posted_by=$2,posted_at=NOW() WHERE id=$1 RETURNING *",[id,actorId]),
  insertFinancePosting: (p) => one(client,"INSERT INTO finance_postings (request_id,ap_voucher_id,supplier_invoice_id,posting_status,liability_recognized_amount,idempotency_key,posted_by,posted_at) VALUES ($1,$2,$3,'posted',$4,$5,$6,NOW()) RETURNING *",[p.request_id,p.ap_voucher_id,p.supplier_invoice_id,p.amount,p.idempotency_key,p.posted_by]),
  lockPaymentOperation: (key) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`payment-operation:${key}`]),
  loadPayablePostingAuthority: (id) => one(client,'SELECT av.voucher_status,av.id ap_voucher_id FROM ap_payables ap JOIN ap_vouchers av ON av.id=ap.ap_voucher_id WHERE ap.id=$1',[id]),
  sumPostedPayments: async (payableId) => (await one(client,"SELECT COALESCE(SUM(pa.amount),0)::text amount FROM payment_allocations pa JOIN payment_records pr ON pr.id=pa.payment_record_id WHERE pa.ap_payable_id=$1 AND pr.payment_status='paid'",[payableId])).amount,
  findPaymentByIdempotency: (key) => one(client,'SELECT * FROM payment_records WHERE idempotency_key=$1',[key]),
  insertPaymentRecord: (p) => one(client,"INSERT INTO payment_records (request_id,ap_voucher_id,supplier_invoice_id,payment_status,payment_reference,payment_method,amount_paid,currency,idempotency_key,payload_fingerprint,paid_by,paid_at) VALUES ($1,$2,$3,'paid',$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *",[p.request_id,p.ap_voucher_id||null,p.supplier_invoice_id,p.payment_reference||null,p.payment_method||null,p.amount_paid,p.currency,p.idempotency_key,p.payload_fingerprint,p.paid_by]),
  insertPaymentAllocation: (p) => one(client,'INSERT INTO payment_allocations (payment_record_id,ap_payable_id,amount) VALUES ($1,$2,$3) RETURNING *',[p.payment_record_id,p.ap_payable_id,p.amount]),
  synchronizePayableOpenBalance: (id,balance) => one(client,'UPDATE ap_payables SET open_balance=$2 WHERE id=$1 RETURNING *',[id,balance]),
  updatePayableStatus: (id,status) => one(client,'UPDATE ap_payables SET payable_status=$2 WHERE id=$1 RETURNING *',[id,status]),
  updateInvoicePaymentProjection: (id,status) => one(client,'UPDATE supplier_invoices SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,status]),
  updateInvoicePaymentState: (id,status) => one(client,'UPDATE supplier_invoices SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,status]),
  loadRequestP2PCompletionFacts: (id) => one(client,`SELECT
    COALESCE((SELECT SUM(quantity) FROM requested_items WHERE request_id=$1),0)::text approved_quantity,
    COALESCE((SELECT SUM(poi.quantity) FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.purchase_order_id WHERE po.request_id=$1 AND po.status NOT IN ('PO_CANCELLED','CANCELLED')),0)::text ordered_quantity,
    COALESCE((SELECT SUM(gri.received_quantity-gri.damaged_quantity-gri.short_quantity) FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id WHERE gr.request_id=$1),0)::text received_quantity,
    (SELECT COUNT(*) FROM supplier_invoices WHERE request_id=$1 AND UPPER(status) NOT IN ('CANCELLED','VOIDED','DECLINED','SUPERSEDED','REPLACED'))::int financially_active_invoice_count,
    (SELECT COUNT(*) FROM ap_payables WHERE request_id=$1 AND payable_status IN ('OPEN','PARTIALLY_PAID'))::int unsettled_payable_count,
    COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN ap_payables ap ON ap.id=pa.ap_payable_id JOIN payment_records pr ON pr.id=pa.payment_record_id WHERE ap.request_id=$1 AND pr.payment_status='paid'),0)::text paid_amount,
    (SELECT COUNT(*) FROM commitment_ledger WHERE request_id=$1 AND stage='encumbrance' AND state='ACTIVE' AND amount>0)::int active_commitment_count,
    (SELECT COUNT(*) FROM supplier_invoices si WHERE si.request_id=$1 AND UPPER(si.status) IN ('MATCH_PENDING','AP_INVOICE_SUBMITTED','MATCH_EXCEPTION'))::int unresolved_financial_obligation_count`,[id]),
  linkDocuments: (requestId,sourceType,sourceId,targetType,targetId,createdBy) => one(client,`INSERT INTO document_flow_links (request_id,source_document_type,source_document_id,target_document_type,target_document_id,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,[requestId,sourceType,String(sourceId),targetType,String(targetId),createdBy]),

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