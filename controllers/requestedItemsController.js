//controllers/requestedItemsController.js
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureWarehouseSupplyTables } = require('../utils/ensureWarehouseSupplyTables');
const ensureRequestedItemPoIssuanceColumn = require('../utils/ensureRequestedItemPoIssuanceColumn');
const { ensureRequestedItemFinancialsTable } = require('../utils/ensureRequestedItemFinancialsTable');

const parseOptionalNumber = (value, fieldLabel) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw createHttpError(400, `${fieldLabel} must be a non-negative number`);
  }

  return numeric;
};

const parseOptionalInteger = (value, fieldLabel) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw createHttpError(400, `${fieldLabel} must be a positive integer`);
  }

  return numeric;
};

const fetchRequestBaseline = async (client, requestId) => {
  const { rows } = await client.query(
    `SELECT estimated_cost FROM requests WHERE id = $1 LIMIT 1`,
    [requestId]
  );

  const estimated = rows[0]?.estimated_cost;
  const numericEstimated = Number(estimated);
  return Number.isFinite(numericEstimated) ? numericEstimated : null;
};

const fetchContractSnapshot = async (client, contractId) => {
  if (!contractId) {
    return { contractId: null, contractValue: null };
  }

  const parsedId = parseOptionalInteger(contractId, 'contract_id');
  const { rows } = await client.query(
    `SELECT contract_value FROM contracts WHERE id = $1 LIMIT 1`,
    [parsedId]
  );

  if (rows.length === 0) {
    throw createHttpError(404, `Contract #${parsedId} was not found`);
  }

  const numericValue = rows[0]?.contract_value;
  return {
    contractId: parsedId,
    contractValue: numericValue === null || numericValue === undefined ? null : Number(numericValue),
  };
};

const upsertItemFinancials = async (client, item, updates, userId) => {
  await ensureRequestedItemFinancialsTable(client);

  const requestBaseline =
    updates.savings_baseline !== undefined
      ? updates.savings_baseline
      : await fetchRequestBaseline(client, item.request_id);

  const { contractId, contractValue } = await fetchContractSnapshot(
    client,
    updates.contract_id
  );

  const params = [
    item.id,
    item.request_id,
    updates.po_number || null,
    updates.invoice_number || null,
    updates.committed_cost ?? null,
    updates.paid_cost ?? null,
    updates.currency || null,
    updates.savings_driver || null,
    updates.savings_notes || null,
    requestBaseline,
    contractId,
    updates.contract_value_snapshot ?? contractValue,
    userId || null,
  ];

  await client.query(
    `INSERT INTO public.requested_item_financials (
       requested_item_id,
       request_id,
       po_number,
       invoice_number,
       committed_cost,
       paid_cost,
       currency,
       savings_driver,
       savings_notes,
       savings_baseline,
       contract_id,
       contract_value_snapshot,
       created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (requested_item_id) DO UPDATE SET
       po_number = COALESCE(EXCLUDED.po_number, requested_item_financials.po_number),
       invoice_number = COALESCE(EXCLUDED.invoice_number, requested_item_financials.invoice_number),
       committed_cost = COALESCE(EXCLUDED.committed_cost, requested_item_financials.committed_cost),
       paid_cost = COALESCE(EXCLUDED.paid_cost, requested_item_financials.paid_cost),
       currency = COALESCE(EXCLUDED.currency, requested_item_financials.currency),
       savings_driver = COALESCE(EXCLUDED.savings_driver, requested_item_financials.savings_driver),
       savings_notes = COALESCE(EXCLUDED.savings_notes, requested_item_financials.savings_notes),
       savings_baseline = COALESCE(EXCLUDED.savings_baseline, requested_item_financials.savings_baseline),
       contract_id = COALESCE(EXCLUDED.contract_id, requested_item_financials.contract_id),
       contract_value_snapshot = COALESCE(EXCLUDED.contract_value_snapshot, requested_item_financials.contract_value_snapshot),
       updated_at = now(),
       created_by = COALESCE(requested_item_financials.created_by, EXCLUDED.created_by)`
    ,
    params
  );
};


// 📦 Add multiple items to a request
const addRequestedItems = async (req, res, next) => {
  const { request_id, items } = req.body;
  const { id: user_id } = req.user;

  if (!request_id || !Array.isArray(items) || items.length === 0) {
    return next(createHttpError(400, 'Invalid input: request_id and items are required'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureRequestedItemFinancialsTable(client);
    const insertedItems = [];

    const typeRes = await client.query('SELECT request_type FROM requests WHERE id = $1', [request_id]);
    const reqType = typeRes.rows[0]?.request_type;
    if (!reqType) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Request not found'));
    }

    if (reqType === 'Warehouse Supply') {
      await ensureWarehouseSupplyTables(client);
    }

    for (const item of items) {
      const {
        item_name,
        brand = null,
        quantity,
        unit_cost = null,
        available_quantity = null,
        intended_use = null,
        specs = null,
        device_info = null,
        purchase_type = null,
        item_type = null
      } = item;

      if (!item_name || !quantity || quantity <= 0) {
        console.warn(`⚠️ Skipping invalid item:`, item);
        continue;
      }

      const total_cost = unit_cost && quantity ? unit_cost * quantity : null;

      if (reqType === 'Warehouse Supply') {
        const result = await client.query(
          `INSERT INTO warehouse_supply_items (request_id, requested_item_id, item_name, quantity)
           VALUES ($1, NULL, $2, $3)
           RETURNING *`,
          [request_id, item_name, quantity]
        );
        insertedItems.push(result.rows[0]);
      } else {
        let result;
        if (reqType === 'Stock') {
          result = await client.query(
            `INSERT INTO public.requested_items
              (request_id, item_name, brand, quantity, unit_cost, total_cost, available_quantity, intended_use, specs, device_info, purchase_type, item_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [
              request_id,
              item_name,
              brand,
              quantity,
              unit_cost,
              total_cost,
              isNaN(available_quantity) ? null : available_quantity,
              intended_use,
              specs,
              device_info,
              purchase_type,
              item_type
            ]
          );
        } else {
          result = await client.query(
            `INSERT INTO public.requested_items
              (request_id, item_name, brand, quantity, unit_cost, total_cost, available_quantity, intended_use, specs, device_info, purchase_type, item_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [
              request_id,
              item_name,
              quantity,
              unit_cost,
              total_cost,
              isNaN(available_quantity) ? null : available_quantity,
              intended_use,
              specs,
              device_info,
              purchase_type,
              item_type
            ]
          );
        }
        insertedItems.push(result.rows[0]);
      }
    }

    let newEstimatedCost = null;
    if (reqType !== 'Warehouse Supply') {
      const totalRes = await client.query(
        `SELECT COALESCE(SUM(quantity * unit_cost), 0) AS total FROM public.requested_items WHERE request_id = $1`,
        [request_id]
      );
      newEstimatedCost = parseFloat(totalRes.rows[0].total);

      await client.query(
        `UPDATE requests
         SET estimated_cost = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [newEstimatedCost, request_id]
      );
    }
    
    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Items Added', $2, $3)`,
      [request_id, user_id, `${insertedItems.length} items added`]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: '✅ Items added successfully',
      inserted_count: insertedItems.length,
      updated_estimated_cost: newEstimatedCost,
      insertedItems
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to insert requested items:', err.message);
    next(createHttpError(500, 'Failed to add requested items'));
  } finally {
    client.release();
  }
};

// 💲 Update unit cost of a single item
const updateItemCost = async (req, res, next) => {
  const { id } = req.params;
  const item_id = id;
  const { unit_cost } = req.body;
  const { id: user_id } = req.user;

  const parsedUnitCost = Number(unit_cost);
  if (Number.isNaN(parsedUnitCost) || parsedUnitCost < 0) {
    return next(createHttpError(400, 'Valid unit cost is required and must be zero or greater'));
  }

  if (!req.user.hasPermission('procurement.update-cost')) {
    return next(createHttpError(403, 'You do not have permission to update this cost'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureRequestedItemFinancialsTable(client);

    const itemRes = await client.query(
      `SELECT ri.*, r.assigned_to, r.estimated_cost AS request_estimated_cost
       FROM public.requested_items ri
       JOIN requests r ON ri.request_id = r.id
       WHERE ri.id = $1`,
      [item_id]
    );

    if (itemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Requested item not found'));
    }

    const item = itemRes.rows[0];

    await client.query(
      `UPDATE public.requested_items
       SET unit_cost = $1::numeric,
           total_cost = quantity * $1::numeric
      WHERE id = $2`,
      [parsedUnitCost, item_id]
    );

    const requestedQty = Number(item.purchased_quantity ?? item.quantity ?? 0);
    const committedCost =
      Number.isFinite(requestedQty) && requestedQty >= 0
        ? Number((requestedQty * parsedUnitCost).toFixed(2))
        : null;

    await upsertItemFinancials(
      client,
      item,
      {
        committed_cost: committedCost,
        savings_baseline:
          item.request_estimated_cost !== undefined
            ? Number(item.request_estimated_cost)
            : null,
      },
      user_id
    );

    const totalRes = await client.query(
      `SELECT COALESCE(SUM(quantity * unit_cost), 0) AS total FROM public.requested_items WHERE request_id = $1`,
      [item.request_id]
    );

    const newTotal = parseFloat(totalRes.rows[0].total);

    await client.query(
      `UPDATE requests
       SET estimated_cost = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [newTotal, item.request_id]
    );

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Unit Cost Updated', $2, $3)`,
      [
        item.request_id,
        user_id,
        `Updated unit cost for '${item.item_name}' (ID: ${item_id}) to ${parsedUnitCost}`,
      ]
    );

    await client.query('COMMIT');

    res.json({
      message: '✅ Unit cost updated successfully',
      updated_estimated_cost: newTotal
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update item cost:', err.message);
    next(createHttpError(500, 'Failed to update item cost'));
  } finally {
    client.release();
  }
};

// 🆕 ✅ Update procurement status
const updateItemProcurementStatus = async (req, res, next) => {
  const { item_id } = req.params;
  const {
    procurement_status,
    procurement_comment,
    po_issuance_method,
    invoice_number,
    paid_cost,
    committed_cost,
    currency,
    po_number,
    savings_driver,
    savings_notes,
    contract_id,
    contract_value_snapshot,
  } = req.body;
  const { id: user_id } = req.user;

  const allowedStatuses = [
    'pending',
    'purchased',
    'not_procured',
    'completed',
    'canceled',
  ];

  let parsedCommittedCost;
  let parsedPaidCost;
  let parsedContractId;
  let parsedContractSnapshot;
  try {
    parsedCommittedCost = parseOptionalNumber(committed_cost, 'committed_cost');
    parsedPaidCost = parseOptionalNumber(paid_cost, 'paid_cost');
    parsedContractId = parseOptionalInteger(contract_id, 'contract_id');
    parsedContractSnapshot = parseOptionalNumber(
      contract_value_snapshot,
      'contract_value_snapshot'
    );
  } catch (err) {
    return next(err);
  }

  if (!req.user.hasPermission('procurement.update-status')) {
    return next(createHttpError(403, 'You do not have permission to update procurement status'));
  }

  if (!procurement_status || !allowedStatuses.includes(procurement_status)) {
    return next(
      createHttpError(400, 'Invalid procurement status provided'),
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureRequestedItemPoIssuanceColumn(client);
    await ensureRequestedItemFinancialsTable(client);

    const itemRes = await client.query(
      `SELECT ri.*, r.estimated_cost AS request_estimated_cost
         FROM public.requested_items ri
         JOIN requests r ON ri.request_id = r.id
        WHERE ri.id = $1`,
      [item_id]
    );

    if (itemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Requested item not found'));
    }

    const item = itemRes.rows[0];

    await client.query(
      `UPDATE public.requested_items
       SET procurement_status = $1,
           procurement_comment = $2,
           procurement_updated_by = $3,
           procurement_updated_at = CURRENT_TIMESTAMP,
           po_issuance_method = COALESCE($5, po_issuance_method)
       WHERE id = $4`,
      [
        procurement_status,
        procurement_comment || null,
        user_id,
        item_id,
        po_issuance_method || null,
      ]
    );

    const requestedQty = Number(item.purchased_quantity ?? item.quantity ?? 0);
    const computedCommitted =
      parsedCommittedCost !== null && parsedCommittedCost !== undefined
        ? parsedCommittedCost
        : Number.isFinite(requestedQty) && item.unit_cost !== null && item.unit_cost !== undefined
          ? Number((requestedQty * Number(item.unit_cost)).toFixed(2))
          : null;

    await upsertItemFinancials(
      client,
      item,
      {
        po_number: po_number || null,
        invoice_number: invoice_number || null,
        paid_cost: parsedPaidCost,
        committed_cost: computedCommitted,
        currency: currency || null,
        savings_driver: savings_driver || null,
        savings_notes: savings_notes || null,
        contract_id: parsedContractId,
        contract_value_snapshot: parsedContractSnapshot ?? undefined,
        savings_baseline:
          item.request_estimated_cost !== undefined
            ? Number(item.request_estimated_cost)
            : undefined,
      },
      user_id
    );

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Procurement Status Updated', $2, $3)`,
      [
        item.request_id,
        user_id,
        po_issuance_method
          ? `Updated status of item '${item.item_name}' to '${procurement_status}' (PO issuance: ${po_issuance_method})`
          : `Updated status of item '${item.item_name}' to '${procurement_status}'`,
      ]
    );

    await client.query('COMMIT');

    res.json({ message: '✅ Procurement status updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update procurement status:', err.message);
    next(createHttpError(500, 'Failed to update procurement status'));
  } finally {
    client.release();
  }
};

// 🆕 Update purchased quantity of an item
const updateItemPurchasedQuantity = async (req, res, next) => {
  const { item_id } = req.params;
  let { purchased_quantity } = req.body;
  const { id: user_id } = req.user;

  if (!req.user.hasPermission('procurement.update-status')) {
    return next(createHttpError(403, 'You do not have permission to update purchased quantity'));
  }

  purchased_quantity = Number(purchased_quantity);
  if (isNaN(purchased_quantity) || purchased_quantity < 0) {
    return next(createHttpError(400, 'Valid purchased_quantity is required'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureRequestedItemFinancialsTable(client);

    const itemRes = await client.query(
      `SELECT * FROM public.requested_items WHERE id = $1`,
      [item_id]
    );

    if (itemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Requested item not found'));
    }

    const item = itemRes.rows[0];

    await client.query(
      `UPDATE public.requested_items
       SET purchased_quantity = $1,
           procurement_updated_by = $2,
           procurement_updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [purchased_quantity, user_id, item_id]
    );

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Purchased Quantity Updated', $2, $3)`,
      [item.request_id, user_id, `Set purchased qty to ${purchased_quantity} for '${item.item_name}'`]
    );

    const committedCost =
      item.unit_cost !== null && item.unit_cost !== undefined
        ? Number((purchased_quantity * Number(item.unit_cost)).toFixed(2))
        : null;

    if (committedCost !== null) {
      await upsertItemFinancials(
        client,
        item,
        { committed_cost: committedCost },
        user_id
      );
    }

    await client.query('COMMIT');

    res.json({ message: '✅ Purchased quantity updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update purchased quantity:', err.message);
    next(createHttpError(500, 'Failed to update purchased quantity'));
  } finally {
    client.release();
  }
};

module.exports = {
  addRequestedItems,
  updateItemCost,
  updateItemProcurementStatus,
  updateItemPurchasedQuantity,
};