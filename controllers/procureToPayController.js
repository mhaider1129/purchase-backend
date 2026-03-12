const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureProcureToPayTables } = require('../utils/ensureProcureToPayTables');
const {
  LIFECYCLE_STATES,
  MATCH_POLICIES,
  performInvoiceMatch,
  canTransitionState,
} = require('../services/procureToPayService');
const { insertGoodsReceipt, insertSupplierInvoice } = require('../services/procureToPayPersistenceService');


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
    [requestId, LIFECYCLE_STATES.REQUEST_CREATED, userId || null]
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
    requirePermission(req, 'warehouse.manage-supply', ['warehousekeeper', 'warehousemanager', 'scm', 'admin']);
    const requestId = Number(req.params.requestId);
    const { warehouse_location = null, received_at, notes = null, discrepancy_notes = null, items = [] } = req.body;

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw createHttpError(400, 'Invalid request id');
    }
    await client.query('BEGIN');
    await ensureProcureToPayTables(client);
    await ensureLifecycleRow(client, requestId, req.user.id);

    const receipt = await insertGoodsReceipt(client, {
      requestId,
      userId: req.user.id,
      warehouseLocation: warehouse_location,
      receivedAt: received_at || null,
      notes,
      discrepancyNotes: discrepancy_notes,
      items,
    });

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.GOODS_RECEIVED, req.user.id, 'Goods receipt captured');
    await logFinanceAction(client, requestId, req.user.id, 'GOODS_RECEIPT_CREATED', { receipt_id: receipt.id });
    await client.query('COMMIT');

    res.status(201).json({ message: 'Goods receipt captured', receipt });
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
    requirePermission(req, 'procurement.update-status', ['procurementspecialist', 'scm', 'admin']);
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
      po_equivalent_number = null,
      receipt_id = null,
      attachment_metadata = null,
      items = [],
    } = req.body;

    await client.query('BEGIN');
    await ensureProcureToPayTables(client);
    await ensureLifecycleRow(client, requestId, req.user.id);

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
      poEquivalentNumber: po_equivalent_number,
      receiptId: receipt_id,
      attachmentMetadata: attachment_metadata,
      items,
    });

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.INVOICE_RECEIVED, req.user.id, 'Invoice submitted');
    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.INVOICE_MATCH_PENDING, req.user.id, 'Awaiting matching');
    await logFinanceAction(client, requestId, req.user.id, 'SUPPLIER_INVOICE_SUBMITTED', { supplier_invoice_id: invoice.id });

    await client.query('COMMIT');
    res.status(201).json({ message: 'Invoice submitted', invoice });
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
    requirePermission(req, 'procurement.update-status', ['procurementspecialist', 'scm', 'admin']);
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
      await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.INVOICE_MATCHED, req.user.id, 'Invoice matched', result);
      await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.FINANCE_REVIEW_PENDING, req.user.id, 'Ready for finance review');
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

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.FINANCE_REVIEW_PENDING, req.user.id, 'Mismatch override approved');
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

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.FINANCE_VERIFIED, req.user.id, 'Finance verified');
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

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.AP_VOUCHER_CREATED, req.user.id, 'AP voucher created');
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

    await transitionLifecycleState(client, requestId, LIFECYCLE_STATES.POSTED_TO_INTERNAL_LEDGER, req.user.id, 'Posted to internal ledger');
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

const getLifecycleDetail = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);
    await ensureProcureToPayTables();

    const [lifecycle, stateHistory, receipts, invoices, matches, vouchers, postings, payments, actions] = await Promise.all([
      pool.query(`SELECT * FROM procurement_lifecycle_states WHERE request_id = $1`, [requestId]),
      pool.query(`SELECT * FROM procurement_state_history WHERE request_id = $1 ORDER BY changed_at DESC`, [requestId]),
      pool.query(`SELECT * FROM goods_receipts WHERE request_id = $1 ORDER BY received_at DESC`, [requestId]),
      pool.query(`SELECT * FROM supplier_invoices WHERE request_id = $1 ORDER BY submitted_at DESC`, [requestId]),
      pool.query(`SELECT * FROM invoice_match_results WHERE request_id = $1 ORDER BY matched_at DESC`, [requestId]),
      pool.query(`SELECT * FROM ap_vouchers WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      pool.query(`SELECT * FROM finance_postings WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      pool.query(`SELECT * FROM payment_records WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
      pool.query(`SELECT * FROM finance_action_history WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]),
    ]);

    res.json({
      lifecycle: lifecycle.rows[0] || null,
      state_history: stateHistory.rows,
      receipts: receipts.rows,
      invoices: invoices.rows,
      match_results: matches.rows,
      vouchers: vouchers.rows,
      postings: postings.rows,
      payments: payments.rows,
      finance_actions: actions.rows,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLifecycleDetail,
  createGoodsReceipt,
  listReceiptsByRequest,
  submitInvoice,
  runInvoiceMatch,
  approveMatchOverride,
  createApVoucher,
  verifyFinanceRecord,
  postToInternalLedger,
  markPaymentPending,
  markPaid,
};