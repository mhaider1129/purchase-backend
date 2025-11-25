const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureRequestedItemApprovalColumns = require('../utils/ensureRequestedItemApprovalColumns');
const ensureWarehouseSupplyTables = require('../utils/ensureWarehouseSupplyTables');
const ensureWarehouseInventoryTables = require('../utils/ensureWarehouseInventoryTables');
const ensureWarehouseAssignments = require('../utils/ensureWarehouseAssignments');

const findStockItemForSupply = async (client, { stockItemId, itemName }) => {
  if (Number.isInteger(stockItemId)) {
    const { rows } = await client.query(
      `SELECT id, name FROM stock_items WHERE id = $1`,
      [stockItemId],
    );
    if (rows[0]) return rows[0];
  }

  if (!itemName) return null;

  const { rows } = await client.query(
    `SELECT id, name FROM stock_items WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [itemName],
  );

  return rows[0] || null;
};

const decrementWarehouseStock = async (
  client,
  {
    warehouseId,
    stockItem,
    quantity,
    requestId,
    departmentId,
    userId,
    skipIfMissingStockLevel = false,
  },
) => {
  const { id: stockItemId, name: itemName } = stockItem;
  const balanceRes = await client.query(
    `SELECT quantity
       FROM warehouse_stock_levels
      WHERE warehouse_id = $1 AND stock_item_id = $2
      FOR UPDATE`,
    [warehouseId, stockItemId],
  );

  if (balanceRes.rowCount === 0) {
    if (skipIfMissingStockLevel) {
      return {
        stock_item_id: stockItemId,
        item_name: itemName,
        warning:
          'Warehouse inventory is not initialized for this stock item; stock was not decremented.',
      };
    }

    throw createHttpError(
      400,
      `Warehouse inventory for ${itemName} is not initialized. Please add stock before supplying items.`,
    );
  }

  const currentQty = Number(balanceRes.rows[0].quantity) || 0;
  if (currentQty < quantity) {
    throw createHttpError(
      400,
      `Insufficient stock for ${itemName}. Available: ${currentQty}, requested: ${quantity}`,
    );
  }

  await client.query(
    `UPDATE warehouse_stock_levels
        SET quantity = quantity - $3,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = $4
      WHERE warehouse_id = $1 AND stock_item_id = $2`,
    [warehouseId, stockItemId, quantity, userId],
  );

  await client.query(
    `UPDATE stock_items
        SET available_quantity = GREATEST(0, COALESCE(available_quantity, 0) - $2),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [stockItemId, quantity],
  );

  await client.query(
    `INSERT INTO warehouse_stock_movements (
        warehouse_id,
        stock_item_id,
        item_name,
        direction,
        quantity,
        reference_request_id,
        to_department_id,
        created_by,
        notes
      ) VALUES ($1, $2, $3, 'out', $4, $5, $6, $7, $8)`,
    [
      warehouseId,
      stockItemId,
      itemName,
      quantity,
      requestId,
      departmentId,
      userId,
      'Warehouse supply request fulfillment',
    ],
  );

  return { stock_item_id: stockItemId, item_name: itemName };
};

// Record supplied items for a request
const recordSuppliedItems = async (req, res, next) => {
  const { requestId } = req.params;
  const { items } = req.body;
  const { id: userId } = req.user;

  await ensureWarehouseAssignments();

  const warehouseId = req.user?.warehouse_id;

  if (!req.user.hasPermission('warehouse.manage-supply')) {
    return next(createHttpError(403, 'You do not have permission to record supplied items'));
  }

  if (!Array.isArray(items) || items.length === 0) {
    return next(createHttpError(400, 'Items array is required'));
  }

  if (!Number.isInteger(warehouseId)) {
    return next(createHttpError(400, 'You must belong to a warehouse to supply items'));
  }

  await ensureWarehouseSupplyTables();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureWarehouseInventoryTables(client);

    const requestRes = await client.query(
      `SELECT id, request_type, status, department_id, supply_warehouse_id
         FROM requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );

    if (requestRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Request not found'));
    }

    const request = requestRes.rows[0];
    if (request.request_type !== 'Warehouse Supply') {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Supplies can only be recorded for warehouse supply requests'));
    }

    if (request.status !== 'Approved' && request.status !== 'Completed') {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Request must be approved before supplying items'));
    }

    if (!request.supply_warehouse_id) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Warehouse supply requests must specify a warehouse'));
    }

    if (warehouseId !== request.supply_warehouse_id) {
      await client.query('ROLLBACK');
      return next(createHttpError(403, 'You cannot supply items for a different warehouse'));
    }

    const itemsRes = await client.query(
      `SELECT id, item_name, quantity
       FROM warehouse_supply_items
       WHERE request_id = $1`,
      [requestId],
    );

    if (itemsRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'No warehouse supply items found for this request'));
    }

    const supplyItemsById = itemsRes.rows.reduce((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});

    const existingSupply = await client.query(
      `SELECT item_id, COALESCE(SUM(supplied_quantity), 0) AS total_supplied
       FROM warehouse_supplied_items
       WHERE request_id = $1
       GROUP BY item_id`,
      [requestId],
    );

    const suppliedMap = existingSupply.rows.reduce((acc, row) => {
      acc[row.item_id] = Number(row.total_supplied) || 0;
      return acc;
    }, {});

    const inventoryMovements = [];

    for (const item of items) {
      const { item_id: itemId, supplied_quantity: suppliedQuantity } = item;

      if (!itemId || suppliedQuantity === undefined) {
        await client.query('ROLLBACK');
        return next(createHttpError(400, 'Each item must include item_id and supplied_quantity'));
      }

      const requestedItem = supplyItemsById[itemId];
      if (!requestedItem) {
        await client.query('ROLLBACK');
        return next(createHttpError(404, `Item with id ${itemId} is not part of this request`));
      }

      const parsedQuantity = Number(suppliedQuantity);
      if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(400, 'Supplied quantity must be a positive number'));
      }

      const alreadySupplied = suppliedMap[itemId] || 0;
      const newTotal = alreadySupplied + parsedQuantity;
      if (newTotal > Number(requestedItem.quantity)) {
        await client.query('ROLLBACK');
        return next(
          createHttpError(
            400,
            `Cannot supply more than requested for ${requestedItem.item_name}. Requested: ${requestedItem.quantity}, already supplied: ${alreadySupplied}`,
          ),
        );
      }

      await client.query(
        `INSERT INTO warehouse_supplied_items (request_id, item_id, supplied_quantity, supplied_by)
         VALUES ($1,$2,$3,$4)`,
        [requestId, itemId, parsedQuantity, userId]
      );

      suppliedMap[itemId] = newTotal;

      const stockItemId = Number.isInteger(item.stock_item_id)
        ? Number(item.stock_item_id)
        : null;
      const stockItem = await findStockItemForSupply(client, {
        stockItemId,
        itemName: requestedItem.item_name,
      });

      if (stockItem) {
        const movement = await decrementWarehouseStock(client, {
          warehouseId: request.supply_warehouse_id,
          stockItem,
          quantity: parsedQuantity,
          requestId: request.id,
          departmentId: request.department_id,
          userId,
          skipIfMissingStockLevel: true,
        });
        inventoryMovements.push({ ...movement, quantity: parsedQuantity, item_id: itemId });
      } else {
        inventoryMovements.push({
          item_id: itemId,
          item_name: requestedItem.item_name,
          warning: 'No matching stock item found for warehouse inventory; stock was not decremented.',
        });
      }
    }

    const fulfillmentRes = await client.query(
      `SELECT wsi.id, wsi.quantity, COALESCE(SUM(wsup.supplied_quantity), 0) AS supplied
       FROM warehouse_supply_items wsi
       LEFT JOIN warehouse_supplied_items wsup
         ON wsup.item_id = wsi.id AND wsup.request_id = wsi.request_id
       WHERE wsi.request_id = $1
       GROUP BY wsi.id, wsi.quantity`,
      [requestId],
    );

    const allFulfilled = fulfillmentRes.rows.every(
      (row) => Number(row.supplied) >= Number(row.quantity),
    );

    let newStatus = request.status;
    if (allFulfilled && request.status !== 'Completed') {
      await client.query(
        `UPDATE requests SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requestId],
      );
      newStatus = 'Completed';
    }

    const suppliedSummary = items
      .map(({ item_id: itemId, supplied_quantity: qty }) => {
        const itemName = supplyItemsById[itemId]?.item_name || 'Unknown item';
        return `${itemName}: ${qty}`;
      })
      .join('; ');

    const supplyTimestamp = new Date().toISOString();
    const [departmentInfo, warehouseInfo] = await Promise.all([
      client.query('SELECT name FROM departments WHERE id = $1', [
        request.department_id,
      ]),
      client.query('SELECT name FROM warehouses WHERE id = $1', [
        request.supply_warehouse_id,
      ]),
    ]);

    const departmentName =
      departmentInfo.rows[0]?.name || `Department ID ${request.department_id}`;
    const warehouseName =
      warehouseInfo.rows[0]?.name || `Warehouse ID ${request.supply_warehouse_id}`;

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Warehouse items supplied', $2, $3)`,
      [
        requestId,
        userId,
        `Supplied on ${supplyTimestamp} from ${warehouseName} to ${departmentName} -> ${suppliedSummary}`,
      ],
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Supplied items recorded',
      status: newStatus,
      inventory_movements: inventoryMovements,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to record supplied items:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to record supplied items'));
  } finally {
    client.release();
  }
};

// Fetch approved warehouse supply requests
const getWarehouseSupplyRequests = async (req, res, next) => {
  if (!req.user.hasPermission('warehouse.view-supply')) {
    return next(createHttpError(403, 'You do not have permission to view warehouse supply requests'));
  }

  try {
    await ensureWarehouseAssignments();
    await ensureWarehouseSupplyTables();

    const warehouseId = req.user?.warehouse_id;
    if (!Number.isInteger(warehouseId)) {
      return next(createHttpError(400, 'You must be associated with a warehouse to view supply requests'));
    }

    const result = await pool.query(
      `SELECT r.id, r.justification, r.status, r.created_at,
              d.name AS department_name,
              s.name AS section_name,
              w.name AS warehouse_name,
              r.supply_warehouse_id
       FROM requests r
       JOIN departments d ON r.department_id = d.id
       LEFT JOIN sections s ON r.section_id = s.id
       LEFT JOIN warehouses w ON r.supply_warehouse_id = w.id
       WHERE r.request_type = 'Warehouse Supply'
         AND r.status = 'Approved'
         AND r.supply_warehouse_id = $1
       ORDER BY r.created_at DESC`,
      [warehouseId]
    );
    const requests = result.rows;

    if (requests.length === 0) {
      return res.json(requests);
    }

    await ensureRequestedItemApprovalColumns();

    const requestIds = requests.map((request) => request.id);
    const itemsResult = await pool.query(
      `SELECT
         wsi.request_id,
         wsi.id,
         wsi.item_name,
         wsi.quantity,
         COALESCE(SUM(wsup.supplied_quantity), 0) AS supplied_quantity
       FROM warehouse_supply_items wsi
       LEFT JOIN warehouse_supplied_items wsup
         ON wsup.item_id = wsi.id AND wsup.request_id = wsi.request_id
       WHERE wsi.request_id = ANY($1::int[])
       GROUP BY wsi.request_id, wsi.id, wsi.item_name, wsi.quantity
       ORDER BY wsi.request_id, wsi.id`,
      [requestIds],
    );

    const itemsByRequest = itemsResult.rows.reduce((acc, item) => {
      if (!acc[item.request_id]) {
        acc[item.request_id] = [];
      }
      acc[item.request_id].push(item);
      return acc;
    }, {});

    const enrichedRequests = requests.map((request) => ({
      ...request,
      items: itemsByRequest[request.id] || [],
    }));

    res.json(enrichedRequests);
  } catch (err) {
    console.error('❌ Failed to fetch warehouse supply requests:', err);
    next(createHttpError(500, 'Failed to fetch warehouse supply requests'));
  }
};

module.exports = { recordSuppliedItems, getWarehouseSupplyRequests };