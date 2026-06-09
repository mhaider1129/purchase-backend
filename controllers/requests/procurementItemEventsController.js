const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const { ensureRequestedItemFinancialsTable } = require('../../utils/ensureRequestedItemFinancialsTable');

const PRIVILEGED_ROLES = new Set(['SCM', 'Admin', 'Procurement Supervisor', 'ProcurementSupervisor']);
const BLOCKED_REQUEST_STATUSES = new Set(['rejected', 'cancelled', 'canceled', 'closed', 'completed', 'received']);
const BLOCKED_ITEM_STATUSES = new Set(['purchased', 'completed', 'fully_procured', 'canceled', 'cancelled', 'not_procured', 'unable_to_procure']);

const parsePositiveInteger = (value, fieldLabel) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw createHttpError(400, `${fieldLabel} must be a positive integer`);
  }
  return numeric;
};

const parseOptionalNonNegativeNumber = (value, fieldLabel) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw createHttpError(400, `${fieldLabel} must be a non-negative number`);
  }
  return numeric;
};

const parseOptionalDate = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw createHttpError(400, 'procurement_date must be a valid YYYY-MM-DD date');
  }
  return text;
};

const hasProcurementEventAccess = (req, requestRow, itemRow) => {
  if (requestRow.assigned_to && Number(requestRow.assigned_to) === Number(req.user.id)) return true;
  if (itemRow.assigned_to && Number(itemRow.assigned_to) === Number(req.user.id)) return true;
  if (req.user.hasPermission?.('requests.manage')) return true;
  return PRIVILEGED_ROLES.has(req.user.role);
};

const deriveItemStatus = (newPurchasedQuantity, requestedQuantity) => {
  if (newPurchasedQuantity <= 0) return 'pending';
  if (newPurchasedQuantity < requestedQuantity) return 'partially_procured';
  return 'purchased';
};

const recalculateRequestProcurementStatus = async (client, requestId) => {
  const { rows } = await client.query(
    `SELECT
       COUNT(*)::int AS total_items,
       COUNT(*) FILTER (WHERE COALESCE(purchased_quantity, 0) >= quantity)::int AS fully_procured_items,
       COUNT(*) FILTER (WHERE COALESCE(purchased_quantity, 0) > 0)::int AS started_items
     FROM public.requested_items
     WHERE request_id = $1
       AND COALESCE(approval_status, 'Approved') <> 'Rejected'
       AND COALESCE(procurement_status, '') NOT IN ('not_procured', 'canceled', 'cancelled', 'unable_to_procure')`,
    [requestId]
  );

  const summary = rows[0] || { total_items: 0, fully_procured_items: 0, started_items: 0 };
  const totalItems = Number(summary.total_items || 0);
  const fullyProcuredItems = Number(summary.fully_procured_items || 0);
  const startedItems = Number(summary.started_items || 0);

  if (totalItems > 0 && fullyProcuredItems >= totalItems) {
    await client.query(
      `UPDATE requests
       SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [requestId]
    );
    return 'completed';
  }

  if (startedItems > 0) {
    await client.query(
      `UPDATE requests
       SET status = 'Partially Procured', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'pending') NOT IN ('completed', 'received', 'rejected', 'cancelled', 'canceled', 'closed')`,
      [requestId]
    );
    return 'Partially Procured';
  }

  await client.query(
    `UPDATE requests
     SET status = CASE WHEN assigned_to IS NOT NULL THEN 'Assigned' ELSE status END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'pending') NOT IN ('completed', 'received', 'rejected', 'cancelled', 'canceled', 'closed')`,
    [requestId]
  );
  return 'Assigned';
};

const addProcurementItemEvent = async (req, res, next) => {
  const requestId = parseInt(req.params.requestId, 10);
  const itemId = parseInt(req.params.itemId, 10);

  if (!Number.isInteger(requestId) || requestId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
    return next(createHttpError(400, 'requestId and itemId must be positive integers'));
  }

  let eventQuantity;
  let unitCost;
  let procurementDate;
  let supplierId;
  try {
    eventQuantity = parsePositiveInteger(req.body?.event_quantity, 'event_quantity');
    unitCost = parseOptionalNonNegativeNumber(req.body?.unit_cost, 'unit_cost');
    procurementDate = parseOptionalDate(req.body?.procurement_date);
    supplierId = req.body?.supplier_id === undefined || req.body?.supplier_id === null || req.body?.supplier_id === ''
      ? null
      : parsePositiveInteger(req.body.supplier_id, 'supplier_id');
  } catch (err) {
    return next(err);
  }

  const supplierName = req.body?.supplier_name ? String(req.body.supplier_name).trim() : null;
  const procurementNote = req.body?.procurement_note ? String(req.body.procurement_note).trim() : null;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureRequestedItemFinancialsTable(client);

    const requestRes = await client.query(
      `SELECT id, status, assigned_to FROM requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );

    if (requestRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Request not found'));
    }

    const requestRow = requestRes.rows[0];
    const normalizedRequestStatus = String(requestRow.status || '').trim().toLowerCase();
    if (BLOCKED_REQUEST_STATUSES.has(normalizedRequestStatus)) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Cannot add procurement events to a rejected, cancelled, closed, completed, or received request'));
    }

    const itemRes = await client.query(
      `SELECT ri.*, r.assigned_to AS request_assigned_to
       FROM public.requested_items ri
       JOIN requests r ON r.id = ri.request_id
       WHERE ri.id = $1 AND ri.request_id = $2
       FOR UPDATE OF ri`,
      [itemId, requestId]
    );

    if (itemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Requested item not found for this request'));
    }

    const item = itemRes.rows[0];
    if (!hasProcurementEventAccess(req, requestRow, item)) {
      await client.query('ROLLBACK');
      return next(createHttpError(403, 'You must be assigned to this request or have SCM/Admin/Procurement Supervisor access'));
    }

    const requestedQuantity = Number(item.quantity || 0);
    const previousPurchasedQuantity = Number(item.purchased_quantity || 0);
    const remainingQuantityBeforeEvent = Math.max(requestedQuantity - previousPurchasedQuantity, 0);
    const normalizedItemStatus = String(item.procurement_status || '').trim().toLowerCase();

    if (BLOCKED_ITEM_STATUSES.has(normalizedItemStatus) || remainingQuantityBeforeEvent <= 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Item is already fully procured, cancelled, or unable to procure'));
    }

    if (eventQuantity > remainingQuantityBeforeEvent) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, `event_quantity cannot exceed remaining quantity (${remainingQuantityBeforeEvent})`));
    }

    if (supplierId !== null) {
      const supplierRes = await client.query(`SELECT id, name FROM suppliers WHERE id = $1`, [supplierId]);
      if (supplierRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(404, 'Supplier not found'));
      }
    }

    const newPurchasedQuantity = previousPurchasedQuantity + eventQuantity;
    const remainingQuantity = Math.max(requestedQuantity - newPurchasedQuantity, 0);
    const effectiveUnitCost = unitCost !== null ? unitCost : (item.unit_cost === null || item.unit_cost === undefined ? null : Number(item.unit_cost));
    const eventTotalCost = unitCost !== null ? Number((eventQuantity * unitCost).toFixed(2)) : null;
    const itemTotalCost = effectiveUnitCost !== null ? Number((newPurchasedQuantity * effectiveUnitCost).toFixed(2)) : item.total_cost;
    const procurementStatus = deriveItemStatus(newPurchasedQuantity, requestedQuantity);

    const eventRes = await client.query(
      `INSERT INTO public.procurement_item_events (
         request_id, requested_item_id, procurement_user_id, event_quantity,
         previous_purchased_quantity, new_purchased_quantity, remaining_quantity,
         unit_cost, total_cost, supplier_id, supplier_name, procurement_note, procurement_date
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::date, CURRENT_DATE))
       RETURNING *`,
      [
        requestId,
        itemId,
        userId,
        eventQuantity,
        previousPurchasedQuantity,
        newPurchasedQuantity,
        remainingQuantity,
        unitCost,
        eventTotalCost,
        supplierId,
        supplierName,
        procurementNote,
        procurementDate,
      ]
    );

    const updatedItemRes = await client.query(
      `UPDATE public.requested_items
       SET purchased_quantity = $1,
           unit_cost = COALESCE($2::numeric, unit_cost),
           total_cost = COALESCE($3::numeric, total_cost),
           procurement_status = $4,
           procurement_updated_by = $5,
           procurement_updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [newPurchasedQuantity, unitCost, itemTotalCost, procurementStatus, userId, itemId]
    );

    if (effectiveUnitCost !== null) {
      await client.query(
        `INSERT INTO public.requested_item_financials (requested_item_id, request_id, committed_cost, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (requested_item_id) DO UPDATE SET
           committed_cost = EXCLUDED.committed_cost,
           updated_at = now(),
           created_by = COALESCE(requested_item_financials.created_by, EXCLUDED.created_by)`,
        [itemId, requestId, itemTotalCost, userId]
      );
    }

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Procurement Entry Added', $2, $3)`,
      [requestId, userId, `Added procurement entry of ${eventQuantity} for '${item.item_name}'. Purchased quantity ${previousPurchasedQuantity} → ${newPurchasedQuantity}; remaining ${remainingQuantity}.`]
    );

    const requestProcurementStatus = await recalculateRequestProcurementStatus(client, requestId);

    await client.query('COMMIT');

    res.status(201).json({
      message: '✅ Procurement entry added successfully',
      event: eventRes.rows[0],
      item: updatedItemRes.rows[0],
      request_procurement_status: requestProcurementStatus,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add procurement entry:', err.message);
    next(err.statusCode ? err : createHttpError(500, 'Failed to add procurement entry'));
  } finally {
    client.release();
  }
};

const getProcurementItemEvents = async (req, res, next) => {
  const requestId = parseInt(req.params.requestId, 10);
  const itemId = parseInt(req.params.itemId, 10);

  if (!Number.isInteger(requestId) || requestId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
    return next(createHttpError(400, 'requestId and itemId must be positive integers'));
  }

  try {
    const accessRes = await pool.query(
      `SELECT r.id AS request_id, r.assigned_to, ri.id AS item_id, ri.assigned_to AS item_assigned_to
       FROM requests r
       JOIN public.requested_items ri ON ri.request_id = r.id AND ri.id = $2
       WHERE r.id = $1`,
      [requestId, itemId]
    );

    if (accessRes.rowCount === 0) {
      return next(createHttpError(404, 'Request item not found'));
    }

    const accessRow = accessRes.rows[0];
    if (!hasProcurementEventAccess(req, accessRow, { assigned_to: accessRow.item_assigned_to })) {
      return next(createHttpError(403, 'You do not have access to procurement events for this item'));
    }

    const eventsRes = await pool.query(
      `SELECT pie.*, u.name AS procurement_user_name
       FROM public.procurement_item_events pie
       LEFT JOIN users u ON u.id = pie.procurement_user_id
       WHERE pie.request_id = $1 AND pie.requested_item_id = $2
       ORDER BY pie.procurement_date ASC, pie.created_at ASC, pie.id ASC`,
      [requestId, itemId]
    );

    res.json({ events: eventsRes.rows });
  } catch (err) {
    console.error('❌ Failed to fetch procurement events:', err.message);
    next(createHttpError(500, 'Failed to fetch procurement events'));
  }
};

module.exports = {
  addProcurementItemEvent,
  getProcurementItemEvents,
  recalculateRequestProcurementStatus,
};