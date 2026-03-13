const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureProcureToPayTables } = require('../utils/ensureProcureToPayTables');
const { ensureFinanceCoreTables } = require('../utils/ensureFinanceCoreTables');
const ensureWarehouseInventoryTables = require('../utils/ensureWarehouseInventoryTables');
const recalculateAvailableQuantity = require('../utils/recalculateAvailableQuantity');
const {
  LIFECYCLE_STATES,
  MATCH_POLICIES,
  performInvoiceMatch,
  canTransitionState,
} = require('../services/procureToPayService');
const { insertGoodsReceipt, insertSupplierInvoice } = require('../services/procureToPayPersistenceService');
const {
  assertBudgetCanCover,
  recordCommitment,
  postProcureToPayAccrual,
  resolveBudgetEnvelope,
  getBudgetSnapshot,
} = require('../services/financeCoreService');


const requirePermission = (req, permissionCode, fallbackRoles = []) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (req.user?.hasPermission?.(permissionCode) || fallbackRoles.includes(role)) {
    return;
  }
  throw createHttpError(403, 'You do not have permission to perform this action');
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

const ensureLifecycleRow = async (client, requestId, userId) => {
  await client.query(
    `INSERT INTO procurement_lifecycle_states (request_id, procurement_state, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (request_id) DO NOTHING`,
    [requestId, LIFECYCLE_STATES.DRAFT_PR, userId || null]
  );
};

const transitionLifecycleState = async (client, requestId, toState, userId, reason = null, metadata = null) => {
  const { rows } = await client.query(
    `SELECT procurement_state FROM procurement_lifecycle_states WHERE request_id = $1`,
    [requestId]
  );
  const fromState = rows[0]?.procurement_state || null;

  if (fromState === toState) {
    return;
  }

  if (!canTransitionState(fromState, toState)) {
    throw createHttpError(400, `Invalid lifecycle transition from ${fromState || 'N/A'} to ${toState}`);
  }

  await client.query(
    `UPDATE procurement_lifecycle_states
     SET procurement_state = $2, last_transition_at = NOW(), updated_at = NOW()
     WHERE request_id = $1`,
    [requestId, toState]
  );

  await client.query(
    `INSERT INTO procurement_state_history (request_id, from_state, to_state, changed_by, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [requestId, fromState, toState, userId || null, reason, metadata ? JSON.stringify(metadata) : null]
  );
};

const createGoodsReceipt = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'procure-to-pay.receipts.manage', ['warehousekeeper', 'warehousemanager', 'scm', 'admin']);
    const requestId = Number(req.params.requestId);
    const {
      purchase_order_id = null,
      warehouse_id,
      warehouse_location = null,
      received_at,
      notes = null,
      discrepancy_notes = null,
      items = [],
    } = req.body;

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw createHttpError(400, 'Invalid request id');
    }
    await client.query('BEGIN');
    await ensureProcureToPayTables(client);
    await ensureWarehouseInventoryTables(client);
    await ensureFinanceCoreTables(client);
    await ensureLifecycleRow(client, requestId, req.user.id);

    const requestRes = await client.query(
      `SELECT supply_warehouse_id, department_id, project_id FROM requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );

    if (requestRes.rowCount === 0) {
      throw createHttpError(404, 'Request not found');
    }

    const fallbackWarehouseId = requestRes.rows[0].supply_warehouse_id || req.user?.warehouse_id || null;
    const explicitWarehouseId = warehouse_id === undefined || warehouse_id === null || warehouse_id === ''
      ? null
      : Number(warehouse_id);
    const targetWarehouseId = explicitWarehouseId || Number(fallbackWarehouseId);

    if (!Number.isInteger(targetWarehouseId) || targetWarehouseId <= 0) {
      throw createHttpError(400, 'A valid warehouse_id is required to update warehouse stock');
    }

    const receipt = await insertGoodsReceipt(client, {
      requestId,
      userId: req.user.id,
      purchaseOrderId: purchase_order_id,
      warehouseLocation: warehouse_location,
      receivedAt: received_at || null,
      notes,
      discrepancyNotes: discrepancy_notes,
      items,
    });


    await client.query(
      `INSERT INTO document_flow_links (request_id, source_document_type, source_document_id, target_document_type, target_document_id, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        requestId,
        purchase_order_id ? 'PURCHASE_ORDER' : 'PURCHASE_REQUEST',
        String(purchase_order_id || requestId),
        'GOODS_RECEIPT_PO',
        String(receipt.id),
        JSON.stringify({ receipt_number: receipt.receipt_number }),
        req.user.id,
      ]
    );

    const inventoryUpdates = [];
    const inventoryWarnings = [];

    for (const receiptItem of receipt.items || []) {
      const receivedQuantity = Number(receiptItem.received_quantity) || 0;
      const damagedQuantity = Number(receiptItem.damaged_quantity) || 0;
      const shortQuantity = Number(receiptItem.short_quantity) || 0;
      const netQuantity = receivedQuantity - damagedQuantity - shortQuantity;

      if (netQuantity <= 0) {
        inventoryWarnings.push(`Skipped ${receiptItem.item_name}: net received quantity is 0 after discrepancy values.`);
        continue;
      }

      let stockItem = null;

      if (receiptItem.requested_item_id) {
        const fromRequested = await client.query(
          `SELECT si.id, si.name
           FROM requested_items ri
           JOIN stock_items si ON LOWER(si.name) = LOWER(ri.item_name)
           WHERE ri.id = $1 AND ri.request_id = $2
           LIMIT 1`,
          [receiptItem.requested_item_id, requestId]
        );
        stockItem = fromRequested.rows[0] || null;
      }

      if (!stockItem) {
        const fromItemName = await client.query(
          `SELECT id, name FROM stock_items WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [receiptItem.item_name]
        );
        stockItem = fromItemName.rows[0] || null;
      }

      if (!stockItem) {
        inventoryWarnings.push(`No stock item found for "${receiptItem.item_name}". Warehouse stock was not updated for this line.`);
        continue;
      }

      await client.query(
        `INSERT INTO warehouse_stock_levels (
          warehouse_id,
          stock_item_id,
          item_name,
          quantity,
          updated_by,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (warehouse_id, stock_item_id)
        DO UPDATE
          SET quantity = warehouse_stock_levels.quantity + EXCLUDED.quantity,
              item_name = EXCLUDED.item_name,
              updated_by = EXCLUDED.updated_by,
              updated_at = NOW()`,
        [targetWarehouseId, stockItem.id, stockItem.name, netQuantity, req.user.id]
      );

      await recalculateAvailableQuantity(client, stockItem.id);

      await client.query(
        `INSERT INTO warehouse_stock_movements (
          warehouse_id,
          stock_item_id,
          item_name,
          direction,
          quantity,
          reference_request_id,
          created_by,
          notes
        ) VALUES ($1, $2, $3, 'in', $4, $5, $6, $7)`,
        [
          targetWarehouseId,
          stockItem.id,
          stockItem.name,
          netQuantity,
          requestId,
          req.user.id,
          `Goods receipt ${receipt.receipt_number}`,
        ]
      );

      inventoryUpdates.push({
        stock_item_id: stockItem.id,
        item_name: stockItem.name,
        quantity_added: netQuantity,
      });
    }

    const estimatedReceiptValue = (receipt.items || []).reduce((sum, line) => {
      const netQuantity =
        (Number(line.received_quantity) || 0) -
        (Number(line.damaged_quantity) || 0) -
        (Number(line.short_quantity) || 0);
      const unitPrice = Number(line.unit_price) || 0;
      return sum + (netQuantity > 0 ? netQuantity * unitPrice : 0);
    }, 0);

    const requestMeta = requestRes.rows[0];
    const receiptBudgetEnvelope = await resolveBudgetEnvelope(client, {
      departmentId: requestMeta.department_id,
      projectId: requestMeta.project_id || null,
      currency: 'USD',
    });

    let commitmentEntry = null;
    if (receiptBudgetEnvelope && estimatedReceiptValue > 0) {
      commitmentEntry = await recordCommitment(client, {
        requestId,
        budgetEnvelopeId: receiptBudgetEnvelope.id,
        stage: 'encumbrance',
        amount: estimatedReceiptValue,
        currency: 'USD',
        sourceType: 'goods_receipt',
        sourceId: String(receipt.id),
        notes: `Encumbrance from receipt ${receipt.receipt_number}`,
        actorId: req.user.id,
      });
    }

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.PO_PARTIALLY_RECEIVED, req.user.id, 'Goods receipt captured');
    await logFinanceAction(client, requestId, req.user.id, 'GOODS_RECEIPT_CREATED', {
      receipt_id: receipt.id,
      warehouse_id: targetWarehouseId,
      inventory_updates: inventoryUpdates,
      inventory_warnings: inventoryWarnings,
      encumbrance_commitment_id: commitmentEntry?.id || null,
    });
    await client.query('COMMIT');

    res.status(201).json({
      message: 'Goods receipt captured',
      receipt,
      warehouse_id: targetWarehouseId,
      inventory_updates: inventoryUpdates,
      inventory_warnings: inventoryWarnings,
      encumbrance_commitment_id: commitmentEntry?.id || null,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const listReceiptsByRequest = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);
    await ensureProcureToPayTables();
    await ensureFinanceCoreTables();
    const { rows } = await pool.query(
      `SELECT gr.*, COALESCE(json_agg(gri.*) FILTER (WHERE gri.id IS NOT NULL), '[]'::json) AS items
       FROM goods_receipts gr
       LEFT JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
       WHERE gr.request_id = $1
       GROUP BY gr.id
       ORDER BY gr.received_at DESC`,
      [requestId]
    );
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
};

const submitInvoice = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'procure-to-pay.invoices.manage', ['procurementspecialist', 'scm', 'admin']);
    const requestId = Number(req.params.requestId);
    const {
      supplier,
      invoice_number,
      invoice_date,
      subtotal_amount,
      tax_amount = 0,
      extra_charges = 0,
      total_amount,
      currency = 'USD',
      purchase_order_id = null,
      po_equivalent_number = null,
      receipt_id = null,
      attachment_metadata = null,
      items = [],
    } = req.body;

    await client.query('BEGIN');
    await ensureProcureToPayTables(client);
    await ensureFinanceCoreTables(client);
    await ensureLifecycleRow(client, requestId, req.user.id);

    const requestMetaRes = await client.query(
      `SELECT department_id, project_id FROM requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );

    if (requestMetaRes.rowCount === 0) {
      throw createHttpError(404, 'Request not found');
    }

    const requestMeta = requestMetaRes.rows[0];

    const budgetCheck = await assertBudgetCanCover(client, {
      departmentId: requestMeta.department_id,
      projectId: requestMeta.project_id || null,
      amount: Number(total_amount) || 0,
      currency,
    });

    const invoice = await insertSupplierInvoice(client, {
      requestId,
      userId: req.user.id,
      supplier,
      invoiceNumber: invoice_number,
      invoiceDate: invoice_date,
      subtotalAmount: subtotal_amount,
      taxAmount: tax_amount,
      extraCharges: extra_charges,
      totalAmount: total_amount,
      currency,
      purchaseOrderId: purchase_order_id,
      poEquivalentNumber: po_equivalent_number,
      receiptId: receipt_id,
      attachmentMetadata: attachment_metadata,
      items,
    });


    await client.query(
      `INSERT INTO document_flow_links (request_id, source_document_type, source_document_id, target_document_type, target_document_id, metadata, created_by)
       VALUES ($1,$2,$3,'AP_INVOICE',$4,$5,$6)`,
      [
        requestId,
        receipt_id ? 'GOODS_RECEIPT_PO' : (purchase_order_id ? 'PURCHASE_ORDER' : 'PURCHASE_REQUEST'),
        String(receipt_id || purchase_order_id || requestId),
        String(invoice.id),
        JSON.stringify({ invoice_number: invoice.invoice_number }),
        req.user.id,
      ]
    );

    const actualCommitment = await recordCommitment(client, {
      requestId,
      budgetEnvelopeId: budgetCheck.envelope.id,
      stage: 'actual',
      amount: Number(total_amount) || 0,
      currency,
      sourceType: 'supplier_invoice',
      sourceId: String(invoice.id),
      notes: `Actual spend from supplier invoice ${invoice.invoice_number}`,
      actorId: req.user.id,
    });

    const glPosting = await postProcureToPayAccrual(client, {
      requestId,
      sourceId: invoice.id,
      amount: Number(total_amount) || 0,
      currency,
      actorId: req.user.id,
    });

    const budgetSnapshot = await getBudgetSnapshot(client, budgetCheck.envelope.id);

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.AP_INVOICE_SUBMITTED, req.user.id, 'Invoice submitted');
    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.MATCH_PENDING, req.user.id, 'Awaiting matching');
    await logFinanceAction(client, requestId, req.user.id, 'SUPPLIER_INVOICE_SUBMITTED', {
      supplier_invoice_id: invoice.id,
      budget_envelope_id: budgetCheck.envelope.id,
      actual_commitment_id: actualCommitment?.id || null,
      gl_posting_id: glPosting?.id || null,
    });

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Invoice submitted',
      invoice,
      budget: budgetSnapshot,
      actual_commitment: actualCommitment,
      gl_posting: glPosting,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const runInvoiceMatch = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'procure-to-pay.match.manage', ['procurementspecialist', 'scm', 'admin']);
    const requestId = Number(req.params.requestId);
    const supplierInvoiceId = Number(req.params.invoiceId);
    const policy = req.body?.policy === MATCH_POLICIES.TWO_WAY ? MATCH_POLICIES.TWO_WAY : MATCH_POLICIES.THREE_WAY;

    await client.query('BEGIN');
    await ensureProcureToPayTables(client);

    const requestItemsRes = await client.query(
      `SELECT quantity, unit_cost FROM requested_items WHERE request_id = $1`,
      [requestId]
    );
    const receiptItemsRes = await client.query(
      `SELECT gri.received_quantity AS quantity, gri.unit_price
       FROM goods_receipt_items gri
       JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
       WHERE gr.request_id = $1`,
      [requestId]
    );
    const invoiceItemsRes = await client.query(
      `SELECT quantity, unit_price FROM invoice_items WHERE supplier_invoice_id = $1`,
      [supplierInvoiceId]
    );

    const result = performInvoiceMatch({
      policy,
      requestItems: requestItemsRes.rows,
      receiptItems: receiptItemsRes.rows,
      invoiceItems: invoiceItemsRes.rows,
    });

    const saved = await client.query(
      `INSERT INTO invoice_match_results (request_id, supplier_invoice_id, match_policy, match_status, mismatch_reasons, matched_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        requestId,
        supplierInvoiceId,
        result.policy,
        result.matched ? 'MATCHED' : 'MISMATCH',
        JSON.stringify(result.mismatch_reasons),
        req.user.id,
      ]
    );

    if (result.matched) {
      await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.MATCH_VERIFIED, req.user.id, 'Invoice matched', result);
      await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.MATCH_EXCEPTION, req.user.id, 'Ready for finance review');
    }

    await logFinanceAction(client, requestId, req.user.id, 'INVOICE_MATCH_EXECUTED', { invoice_match_result_id: saved.rows[0].id, ...result });

    await client.query('COMMIT');
    res.json({ match_result: { ...saved.rows[0], ...result } });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const approveMatchOverride = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'finance.override-mismatch', ['scm', 'admin', 'financeapprover']);
    const requestId = Number(req.params.requestId);
    const matchResultId = Number(req.params.matchResultId);
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      throw createHttpError(400, 'Override reason is required');
    }

    await client.query('BEGIN');
    await ensureProcureToPayTables(client);

    const updated = await client.query(
      `UPDATE invoice_match_results
       SET override_approved = TRUE,
           override_by = $2,
           override_reason = $3,
           override_at = NOW(),
           match_status = 'OVERRIDDEN'
       WHERE id = $1
       RETURNING *`,
      [matchResultId, req.user.id, reason]
    );

    if (updated.rowCount === 0) {
      throw createHttpError(404, 'Match result not found');
    }

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.MATCH_EXCEPTION, req.user.id, 'Mismatch override approved');
    await logFinanceAction(client, requestId, req.user.id, 'MISMATCH_OVERRIDE_APPROVED', { match_result_id: matchResultId, reason });
    await client.query('COMMIT');
    res.json({ message: 'Override approved', match_result: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const verifyFinanceRecord = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'finance.verify', ['finance', 'scm', 'admin']);
    const requestId = Number(req.params.requestId);

    await client.query('BEGIN');
    await ensureProcureToPayTables(client);

    const latestMatch = await client.query(
      `SELECT * FROM invoice_match_results
       WHERE request_id = $1
       ORDER BY matched_at DESC
       LIMIT 1`,
      [requestId]
    );

    const match = latestMatch.rows[0];
    if (!match || !['MATCHED', 'OVERRIDDEN'].includes(match.match_status)) {
      throw createHttpError(400, 'Invoice matching must pass or be overridden before finance verification');
    }

    await client.query(
      `UPDATE procurement_lifecycle_states
       SET finance_state = 'verified', updated_at = NOW()
       WHERE request_id = $1`,
      [requestId]
    );

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.MATCH_VERIFIED, req.user.id, 'Finance verified');
    await logFinanceAction(client, requestId, req.user.id, 'FINANCE_VERIFIED', {});

    await client.query('COMMIT');
    res.json({ message: 'Finance record verified' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const createApVoucher = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'finance.voucher.create', ['finance', 'scm', 'admin']);
    const requestId = Number(req.params.requestId);
    const { supplier_invoice_id = null, currency = 'USD', total_amount, lines = [] } = req.body;

    if (Number(total_amount) <= 0 || !Array.isArray(lines) || lines.length === 0) {
      throw createHttpError(400, 'total_amount and at least one voucher line are required');
    }

    await client.query('BEGIN');
    await ensureProcureToPayTables(client);

    const voucher = await client.query(
      `INSERT INTO ap_vouchers (request_id, supplier_invoice_id, voucher_number, total_amount, currency, created_by)
       VALUES ($1,$2, CONCAT('APV-', $1, '-', EXTRACT(EPOCH FROM NOW())::bigint), $3, $4, $5)
       RETURNING *`,
      [requestId, supplier_invoice_id, total_amount, currency, req.user.id]
    );

    for (const [idx, line] of lines.entries()) {
      await client.query(
        `INSERT INTO ap_voucher_lines (ap_voucher_id, line_number, account_code, description, debit_amount, credit_amount, reference_type, reference_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          voucher.rows[0].id,
          idx + 1,
          line.account_code || null,
          line.description || `Line ${idx + 1}`,
          line.debit_amount || 0,
          line.credit_amount || 0,
          line.reference_type || null,
          line.reference_id || null,
        ]
      );
    }

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.AP_POSTED, req.user.id, 'AP voucher created');
    await logFinanceAction(client, requestId, req.user.id, 'AP_VOUCHER_CREATED', { ap_voucher_id: voucher.rows[0].id });

    await client.query('COMMIT');
    res.status(201).json({ voucher: voucher.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const postToInternalLedger = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'finance.post-ledger', ['finance', 'scm', 'admin']);
    const requestId = Number(req.params.requestId);
    const { ap_voucher_id, liability_recognized_amount, posting_reference = null } = req.body;

    await client.query('BEGIN');
    await ensureProcureToPayTables(client);

    const posting = await client.query(
      `INSERT INTO finance_postings (request_id, ap_voucher_id, posting_status, posting_reference, liability_recognized_amount, posted_by, posted_at)
       VALUES ($1,$2,'posted',$3,$4,$5,NOW())
       RETURNING *`,
      [requestId, ap_voucher_id || null, posting_reference, liability_recognized_amount || 0, req.user.id]
    );

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.AP_POSTED, req.user.id, 'Posted to internal ledger');
    await logFinanceAction(client, requestId, req.user.id, 'POSTED_TO_INTERNAL_LEDGER', { finance_posting_id: posting.rows[0].id });

    await client.query('COMMIT');
    res.status(201).json({ posting: posting.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const markPaymentPending = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'finance.payment.manage', ['finance', 'scm', 'admin']);
    const requestId = Number(req.params.requestId);
    const { ap_voucher_id = null, payment_reference = null } = req.body;

    await client.query('BEGIN');
    await ensureProcureToPayTables(client);

    const payment = await client.query(
      `INSERT INTO payment_records (request_id, ap_voucher_id, payment_status, payment_reference)
       VALUES ($1,$2,'payment_pending',$3)
       RETURNING *`,
      [requestId, ap_voucher_id, payment_reference]
    );

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.PAYMENT_PENDING, req.user.id, 'Payment pending');
    await logFinanceAction(client, requestId, req.user.id, 'PAYMENT_PENDING_SET', { payment_record_id: payment.rows[0].id });

    await client.query('COMMIT');
    res.status(201).json({ payment: payment.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const markPaid = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'finance.payment.manage', ['finance', 'scm', 'admin']);
    const requestId = Number(req.params.requestId);
    const paymentId = Number(req.params.paymentId);
    const { amount_paid, payment_method = null, payment_reference = null } = req.body;

    await client.query('BEGIN');
    await ensureProcureToPayTables(client);

    const updated = await client.query(
      `UPDATE payment_records
       SET payment_status = 'paid',
           amount_paid = $2,
           payment_method = $3,
           payment_reference = COALESCE($4, payment_reference),
           paid_at = NOW(),
           paid_by = $5
       WHERE id = $1
       RETURNING *`,
      [paymentId, amount_paid || 0, payment_method, payment_reference, req.user.id]
    );

    if (updated.rowCount === 0) {
      throw createHttpError(404, 'Payment record not found');
    }

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.PAID, req.user.id, 'Payment completed');
    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.CLOSED, req.user.id, 'Lifecycle closed');
    await logFinanceAction(client, requestId, req.user.id, 'PAYMENT_MARKED_PAID', { payment_record_id: paymentId });

    await client.query('COMMIT');
    res.json({ payment: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};


const createPurchaseOrder = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'procure-to-pay.purchase-orders.manage', ['scm', 'procurementspecialist', 'admin']);
    const requestId = Number(req.params.requestId);
    const { supplier_id = null, supplier_name = null, expected_delivery_date = null, terms = null, items = [] } = req.body || {};
    await client.query('BEGIN');
    await ensureProcureToPayTables(client);
    await ensureLifecycleRow(client, requestId, req.user.id);

    const poRes = await client.query(
      `INSERT INTO purchase_orders (request_id, po_number, supplier_id, supplier_name, expected_delivery_date, terms, status, created_by)
       VALUES ($1, CONCAT('PO-', $1, '-', EXTRACT(EPOCH FROM NOW())::bigint), $2, $3, $4, $5, 'PO_ISSUED', $6)
       RETURNING *`,
      [requestId, supplier_id, supplier_name, expected_delivery_date, terms, req.user.id]
    );

    const sourceItems = items.length ? items : (await client.query(`SELECT id AS requested_item_id, item_name, quantity, COALESCE(unit_cost,0) AS unit_price FROM requested_items WHERE request_id=$1`, [requestId])).rows;
    for (const item of sourceItems) {
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, requested_item_id, item_name, quantity, unit_price)
         VALUES ($1,$2,$3,$4,$5)`,
        [poRes.rows[0].id, item.requested_item_id || null, item.item_name, Number(item.quantity) || 0, Number(item.unit_price) || 0]
      );
    }

    await client.query(`INSERT INTO document_flow_links (request_id, source_document_type, source_document_id, target_document_type, target_document_id, created_by)
      VALUES ($1,'PURCHASE_REQUEST',$1::text,'PURCHASE_ORDER',$2::text,$3)`, [requestId, poRes.rows[0].id, req.user.id]);
    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.PO_ISSUED, req.user.id, 'Purchase order issued');
    await logFinanceAction(client, requestId, req.user.id, 'PURCHASE_ORDER_CREATED', { purchase_order_id: poRes.rows[0].id });
    await client.query('COMMIT');
    res.status(201).json({ purchase_order: poRes.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
};

const listPurchaseOrders = async (req, res, next) => {
  try {
    await ensureProcureToPayTables();
    const requestId = Number(req.query.request_id || 0);
    const { rows } = requestId
      ? await pool.query(`SELECT * FROM purchase_orders WHERE request_id=$1 ORDER BY created_at DESC`, [requestId])
      : await pool.query(`SELECT * FROM purchase_orders ORDER BY created_at DESC LIMIT 200`);
    res.json({ data: rows });
  } catch (error) { next(error); }
};

const getPurchaseOrderDetail = async (req, res, next) => {
  try {
    await ensureProcureToPayTables();
    const poId = Number(req.params.poId);
    const [po, items, receipts, invoices] = await Promise.all([
      pool.query(`SELECT * FROM purchase_orders WHERE id=$1`, [poId]),
      pool.query(`SELECT * FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY id ASC`, [poId]),
      pool.query(`SELECT * FROM goods_receipts WHERE purchase_order_id=$1 ORDER BY received_at DESC`, [poId]),
      pool.query(`SELECT * FROM supplier_invoices WHERE purchase_order_id=$1 ORDER BY submitted_at DESC`, [poId]),
    ]);
    if (!po.rowCount) throw createHttpError(404, 'Purchase order not found');
    res.json({ purchase_order: po.rows[0], items: items.rows, receipts: receipts.rows, invoices: invoices.rows });
  } catch (error) { next(error); }
};

const postPayableFromInvoice = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'finance.verify', ['finance', 'financeapprover', 'admin']);
    const invoiceId = Number(req.params.invoiceId);
    await client.query('BEGIN');
    await ensureProcureToPayTables(client);
    const inv = await client.query(`SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE`, [invoiceId]);
    if (!inv.rowCount) throw createHttpError(404, 'Invoice not found');
    const invoice = inv.rows[0];
    const payable = await client.query(`INSERT INTO ap_payables (request_id, supplier_invoice_id, supplier_name, invoice_total, open_balance, due_date, posted_by)
      VALUES ($1,$2,$3,$4,$4,($5::date + INTERVAL '30 day')::date,$6) RETURNING *`,
      [invoice.request_id, invoice.id, invoice.supplier, invoice.total_amount, invoice.invoice_date, req.user.id]);

    await client.query(`INSERT INTO document_flow_links (request_id, source_document_type, source_document_id, target_document_type, target_document_id, created_by)
      VALUES ($1,'AP_INVOICE',$2::text,'ACCOUNTS_PAYABLE',$3::text,$4)`, [invoice.request_id, invoice.id, payable.rows[0].id, req.user.id]);
    await transitionLifecycleState(client, invoice.request_id, LIFECYCLE_STATES.AP_POSTED, req.user.id, 'Invoice posted to AP');
    await logFinanceAction(client, invoice.request_id, req.user.id, 'AP_PAYABLE_POSTED', { ap_payable_id: payable.rows[0].id });
    await client.query('COMMIT');
    res.status(201).json({ payable: payable.rows[0] });
  } catch (error) { await client.query('ROLLBACK'); next(error);} finally { client.release(); }
};

const listAccountsPayable = async (req, res, next) => {
  try {
    await ensureProcureToPayTables();
    const { rows } = await pool.query(`SELECT * FROM ap_payables ORDER BY posted_at DESC LIMIT 300`);
    res.json({ data: rows });
  } catch (error) { next(error); }
};

const recordPayablePayment = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requirePermission(req, 'finance.payment.manage', ['finance', 'financeapprover', 'admin']);
    const payableId = Number(req.params.payableId);
    const { amount, payment_method = null, payment_reference = null, payment_date = null } = req.body || {};
    const paidAmount = Number(amount);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) throw createHttpError(400, 'Valid amount is required');
    await client.query('BEGIN');
    await ensureProcureToPayTables(client);
    const payRes = await client.query(`SELECT * FROM ap_payables WHERE id=$1 FOR UPDATE`, [payableId]);
    if (!payRes.rowCount) throw createHttpError(404, 'Payable not found');
    const payable = payRes.rows[0];
    if (paidAmount > Number(payable.open_balance)) throw createHttpError(400, 'Amount exceeds open balance');
    const payment = await client.query(`INSERT INTO payment_records (request_id, payment_status, payment_reference, payment_method, amount_paid, paid_by, paid_at)
      VALUES ($1,'paid',$2,$3,$4,$5,COALESCE($6::timestamptz, NOW())) RETURNING *`,
      [payable.request_id, payment_reference, payment_method, paidAmount, req.user.id, payment_date]);
    await client.query(`INSERT INTO payment_allocations (payment_record_id, ap_payable_id, amount) VALUES ($1,$2,$3)`, [payment.rows[0].id, payableId, paidAmount]);

    await client.query(`INSERT INTO document_flow_links (request_id, source_document_type, source_document_id, target_document_type, target_document_id, metadata, created_by)
      VALUES ($1,'ACCOUNTS_PAYABLE',$2::text,'PAYMENT',$3::text,$4,$5)`,
      [payable.request_id, payableId, payment.rows[0].id, JSON.stringify({ amount: paidAmount }), req.user.id]);
    const nextBal = Number(payable.open_balance) - paidAmount;
    const status = nextBal <= 0 ? 'PAID' : 'PARTIALLY_PAID';
    await client.query(`UPDATE ap_payables SET open_balance=$2, payable_status=$3 WHERE id=$1`, [payableId, nextBal, status]);
    await transitionLifecycleState(client, payable.request_id, nextBal <= 0 ? LIFECYCLE_STATES.PAID : LIFECYCLE_STATES.PARTIALLY_PAID, req.user.id, 'Payment allocation recorded');
    await logFinanceAction(client, payable.request_id, req.user.id, 'PAYMENT_ALLOCATION_CREATED', { payable_id: payableId, amount: paidAmount });
    await client.query('COMMIT');
    res.status(201).json({ payment: payment.rows[0], open_balance: nextBal, payable_status: status });
  } catch (error) { await client.query('ROLLBACK'); next(error);} finally { client.release(); }
};

const getDocumentFlow = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);
    await ensureProcureToPayTables();
    const { rows } = await pool.query(`SELECT * FROM document_flow_links WHERE request_id=$1 ORDER BY created_at ASC`, [requestId]);
    res.json({ data: rows });
  } catch (error) { next(error); }
};

const getLifecycleDetail = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);
    await ensureProcureToPayTables();
    await ensureFinanceCoreTables();

    const [lifecycle, stateHistory, requestMeta, requestItems, purchaseOrders, receipts, invoices, matches, vouchers, postings, payables, payments, actions, flowLinks, commitments, glPostings] = await Promise.all([
      pool.query(`SELECT * FROM procurement_lifecycle_states WHERE request_id = $1`, [requestId]),
      pool.query(`SELECT * FROM procurement_state_history WHERE request_id = $1 ORDER BY changed_at DESC`, [requestId]),
      pool.query(
        `SELECT r.id, r.request_type, r.status, r.supply_warehouse_id, r.department_id,
                w.name AS supply_warehouse_name
           FROM requests r
           LEFT JOIN warehouses w ON w.id = r.supply_warehouse_id
          WHERE r.id = $1`,
        [requestId]
      ),
      pool.query(
        `SELECT id, item_name, quantity, unit_cost
           FROM requested_items
          WHERE request_id = $1
          ORDER BY id ASC`,
        [requestId]
      ),
      pool.query(`SELECT * FROM purchase_orders WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      pool.query(`SELECT * FROM goods_receipts WHERE request_id = $1 ORDER BY received_at DESC`, [requestId]),
      pool.query(`SELECT * FROM supplier_invoices WHERE request_id = $1 ORDER BY submitted_at DESC`, [requestId]),
      pool.query(`SELECT * FROM invoice_match_results WHERE request_id = $1 ORDER BY matched_at DESC`, [requestId]),
      pool.query(`SELECT * FROM ap_vouchers WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      pool.query(`SELECT * FROM finance_postings WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      pool.query(`SELECT * FROM ap_payables WHERE request_id = $1 ORDER BY posted_at DESC`, [requestId]),
      pool.query(`SELECT * FROM payment_records WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      pool.query(`SELECT * FROM finance_action_history WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      pool.query(`SELECT * FROM document_flow_links WHERE request_id = $1 ORDER BY created_at ASC`, [requestId]),
      pool.query(`SELECT * FROM commitment_ledger WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      pool.query(`SELECT * FROM gl_postings WHERE request_id = $1 ORDER BY posted_at DESC`, [requestId]),
    ]);

    res.json({
      lifecycle: lifecycle.rows[0] || null,
      request: requestMeta.rows[0] || null,
      request_items: requestItems.rows,
      state_history: stateHistory.rows,
      purchase_orders: purchaseOrders.rows,
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
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLifecycleDetail,
  createPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrderDetail,
  createGoodsReceipt,
  listReceiptsByRequest,
  submitInvoice,
  runInvoiceMatch,
  approveMatchOverride,
  postPayableFromInvoice,
  listAccountsPayable,
  recordPayablePayment,
  getDocumentFlow,
  createApVoucher,
  verifyFinanceRecord,
  postToInternalLedger,
  markPaymentPending,
  markPaid,
};