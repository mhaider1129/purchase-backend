const {withRead,predicate,flowPredicate,invoiceJournalPredicate}=require('../services/p2pReadScope');
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const goodsReceiptService = require('../services/goodsReceiptService');
const {
  LIFECYCLE_STATES,
  MATCH_POLICIES,
  performInvoiceMatch,
  derivePurchaseOrderStatus,
  getPurchaseOrderStatusMetadata,
  validatePurchaseOrderForIssuance,
} = require('../services/procureToPayService');
const supplierInvoiceService = require('../services/supplierInvoiceService');
const {
  advanceLifecycleToApprovedRequest,
  ensureLifecycleRow,
  transitionLifecycleState,
} = require('../services/lifecycleTransitionService');
const { resolveSupplierReference } = require('../services/supplierReferenceService');
const { linkDocuments } = require('../services/documentFlowService');
const { PAYABLE_STATUS, PAYMENT_STATUS } = require('../constants/statusCatalog');
const purchaseOrderService = require('../services/purchaseOrderService');
const financeVerificationService = require('../services/financeVerificationService');
const accountsPayableService = require('../services/accountsPayableService');
const apPostingService = require('../services/apPostingService');
const paymentService = require('../services/paymentService');
const { createConnectedP2PRepository, createTransactionalP2PRepository } = require('../repositories/connectedP2PRepository');
const {
  assertBudgetCanCover,
  recordCommitment,
  postProcureToPayAccrual,
  resolveBudgetEnvelope,
  getBudgetSnapshot,
} = require('../services/financeCoreService');
const {
  sendRequestWorkflowEmail,
  sendWorkflowEmail,
} = require('../utils/workflowEmailNotifications');


const requirePermission = (req, permissionCode) => {
  if (!req.user) throw createHttpError(401, 'Authentication required');
  if (!require('../utils/permissionService').userHasPermission(req.user, permissionCode))
    throw createHttpError(403, 'You do not have permission to perform this action');
};

const parseRequestId = (value) => {
  const requestId = Number(value);
  if (!Number.isInteger(requestId) || requestId <= 0) throw createHttpError(400, 'requestId must be a positive integer');
  return requestId;
};

const logFinanceAction = async (client, requestId, actorId, actionType, payload = {}) => {
  await client.query(
    `INSERT INTO finance_action_history (request_id, action_type, actor_id, action_payload)
     VALUES ($1, $2, $3, $4)`,
    [requestId, actionType, actorId || null, JSON.stringify(payload)]
  );

  await client.query(
    `INSERT INTO audit_logs (action_type, actor_id, target_type, target_id, details, description)
     VALUES ($1, $2, 'request', $3, $4, $5)`,
    [actionType, actorId || null, requestId, JSON.stringify(payload), `${actionType} for request #${requestId}`]
  );
};


const annotatePurchaseOrder = (row) => {
  if (!row) {
    return row;
  }

  const resolvedStatus = derivePurchaseOrderStatus({
    currentStatus: row.status,
    orderedQuantity: row.ordered_quantity,
    receivedQuantity: row.received_quantity,
    approvedAt: row.approved_at,
    issuedAt: row.issued_at || row.issue_event_at,
    cancelledAt: row.cancelled_at,
    closedAt: row.closed_at,
  });
  const statusMetadata = getPurchaseOrderStatusMetadata(resolvedStatus);

  return {
    ...row,
    status: resolvedStatus,
    business_status: statusMetadata?.business_status || resolvedStatus,
    system_status_code: statusMetadata?.system_code || resolvedStatus,
  };
};

const createGoodsReceipt = async (req, res, next) => {
  try {
    requirePermission(req, 'procure-to-pay.receipts.manage');
    const requestId = parseRequestId(req.params.requestId);
    const purchaseOrderId = Number(req.body.purchase_order_id);
    const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotency_key || '').trim();
    if (!idempotencyKey) throw createHttpError(400, 'Idempotency-Key header is required');
    const result = await goodsReceiptService.createGoodsReceipt({
      repository: createTransactionalP2PRepository(pool), purchaseOrderId, idempotencyKey,
      lines: req.body.items || req.body.lines || [], receivedAt: req.body.received_at || null,
      actor: req.user, requestId, warehouseLocation: req.body.warehouse_location || null,
      notes: req.body.notes || null, discrepancyNotes: req.body.discrepancy_notes || null,
      correlationId: req.correlationId || null,
    });
    res.status(result.idempotent ? 200 : 201).json({
      message: result.idempotent ? 'Goods receipt already captured' : 'Goods receipt captured',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const listReceiptsByRequest = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const requestId = parseRequestId(req.params.requestId);
    const { rows } = await client.query(
      `SELECT gr.*, COALESCE(json_agg(gri.*) FILTER (WHERE gri.id IS NOT NULL), '[]'::json) AS items
       FROM goods_receipts gr
       LEFT JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
       WHERE gr.request_id = $1
       GROUP BY gr.id
       ORDER BY gr.received_at DESC`,
      [requestId]
    );
    return ({ data: rows });
    }, {requestId:req.params.requestId,capabilities:['procure-to-pay.lifecycle.view','procure-to-pay.receipts.manage']});
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const submitInvoice = async (req, res, next) => {
  try {
    requirePermission(req, 'procure-to-pay.invoices.manage');
    const requestId = parseRequestId(req.params.requestId);
    const result = await supplierInvoiceService.submitSupplierInvoice({
      repository: createTransactionalP2PRepository(pool),
      requestId,
      purchaseOrderId: req.body.purchase_order_id,
      contractId: req.body.contract_id,
      supplierId: req.body.supplier_id,
      invoiceNumber: req.body.invoice_number,
      invoiceDate: req.body.invoice_date,
      currency: req.body.currency || 'USD',
      lines: req.body.lines || req.body.items,
      idempotencyKey: req.get('Idempotency-Key') || req.body.idempotency_key,
      actor: req.user,
      attachmentMetadata: req.body.attachment_metadata,
    });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { next(error); }
};

const runInvoiceMatch = async (req, res, next) => {
  try {
    requirePermission(req, 'procure-to-pay.match.manage');
    const requestId = parseRequestId(req.params.requestId);
    const result = await supplierInvoiceService.runInvoiceMatch({ repository: createTransactionalP2PRepository(pool), requestId, invoiceId: Number(req.params.invoiceId), actor: req.user });
    res.json(result);
  } catch (error) { next(error); }
};

const approveMatchOverride = async (req, res, next) => {
  try {
    requirePermission(req, 'finance.override-mismatch');
    const requestId = parseRequestId(req.params.requestId);
    const result = await supplierInvoiceService.decideMatchOverride({ repository: createTransactionalP2PRepository(pool), requestId, matchResultId: Number(req.params.matchResultId), decision: 'APPROVED', reason: req.body.reason, actor: req.user });
    res.json(result);
  } catch (error) { next(error); }
};

const declineInvoiceMatch = async (req, res, next) => {
  try {
    requirePermission(req, 'finance.override-mismatch');
    const requestId = parseRequestId(req.params.requestId);
    const result = await supplierInvoiceService.decideMatchOverride({ repository: createTransactionalP2PRepository(pool), requestId, matchResultId: Number(req.params.matchResultId), decision: 'DECLINED', reason: req.body.reason, actor: req.user });
    res.json(result);
  } catch (error) { next(error); }
};

const verifyFinanceRecord = async (req, res, next) => {
  try {
    // The delegated service uses assertInvoiceMatchApproved as the sole Phase 4C match authority.
    requirePermission(req, 'finance.verify');
    const requestId = parseRequestId(req.params.requestId);
    const repository = createTransactionalP2PRepository(pool);
    const result = await financeVerificationService.verifyRequestForFinance({ repository, requestId, actor: req.user });
    res.json({ message: 'Finance record verified', ...result });
  } catch (error) {
    next(error);
  }
};

const createApVoucher = async (req, res, next) => {
  try {
    requirePermission(req, 'finance.voucher.create');
    const requestId = parseRequestId(req.params.requestId);
    const result = await accountsPayableService.createPayableFromVerifiedInvoice({ repository: createTransactionalP2PRepository(pool), requestId, invoiceId: Number(req.body.supplier_invoice_id), actor: req.user, idempotencyKey: req.get('Idempotency-Key') || req.body.idempotency_key, accountingLines: req.body.lines || [] });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
};

const verifyApVoucher = async (req, res, next) => {
  try {
    requirePermission(req, 'finance.voucher.verify');
    const result = await accountsPayableService.verifyApVoucher({ repository: createTransactionalP2PRepository(pool), voucherId: Number(req.params.voucherId), actor: req.user });
    res.json(result);
  } catch (error) { next(error); }
};

const postToInternalLedger = async (req, res, next) => {
  try {
    requirePermission(req, 'finance.post-ledger');
    const requestId = parseRequestId(req.params.requestId);
    const result = await apPostingService.postApVoucher({ repository: createTransactionalP2PRepository(pool), requestId, voucherId: Number(req.body.ap_voucher_id), actor: req.user, idempotencyKey: req.get('Idempotency-Key') || req.body.idempotency_key });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
};

const markPaymentPending = async (req, res, next) => {
  try {
    requirePermission(req, 'finance.payment.manage');
    throw createHttpError(410, 'Legacy payment-pending records are disabled; post a real payable payment');
  } catch (error) {
    next(error);
  }
};

const markPaid = async (req, res, next) => {
  try {
    requirePermission(req, 'finance.payment.manage');
    throw createHttpError(410, 'Status-only markPaid is disabled; post a payment against an open payable');
  } catch (error) {
    next(error);
  }
};



const parsePurchaseOrderId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw createHttpError(400, 'Invalid purchase order id');
  return id;
};

const submitPurchaseOrderForApproval = async (req, res, next) => {
  try {
    requirePermission(req, 'procure-to-pay.purchase-orders.manage');
    const purchaseOrder = await purchaseOrderService.submitPurchaseOrder({ repository: createTransactionalP2PRepository(pool), purchaseOrderId: parsePurchaseOrderId(req.params.poId), approvalRoute: req.body?.approval_route, actor: req.user });
    res.json({ purchase_order: annotatePurchaseOrder(purchaseOrder) });
  } catch (error) { next(error); }
};

const approvePurchaseOrder = async (req, res, next) => {
  try {
    requirePermission(req, 'procure-to-pay.purchase-orders.manage');
    const purchaseOrder = await purchaseOrderService.approvePurchaseOrder({ repository: createTransactionalP2PRepository(pool), purchaseOrderId: parsePurchaseOrderId(req.params.poId), actor: req.user });
    res.json({ purchase_order: annotatePurchaseOrder(purchaseOrder) });
  } catch (error) { next(error); }
};

const issuePurchaseOrder = async (req, res, next) => {
  try {
    requirePermission(req, 'procure-to-pay.purchase-orders.manage');
    const result = await purchaseOrderService.releasePurchaseOrder({ repository: createTransactionalP2PRepository(pool), purchaseOrderId: parsePurchaseOrderId(req.params.poId), actor: req.user });
    res.json({ purchase_order: annotatePurchaseOrder(result.purchaseOrder), commitment: result.commitment });
  } catch (error) { next(error); }
};

const cancelPurchaseOrder = async (req, res, next) => {
  try {
    requirePermission(req, 'procure-to-pay.purchase-orders.manage');
    const reason = String(req.body?.reason || '').trim();
    if (!reason) throw createHttpError(400, 'Cancellation reason is required');
    const result = await purchaseOrderService.cancelPurchaseOrder({ repository: createTransactionalP2PRepository(pool), purchaseOrderId: parsePurchaseOrderId(req.params.poId), reason, actor: req.user });
    res.json({ purchase_order: annotatePurchaseOrder(result.purchaseOrder), commitment: result.commitment });
  } catch (error) { next(error); }
};

const closePurchaseOrder = async (req, res, next) => {
  try {
    requirePermission(req, 'procure-to-pay.purchase-orders.manage');
    const result = await purchaseOrderService.closePurchaseOrder({ repository: createTransactionalP2PRepository(pool), purchaseOrderId: parsePurchaseOrderId(req.params.poId), reason: req.body?.reason, actor: req.user });
    res.json({ purchase_order: annotatePurchaseOrder(result.purchaseOrder), commitment: result.commitment });
  } catch (error) { next(error); }
};

const createPurchaseOrder = async (req, res, next) => {
  try {
    requirePermission(req, 'procure-to-pay.purchase-orders.manage');
    const requestId = parseRequestId(req.params.requestId);
    const selections = req.body?.awards;
    if (!Array.isArray(selections) || !selections.length || selections.some((entry) => !entry.award_id || entry.quantity == null)) {
      throw createHttpError(400, 'awards with award_id and quantity are required');
    }
    const awardIds = selections.map((entry) => Number(entry.award_id));
    if (awardIds.some((id) => !Number.isInteger(id) || id <= 0)) throw createHttpError(400, 'Invalid award_id');
    const quantities = Object.fromEntries(selections.map((entry) => [String(entry.award_id), String(entry.quantity)]));
    const purchaseOrder = await purchaseOrderService.createPurchaseOrderFromAwards({
      repository: createTransactionalP2PRepository(pool),
      requestId,
      awardIds,
      quantities,
      actor: req.user,
      input: {
        expected_delivery_date: req.body.expected_delivery_date || null,
        delivery_location: req.body.delivery_location || null,
        budget_cost_center: req.body.budget_cost_center || null,
        contract_id: req.body.contract_id || null,
      },
    });
    res.status(201).json({ purchase_order: purchaseOrder });
  } catch (error) { next(error); }
};

const listPurchaseOrders = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const {
      status = null,
      supplier = null,
      request_id: requestId = null,
      date_from: dateFrom = null,
      date_to: dateTo = null,
      search = null,
      page = 1,
      page_size: pageSize = 20,
    } = req.query;

    const filters = [predicate('purchaseOrder','po')];
    const values = [scopeActor.institute_id];
    const safePage = Math.max(Number(page) || 1, 1);
    const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 100);

    if (status) {
      values.push(status);
      filters.push(`po.status = $${values.length}`);
    }
    if (supplier) {
      values.push(`%${supplier}%`);
      filters.push(`COALESCE(s.name, po.supplier_name, '') ILIKE $${values.length}`);
    }
    if (requestId) {
      values.push(Number(requestId));
      filters.push(`po.request_id = $${values.length}`);
    }
    if (dateFrom) {
      values.push(dateFrom);
      filters.push(`po.created_at::date >= $${values.length}::date`);
    }
    if (dateTo) {
      values.push(dateTo);
      filters.push(`po.created_at::date <= $${values.length}::date`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(po.po_number ILIKE $${values.length} OR COALESCE(s.name, po.supplier_name, '') ILIKE $${values.length} OR po.request_id::text ILIKE $${values.length})`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const totalValues = [...values];
    const totalResult = await client.query(`SELECT COUNT(*)::int AS total FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id ${whereClause}`, totalValues);

    values.push(safePageSize, (safePage - 1) * safePageSize);
    const { rows } = await client.query(
      `SELECT po.*, COALESCE(s.name, po.supplier_name) AS supplier_name, COALESCE(SUM(poi.quantity * poi.unit_price), 0) AS total_amount,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', poi.id,
                    'item_name', poi.item_name,
                    'quantity', poi.quantity,
                    'unit_price', poi.unit_price,
                    'received_quantity', poi.received_quantity,
                    'remaining_quantity', GREATEST(poi.quantity - poi.received_quantity, 0),
                    'receiving_status', CASE WHEN poi.received_quantity <= 0 THEN 'NOT_RECEIVED' WHEN poi.received_quantity < poi.quantity THEN 'PARTIAL' ELSE 'FULLY_RECEIVED' END,
                    'line_total', (poi.quantity * poi.unit_price)
                  )
                  ORDER BY poi.id
                ) FILTER (WHERE poi.id IS NOT NULL),
                '[]'::json
              ) AS items
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
       ${whereClause}
       GROUP BY po.id, s.name
       ORDER BY po.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return ({ data: rows.map(annotatePurchaseOrder), pagination: { page: safePage, page_size: safePageSize, total: totalResult.rows[0].total } });
    }, {capabilities:['procure-to-pay.lifecycle.view','procure-to-pay.purchase-orders.manage']});
    res.json(result);
  } catch (error) { next(error); }
};

const getProcureToPayDashboard = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const [awaitingPo, awaitingReceipt, pendingMatch, matchException, dueToday, overdue, paymentsWeek] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS count FROM requests r WHERE ${predicate('request','r')} AND status = 'approved' AND id NOT IN (SELECT request_id FROM purchase_orders)`,[scopeActor.institute_id]),
      client.query(`SELECT COUNT(*)::int AS count FROM purchase_orders po WHERE ${predicate('purchaseOrder','po')} AND NOT EXISTS (SELECT 1 FROM goods_receipts gr WHERE gr.purchase_order_id = po.id)`,[scopeActor.institute_id]),
      client.query(`SELECT COUNT(*)::int AS count FROM supplier_invoices si WHERE ${predicate('invoice','si')} AND NOT EXISTS (SELECT 1 FROM invoice_match_results imr WHERE imr.supplier_invoice_id = si.id)`,[scopeActor.institute_id]),
      client.query(`SELECT COUNT(*)::int AS count FROM supplier_invoices si JOIN LATERAL (SELECT match_status FROM invoice_match_results WHERE supplier_invoice_id=si.id ORDER BY matched_at DESC,id DESC LIMIT 1) imr ON TRUE WHERE ${predicate('invoice','si')} AND imr.match_status='MATCH_EXCEPTION'`,[scopeActor.institute_id]),
      client.query(`SELECT COUNT(*)::int AS count FROM ap_payables ap WHERE ${predicate('payable','ap')} AND open_balance > 0 AND due_date = CURRENT_DATE`,[scopeActor.institute_id]),
      client.query(`SELECT COUNT(*)::int AS count FROM ap_payables ap WHERE ${predicate('payable','ap')} AND open_balance > 0 AND due_date < CURRENT_DATE`,[scopeActor.institute_id]),
      client.query(`SELECT COALESCE(SUM(amount_paid), 0) AS total FROM payment_records pr WHERE ${predicate('payment','pr')} AND paid_at >= date_trunc('week', NOW())`,[scopeActor.institute_id]),
    ]);

    return ({
      data: {
        approved_requests_awaiting_po: awaitingPo.rows[0].count,
        pos_awaiting_receipt: awaitingReceipt.rows[0].count,
        invoices_pending_match: pendingMatch.rows[0].count,
        invoices_in_exception: matchException.rows[0].count,
        open_payables_due_today: dueToday.rows[0].count,
        overdue_payables: overdue.rows[0].count,
        payments_posted_this_week: Number(paymentsWeek.rows[0].total) || 0,
      },
    });
    }, {});
    res.json(result);
  } catch (error) { next(error); }
};

const getPoSourceRequests = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const { search = null, request_id: requestId = null } = req.query;
    const values = [scopeActor.institute_id];
    const filters = [predicate('request','r'),
      `LOWER(r.status) = 'approved'`,
      `EXISTS (
        SELECT 1 FROM procurement_awards pa
         WHERE pa.request_id = r.id
           AND pa.status = 'ACTIVE'
           AND pa.awarded_quantity > COALESCE((
             SELECT SUM(poi.quantity)
               FROM purchase_order_items poi
               JOIN purchase_orders po ON po.id = poi.purchase_order_id
              WHERE poi.award_id = pa.id
                AND po.status NOT IN ('PO_CANCELLED', 'CANCELLED')
           ), 0)
      )`,
    ];

    if (search) {
      values.push(`%${search}%`);
      filters.push(`(r.id::text ILIKE $${values.length} OR COALESCE(r.request_type, '') ILIKE $${values.length})`);
    }

    if (requestId) {
      values.push(Number(requestId));
      filters.push(`r.id = $${values.length}`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await client.query(
      `SELECT r.id,
              r.request_type,
              r.status,
              r.created_at,
              COALESCE(remaining_items.items, '[]'::json) AS remaining_items
       FROM requests r
       LEFT JOIN LATERAL (
         SELECT json_agg(
                  json_build_object(
                    'requested_item_id', remaining.requested_item_id,
                    'award_id', remaining.award_id,
                    'item_name', remaining.item_name,
                    'requested_quantity', remaining.requested_quantity,
                    'po_allocated_quantity', remaining.po_allocated_quantity,
                    'remaining_quantity', remaining.remaining_quantity,
                    'unit_price', remaining.unit_price,
                    'currency', remaining.currency,
                    'supplier_id', remaining.supplier_id,
                    'supplier_name', remaining.supplier_name
                  )
                  ORDER BY remaining.requested_item_id
                ) AS items
           FROM (
             SELECT ri.id AS requested_item_id,
                    pa.id AS award_id,
                    ri.item_name,
                    pa.awarded_quantity AS requested_quantity,
                    COALESCE(po_allocated.ordered_quantity, 0) AS po_allocated_quantity,
                    GREATEST(pa.awarded_quantity - COALESCE(po_allocated.ordered_quantity, 0), 0) AS remaining_quantity,
                    pa.unit_price,
                    pa.currency,
                    pa.supplier_id,
                    s.name AS supplier_name
               FROM procurement_awards pa
               JOIN requested_items ri ON ri.id = pa.request_item_id
               JOIN suppliers s ON s.id = pa.supplier_id
               LEFT JOIN LATERAL (
                 SELECT COALESCE(SUM(poi.quantity), 0) AS ordered_quantity
                   FROM purchase_order_items poi
                   JOIN purchase_orders po ON po.id = poi.purchase_order_id
                  WHERE poi.award_id = pa.id
                    AND po.status NOT IN ('PO_CANCELLED', 'CANCELLED')
               ) po_allocated ON TRUE
              WHERE pa.request_id = r.id
                AND ri.request_id=r.id
                AND ((to_jsonb(s)->>'institute_id') IS NULL OR (to_jsonb(s)->>'institute_id')=r.institute_id::text)
                AND pa.status = 'ACTIVE'
                AND GREATEST(pa.awarded_quantity - COALESCE(po_allocated.ordered_quantity, 0), 0) > 0
           ) remaining
       ) remaining_items ON TRUE
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT 200`,
      values
    );
    return ({ data: rows });
    }, {capabilities:['procure-to-pay.lifecycle.view','procure-to-pay.purchase-orders.manage']});
    res.json(result);
  } catch (error) { next(error); }
};

const listGoodsReceipts = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const { po_id: poId = null, status = null, supplier = null, date_from: dateFrom = null, date_to: dateTo = null, page = 1, page_size: pageSize = 20 } = req.query;
    const values = [scopeActor.institute_id];
    const filters = [predicate('receipt','gr')];
    const safePage = Math.max(Number(page) || 1, 1);
    const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    if (poId) { values.push(Number(poId)); filters.push(`gr.purchase_order_id = $${values.length}`); }
    if (status) { values.push(status); filters.push(`COALESCE(gr.receipt_status, 'POSTED') = $${values.length}`); }
    if (supplier) { values.push(`%${supplier}%`); filters.push(`COALESCE(s.name, po.supplier_name, '') ILIKE $${values.length}`); }
    if (dateFrom) { values.push(dateFrom); filters.push(`gr.received_at::date >= $${values.length}::date`); }
    if (dateTo) { values.push(dateTo); filters.push(`gr.received_at::date <= $${values.length}::date`); }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countResult = await client.query(`SELECT COUNT(*)::int AS total FROM goods_receipts gr LEFT JOIN purchase_orders po ON po.id = gr.purchase_order_id LEFT JOIN suppliers s ON s.id=po.supplier_id ${whereClause}`, values);
    values.push(safePageSize, (safePage - 1) * safePageSize);
    const { rows } = await client.query(
      `SELECT gr.*, po.po_number, COALESCE(s.name, po.supplier_name) AS supplier_name,
              CASE
                WHEN po.id IS NULL THEN 'NO_PO'
                WHEN COALESCE(poi_totals.ordered_quantity, 0) <= COALESCE(poi_totals.received_quantity, 0) THEN 'FULLY_RECEIVED'
                ELSE 'PARTIAL'
              END AS status
       FROM goods_receipts gr
       LEFT JOIN purchase_orders po ON po.id = gr.purchase_order_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN (
         SELECT purchase_order_id,
                COALESCE(SUM(quantity), 0) AS ordered_quantity,
                COALESCE(SUM(received_quantity), 0) AS received_quantity
         FROM purchase_order_items
         GROUP BY purchase_order_id
       ) poi_totals ON poi_totals.purchase_order_id = po.id
       ${whereClause}
       ORDER BY gr.received_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return ({ data: rows, pagination: { page: safePage, page_size: safePageSize, total: countResult.rows[0].total } });
    }, {capabilities:['procure-to-pay.lifecycle.view','procure-to-pay.receipts.manage']});
    res.json(result);
  } catch (error) { next(error); }
};

const listOpenPosForReceipt = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const { rows } = await client.query(
      `SELECT po.*, COALESCE(SUM(poi.quantity), 0) AS ordered_qty, COALESCE(SUM(poi.received_quantity), 0) AS received_qty
       FROM purchase_orders po
       LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
       WHERE ${predicate('purchaseOrder','po')}
       GROUP BY po.id
       HAVING COALESCE(SUM(poi.received_quantity), 0) < COALESCE(SUM(poi.quantity), 0)
       ORDER BY po.created_at DESC`,[scopeActor.institute_id]
    );
    return ({ data: rows });
    }, {capabilities:['procure-to-pay.lifecycle.view','procure-to-pay.receipts.manage']});
    res.json(result);
  } catch (error) { next(error); }
};

const listApInvoices = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const { status = null, supplier = null, po_id: poId = null, date_from: dateFrom = null, date_to: dateTo = null, search = null, page = 1, page_size: pageSize = 20 } = req.query;
    const values = [scopeActor.institute_id];
    const filters = [predicate('invoice','si')];
    const safePage = Math.max(Number(page) || 1, 1);
    const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    if (supplier) { values.push(`%${supplier}%`); filters.push(`COALESCE(s.name, si.supplier, '') ILIKE $${values.length}`); }
    if (poId) { values.push(Number(poId)); filters.push(`si.purchase_order_id = $${values.length}`); }
    if (dateFrom) { values.push(dateFrom); filters.push(`si.invoice_date >= $${values.length}::date`); }
    if (dateTo) { values.push(dateTo); filters.push(`si.invoice_date <= $${values.length}::date`); }
    if (search) { values.push(`%${search}%`); filters.push(`(si.invoice_number ILIKE $${values.length} OR COALESCE(s.name, si.supplier, '') ILIKE $${values.length})`); }
    if (status) { values.push(status); filters.push(`COALESCE(imr.match_status, 'SUBMITTED') = $${values.length}`); }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await client.query(`SELECT COUNT(*)::int AS total FROM supplier_invoices si LEFT JOIN suppliers s ON s.id=si.supplier_id LEFT JOIN invoice_match_results imr ON imr.supplier_invoice_id = si.id ${whereClause}`, values);
    values.push(safePageSize, (safePage - 1) * safePageSize);
    const { rows } = await client.query(
      `SELECT si.*, COALESCE(s.name, si.supplier) AS supplier, po.po_number, gr.receipt_number,
              COALESCE(imr.match_status, 'SUBMITTED') AS status,
              (si.invoice_date + INTERVAL '30 day')::date AS due_date
       FROM supplier_invoices si
       LEFT JOIN suppliers s ON s.id = si.supplier_id
       LEFT JOIN purchase_orders po ON po.id = si.purchase_order_id
       LEFT JOIN goods_receipts gr ON gr.id = si.receipt_id
       LEFT JOIN LATERAL (
         SELECT match_status
         FROM invoice_match_results
         WHERE supplier_invoice_id = si.id
         ORDER BY matched_at DESC
         LIMIT 1
       ) imr ON TRUE
       ${whereClause}
       ORDER BY si.submitted_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return ({ data: rows, pagination: { page: safePage, page_size: safePageSize, total: countResult.rows[0].total } });
    }, {capabilities:['procure-to-pay.lifecycle.view','procure-to-pay.invoices.manage']});
    res.json(result);
  } catch (error) { next(error); }
};

const listInvoiceMatchingQueue = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const { rows } = await client.query(
      `SELECT si.id AS invoice_id, si.request_id, si.invoice_number, si.supplier,
              COALESCE(imr.match_status, 'MATCH_PENDING') AS match_status,
              COALESCE(imr.mismatch_reasons, '[]'::jsonb) AS mismatch_reasons,
              COALESCE(imr.override_decision = 'APPROVED', FALSE) AS override_approved
       FROM supplier_invoices si
       LEFT JOIN LATERAL (
         SELECT latest.match_status, latest.mismatch_reasons, decision.decision AS override_decision
         FROM LATERAL (SELECT * FROM invoice_match_results WHERE supplier_invoice_id = si.id ORDER BY matched_at DESC,id DESC LIMIT 1) latest
         LEFT JOIN LATERAL (SELECT d.decision FROM invoice_match_override_decisions d WHERE d.invoice_match_result_id=latest.id ORDER BY d.decided_at DESC,d.id DESC LIMIT 1) decision ON TRUE
         LIMIT 1
       ) imr ON TRUE
       WHERE ${predicate('invoice','si')} AND COALESCE(imr.match_status, 'MATCH_PENDING') IN ('MATCH_PENDING', 'MATCH_EXCEPTION')
       ORDER BY si.submitted_at DESC`,[scopeActor.institute_id]
    );
    return ({ data: rows });
    }, {capabilities:['procure-to-pay.lifecycle.view','procure-to-pay.match.manage']});
    res.json(result);
  } catch (error) { next(error); }
};

const getPurchaseOrderDetail = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const poId = Number(req.params.poId);
    const [po, items, receipts, invoices] = await Promise.all([
      client.query(`SELECT * FROM purchase_orders WHERE id=$1`, [poId]),
      client.query(`SELECT poi.*,(SELECT COALESCE(SUM(${require('../services/receiptInspectionQuantities').capacity()}),0) FROM goods_receipt_items gri WHERE gri.purchase_order_item_id=poi.id) AS receipt_capacity_reserved FROM purchase_order_items poi WHERE purchase_order_id=$1 ORDER BY id ASC`, [poId]),
      client.query(`SELECT * FROM goods_receipts WHERE purchase_order_id=$1 ORDER BY received_at DESC`, [poId]),
      require('../utils/permissionService').userHasPermission(scopeActor,'procure-to-pay.lifecycle.view') ? client.query(`SELECT * FROM supplier_invoices WHERE purchase_order_id=$1 ORDER BY submitted_at DESC`, [poId]) : Promise.resolve({rows:[]}),
    ]);
    if (!po.rowCount) throw createHttpError(404, 'Purchase order not found');
    return ({ purchase_order: annotatePurchaseOrder(po.rows[0]), items: items.rows, receipts: receipts.rows, invoices: invoices.rows });
    }, {kind:'purchaseOrder',value:req.params.poId,capabilities:['procure-to-pay.lifecycle.view','procure-to-pay.purchase-orders.manage','procure-to-pay.receipts.manage']});
    res.json(result);
  } catch (error) { next(error); }
};

const postPayableFromInvoice = async (req, res, next) => {
  try {
    requirePermission(req, 'finance.verify');
    throw createHttpError(410, 'Direct invoice-to-payable posting is disabled; create, verify, and post an AP voucher');
  } catch (error) { next(error); }
};

const listAccountsPayable = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const { status = null, supplier = null, due_from: dueFrom = null, due_to: dueTo = null, overdue = null, page = 1, page_size: pageSize = 20 } = req.query;
    const values = [scopeActor.institute_id];
    const filters = [predicate('payable','ap')];
    const safePage = Math.max(Number(page) || 1, 1);
    const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    if (status) { values.push(status); filters.push(`ap.payable_status = $${values.length}`); }
    if (supplier) { values.push(`%${supplier}%`); filters.push(`COALESCE(s.name, ap.supplier_name, '') ILIKE $${values.length}`); }
    if (dueFrom) { values.push(dueFrom); filters.push(`ap.due_date >= $${values.length}::date`); }
    if (dueTo) { values.push(dueTo); filters.push(`ap.due_date <= $${values.length}::date`); }
    if (overdue === 'true') { filters.push(`ap.due_date < CURRENT_DATE AND ap.open_balance > 0`); }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await client.query(`SELECT COUNT(*)::int AS total FROM ap_payables ap LEFT JOIN suppliers s ON s.id=ap.supplier_id ${whereClause}`, values);
    values.push(safePageSize, (safePage - 1) * safePageSize);
    const { rows } = await client.query(
      `SELECT ap.*, COALESCE(s.name, ap.supplier_name) AS supplier_name, si.invoice_number,
              CASE
                WHEN ap.open_balance <= 0 THEN 'PAID'
                WHEN ap.due_date < CURRENT_DATE THEN 'OVERDUE'
                WHEN ap.due_date < CURRENT_DATE + INTERVAL '7 day' THEN '0-7 DAYS'
                WHEN ap.due_date < CURRENT_DATE + INTERVAL '30 day' THEN '8-30 DAYS'
                ELSE '30+ DAYS'
              END AS aging_bucket
       FROM ap_payables ap
       LEFT JOIN suppliers s ON s.id = ap.supplier_id
       LEFT JOIN supplier_invoices si ON si.id = ap.supplier_invoice_id
       ${whereClause}
       ORDER BY ap.due_date ASC NULLS LAST, ap.posted_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return ({ data: rows, pagination: { page: safePage, page_size: safePageSize, total: countResult.rows[0].total } });
    }, {capabilities:['procure-to-pay.lifecycle.view','finance.payment.manage']});
    res.json(result);
  } catch (error) { next(error); }
};

const listPayments = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const { status = null, supplier = null, date_from: dateFrom = null, date_to: dateTo = null } = req.query;
    const values = [scopeActor.institute_id];
    const filters = [predicate('payment','pr')];
    if (status) { values.push(status); filters.push(`pr.payment_status = $${values.length}`); }
    if (supplier) { values.push(`%${supplier}%`); filters.push(`COALESCE(s.name, ap.supplier_name, '') ILIKE $${values.length}`); }
    if (dateFrom) { values.push(dateFrom); filters.push(`pr.paid_at::date >= $${values.length}::date`); }
    if (dateTo) { values.push(dateTo); filters.push(`pr.paid_at::date <= $${values.length}::date`); }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await client.query(
      `SELECT pr.*, ap.id AS payable_id, COALESCE(s.name, ap.supplier_name) AS supplier_name, si.invoice_number
       FROM payment_records pr
       LEFT JOIN payment_allocations pa ON pa.payment_record_id = pr.id
       LEFT JOIN ap_payables ap ON ap.id = pa.ap_payable_id
       LEFT JOIN suppliers s ON s.id = ap.supplier_id
       LEFT JOIN supplier_invoices si ON si.id = ap.supplier_invoice_id
       ${whereClause}
       ORDER BY pr.paid_at DESC NULLS LAST, pr.created_at DESC
       LIMIT 300`,
      values
    );
    return ({ data: rows });
    }, {capabilities:['procure-to-pay.lifecycle.view','finance.payment.manage']});
    res.json(result);
  } catch (error) { next(error); }
};

const recordPayablePayment = async (req, res, next) => {
  try {
    requirePermission(req, 'finance.payment.manage');
    const payableId = Number(req.params.payableId);
    const result = await paymentService.postPayment({ repository: createTransactionalP2PRepository(pool), payableId, amount: req.body.amount, currency: req.body.currency, paymentReference: req.body.payment_reference, paymentMethod: req.body.payment_method, idempotencyKey: req.get('Idempotency-Key') || req.body.idempotency_key, actor: req.user });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { next(error); }
};

const getDocumentFlow = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const requestId = parseRequestId(req.params.requestId);
    const { rows } = await client.query(`SELECT dfl.* FROM document_flow_links dfl WHERE request_id=$1 AND ${flowPredicate('dfl','$2')} ORDER BY created_at ASC`, [requestId,scopeActor.institute_id]);
    return ({ data: rows });
    }, {requestId:req.params.requestId});
    res.json(result);
  } catch (error) { next(error); }
};

const listDocumentFlow = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const { search = null, request_number = null, po_number = null, invoice_number = null, supplier = null, payment_reference = null } = req.query;
    const values = [scopeActor.institute_id];
    const filters = [flowPredicate('dfl')];
    const addLike = (expr, value) => {
      values.push(`%${value}%`);
      filters.push(`${expr} ILIKE $${values.length}`);
    };
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        dfl.request_id::text ILIKE $${values.length}
        OR COALESCE(po.po_number, '') ILIKE $${values.length}
        OR COALESCE(si.invoice_number, '') ILIKE $${values.length}
        OR COALESCE(s.name, ap.supplier_name, '') ILIKE $${values.length}
        OR COALESCE(pr.payment_reference, '') ILIKE $${values.length}
      )`);
    }
    if (request_number) addLike(`dfl.request_id::text`, request_number);
    if (po_number) addLike(`COALESCE(po.po_number, '')`, po_number);
    if (invoice_number) addLike(`COALESCE(si.invoice_number, '')`, invoice_number);
    if (supplier) addLike(`COALESCE(s.name, ap.supplier_name, '')`, supplier);
    if (payment_reference) addLike(`COALESCE(pr.payment_reference, '')`, payment_reference);
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await client.query(
      `SELECT dfl.*, po.po_number, si.invoice_number, COALESCE(s.name, ap.supplier_name) AS supplier_name, pr.payment_reference
       FROM document_flow_links dfl
       LEFT JOIN purchase_orders po ON po.request_id=dfl.request_id AND ((dfl.source_document_type='PURCHASE_ORDER' AND po.id::text=dfl.source_document_id) OR (dfl.target_document_type='PURCHASE_ORDER' AND po.id::text=dfl.target_document_id))
       LEFT JOIN supplier_invoices si ON si.request_id=dfl.request_id AND ((dfl.source_document_type='AP_INVOICE' AND si.id::text=dfl.source_document_id) OR (dfl.target_document_type='AP_INVOICE' AND si.id::text=dfl.target_document_id))
       LEFT JOIN ap_payables ap ON ap.request_id=dfl.request_id AND ((dfl.source_document_type='ACCOUNTS_PAYABLE' AND ap.id::text=dfl.source_document_id) OR (dfl.target_document_type='ACCOUNTS_PAYABLE' AND ap.id::text=dfl.target_document_id))
       LEFT JOIN suppliers s ON s.id = ap.supplier_id
       LEFT JOIN payment_records pr ON pr.request_id=dfl.request_id AND ((dfl.source_document_type='PAYMENT' AND pr.id::text=dfl.source_document_id) OR (dfl.target_document_type='PAYMENT' AND pr.id::text=dfl.target_document_id))
       ${whereClause}
       ORDER BY dfl.created_at DESC
       LIMIT 500`,
      values
    );
    return ({ data: rows });
    }, {});
    res.json(result);
  } catch (error) { next(error); }
};

const getLifecycleDetail = async (req, res, next) => {
  try {
    const result = await withRead(req.user,async (client,scopeActor) => {
    const requestId = parseRequestId(req.params.requestId);

    const [lifecycle, stateHistory, requestMeta, requestItems, purchaseOrders, receipts, invoices, matches, vouchers, postings, payables, payments, actions, flowLinks, commitments, glPostings, journalEntries, linkedInventory] = await Promise.all([
      client.query(`SELECT * FROM procurement_lifecycle_states WHERE request_id = $1`, [requestId]),
      client.query(`SELECT * FROM procurement_state_history WHERE request_id = $1 ORDER BY changed_at DESC`, [requestId]),
      client.query(
        `SELECT r.id, r.request_type, r.status, r.supply_warehouse_id, r.department_id,
                w.name AS supply_warehouse_name
           FROM requests r
           LEFT JOIN warehouses w ON w.id = r.supply_warehouse_id
          WHERE r.id = $1`,
        [requestId]
      ),
      client.query(
        `SELECT id, item_name, quantity, unit_cost
           FROM requested_items
          WHERE request_id = $1
          ORDER BY id ASC`,
        [requestId]
      ),
      client.query(`SELECT * FROM purchase_orders WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      client.query(`SELECT * FROM goods_receipts WHERE request_id = $1 ORDER BY received_at DESC`, [requestId]),
      client.query(`SELECT * FROM supplier_invoices WHERE request_id = $1 ORDER BY submitted_at DESC`, [requestId]),
      client.query(`SELECT * FROM invoice_match_results WHERE request_id = $1 ORDER BY matched_at DESC`, [requestId]),
      client.query(`SELECT * FROM ap_vouchers WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      client.query(`SELECT * FROM finance_postings WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      client.query(`SELECT * FROM ap_payables WHERE request_id = $1 ORDER BY posted_at DESC`, [requestId]),
      client.query(`SELECT * FROM payment_records WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      client.query(`SELECT * FROM finance_action_history WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      client.query(`SELECT dfl.* FROM document_flow_links dfl WHERE request_id = $1 AND ${flowPredicate('dfl','$2')} ORDER BY created_at ASC`, [requestId,scopeActor.institute_id]),
      client.query(`SELECT * FROM commitment_ledger WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      client.query(`SELECT glp.* FROM gl_postings glp JOIN journal_entries je ON je.id=glp.journal_entry_id AND je.request_id=glp.request_id AND je.source_type=glp.source_type AND je.source_id=glp.source_id WHERE glp.request_id=$1 AND ${invoiceJournalPredicate('glp','$2')} ORDER BY glp.posted_at DESC`,[requestId,scopeActor.institute_id]),
      client.query(`SELECT je.* FROM journal_entries je WHERE je.request_id=$1 AND ${invoiceJournalPredicate('je','$2')} ORDER BY je.posted_at DESC`,[requestId,scopeActor.institute_id]),
      client.query(
        `SELECT wsl.warehouse_id,
                w.name AS warehouse_name,
                wsl.stock_item_id,
                wsl.item_name,
                wsl.quantity,
                wsl.updated_at
           FROM warehouse_stock_levels wsl
           JOIN requests r ON r.id = $1 AND r.supply_warehouse_id = wsl.warehouse_id
           LEFT JOIN warehouses w ON w.id = wsl.warehouse_id
          WHERE EXISTS (
            SELECT 1
              FROM requested_items ri
             WHERE ri.request_id = $1
               AND LOWER(ri.item_name) = LOWER(wsl.item_name)
          )
          ORDER BY wsl.item_name ASC`,
        [requestId]
      ),
    ]);

    return ({
      lifecycle: lifecycle.rows[0] || null,
      request: requestMeta.rows[0] || null,
      request_items: requestItems.rows,
      state_history: stateHistory.rows,
      purchase_orders: purchaseOrders.rows.map(annotatePurchaseOrder),
      receipts: receipts.rows,
      invoices: invoices.rows,
      match_results: matches.rows,
      vouchers: vouchers.rows,
      postings: postings.rows,
      payables: payables.rows,
      payments: payments.rows,
      finance_actions: actions.rows,
      document_flow_links: flowLinks.rows,
      commitments: commitments.rows,
      gl_postings: glPostings.rows,
      journal_entries: journalEntries.rows,
      linked_inventory: linkedInventory.rows,
    });
    }, {requestId:req.params.requestId});
    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProcureToPayDashboard,
  getPoSourceRequests,
  getLifecycleDetail,
  createPurchaseOrder,
  submitPurchaseOrderForApproval,
  approvePurchaseOrder,
  issuePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  listPurchaseOrders,
  listGoodsReceipts,
  listOpenPosForReceipt,
  listApInvoices,
  listInvoiceMatchingQueue,
  getPurchaseOrderDetail,
  createGoodsReceipt,
  listReceiptsByRequest,
  submitInvoice,
  runInvoiceMatch,
  approveMatchOverride,
  declineInvoiceMatch,
  postPayableFromInvoice,
  listAccountsPayable,
  listPayments,
  recordPayablePayment,
  listDocumentFlow,
  getDocumentFlow,
  createApVoucher,
  verifyApVoucher,
  verifyFinanceRecord,
  postToInternalLedger,
  markPaymentPending,
  markPaid,
};