//controllers/requestedItemsController.js
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

// 📦 Add multiple items to a request
const addRequestedItems = async (req, res, next) => {
  const { request_id, items } = req.body;
  const { user_id } = req.user;

  if (!request_id || !Array.isArray(items) || items.length === 0) {
    return next(createHttpError(400, 'Invalid input: request_id and items are required'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertedItems = [];

    const typeRes = await client.query('SELECT request_type FROM requests WHERE id = $1', [request_id]);
    const reqType = typeRes.rows[0]?.request_type;
    if (!reqType) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Request not found'));
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
            `INSERT INTO requested_items
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
            `INSERT INTO requested_items
              (request_id, item_name, quantity, unit_cost, total_cost, available_quantity, intended_use, specs, device_info, purchase_type, item_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        `SELECT COALESCE(SUM(quantity * unit_cost), 0) AS total FROM requested_items WHERE request_id = $1`,
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
  const { user_id, role } = req.user;

  if (!unit_cost || isNaN(unit_cost) || unit_cost <= 0) {
    return next(createHttpError(400, 'Valid unit cost is required and must be > 0'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemRes = await client.query(
      `SELECT ri.*, r.assigned_to
       FROM requested_items ri
       JOIN requests r ON ri.request_id = r.id
       WHERE ri.id = $1`,
      [item_id]
    );

    if (itemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Requested item not found'));
    }

    const item = itemRes.rows[0];
    const isSCM = role === 'SCM';
    const isAssignedUser = item.assigned_to === user_id;

    if (!isSCM && !isAssignedUser) {
      await client.query('ROLLBACK');
      return next(createHttpError(403, 'You are not authorized to update this cost'));
    }

    await client.query(
      `UPDATE requested_items
       SET unit_cost = $1::numeric,
           total_cost = quantity * $1::numeric
       WHERE id = $2`,
      [unit_cost, item_id]
    );

    const totalRes = await client.query(
      `SELECT COALESCE(SUM(quantity * unit_cost), 0) AS total FROM requested_items WHERE request_id = $1`,
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
      [item.request_id, user_id, `Updated unit cost for '${item.item_name}' (ID: ${item_id}) to ${unit_cost}`]
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
  const { procurement_status, procurement_comment } = req.body;
  const { user_id, role } = req.user;

  const allowedRoles = ['SCM', 'ProcurementSupervisor', 'ProcurementSpecialist'];

  if (!allowedRoles.includes(role)) {
    return next(createHttpError(403, 'Unauthorized to update procurement status'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemRes = await client.query(
      `SELECT * FROM requested_items WHERE id = $1`,
      [item_id]
    );

    if (itemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Requested item not found'));
    }

    const item = itemRes.rows[0];

    await client.query(
      `UPDATE requested_items
       SET procurement_status = $1,
           procurement_comment = $2,
           procurement_updated_by = $3,
           procurement_updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [procurement_status, procurement_comment || null, user_id, item_id]
    );

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Procurement Status Updated', $2, $3)`,
      [item.request_id, user_id, `Updated status of item '${item.item_name}' to '${procurement_status}'`]
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
  const { user_id, role } = req.user;

  const allowedRoles = ['SCM', 'ProcurementSupervisor', 'ProcurementSpecialist'];

  if (!allowedRoles.includes(role)) {
    return next(createHttpError(403, 'Unauthorized to update purchased quantity'));
  }

  purchased_quantity = Number(purchased_quantity);
  if (isNaN(purchased_quantity) || purchased_quantity < 0) {
    return next(createHttpError(400, 'Valid purchased_quantity is required'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemRes = await client.query(
      `SELECT * FROM requested_items WHERE id = $1`,
      [item_id]
    );

    if (itemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Requested item not found'));
    }

    const item = itemRes.rows[0];

    await client.query(
      `UPDATE requested_items
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
