const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureWarehouseAssignments = require('../utils/ensureWarehouseAssignments');
const ensureWarehouseInventoryTables = require('../utils/ensureWarehouseInventoryTables');
const recalculateAvailableQuantity = require('../utils/recalculateAvailableQuantity');

const getStockItems = async (req, res, next) => {
  try {
    await ensureWarehouseInventoryTables();

    const result = await pool.query(
      `SELECT
         si.id,
         si.name,
         si.brand,
         COALESCE(SUM(wsl.quantity), si.available_quantity, 0) AS available_quantity,
         si.category,
         si.sub_category
       FROM stock_items si
       LEFT JOIN warehouse_stock_levels wsl ON wsl.stock_item_id = si.id
       GROUP BY si.id, si.name, si.brand, si.category, si.sub_category
       ORDER BY si.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch stock items:', err);
    next(err);
  }
};

const getUnassignedStockItems = async (req, res, next) => {
  if (!req.user?.hasPermission('warehouse.manage-supply')) {
    return next(createHttpError(403, 'You do not have permission to manage warehouse stock'));
  }

  try {
    await ensureWarehouseInventoryTables();

    const { rows } = await pool.query(
      `SELECT
         si.id,
         si.name,
         si.brand,
         COALESCE(si.available_quantity, 0) AS available_quantity,
         si.category,
         si.sub_category
       FROM stock_items si
       WHERE COALESCE(si.available_quantity, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM warehouse_stock_levels wsl WHERE wsl.stock_item_id = si.id
         )
       ORDER BY si.name`,
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch unassigned stock items:', err);
    next(err);
  }
};

const assignStockItemToWarehouses = async (req, res, next) => {
  if (!req.user?.hasPermission('warehouse.manage-supply')) {
    return next(createHttpError(403, 'You do not have permission to manage warehouse stock'));
  }

  const stockItemId = Number(req.body?.stock_item_id);
  const allocationsInput = Array.isArray(req.body?.allocations) ? req.body.allocations : [];

  if (!Number.isInteger(stockItemId)) {
    return next(createHttpError(400, 'A valid stock_item_id is required'));
  }

  if (allocationsInput.length === 0) {
    return next(createHttpError(400, 'At least one warehouse allocation is required'));
  }

  const allocationMap = new Map();
  for (let i = 0; i < allocationsInput.length; i += 1) {
    const entry = allocationsInput[i] || {};
    const warehouseId = Number(entry.warehouse_id ?? entry.warehouseId);
    const quantity = Number(entry.quantity);

    if (!Number.isInteger(warehouseId) || !Number.isFinite(quantity) || quantity <= 0) {
      return next(createHttpError(400, `A valid warehouse_id and positive quantity are required for allocation #${i + 1}`));
    }

    allocationMap.set(warehouseId, (allocationMap.get(warehouseId) || 0) + quantity);
  }

  await ensureWarehouseAssignments();
  await ensureWarehouseInventoryTables();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const stockRes = await client.query(
      `SELECT id, name, COALESCE(available_quantity, 0) AS available_quantity
         FROM stock_items
        WHERE id = $1
        FOR UPDATE`,
      [stockItemId],
    );

    if (stockRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Stock item not found'));
    }

    const stockItem = stockRes.rows[0];
    const availableQuantity = Number(stockItem.available_quantity) || 0;

    const existingLevelsRes = await client.query(
      'SELECT COUNT(*) AS count FROM warehouse_stock_levels WHERE stock_item_id = $1',
      [stockItemId],
    );
    const existingLevelCount = Number(existingLevelsRes.rows[0]?.count) || 0;

    if (existingLevelCount > 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'This stock item already has warehouse stock levels. Please adjust those balances instead.'));
    }

    if (availableQuantity <= 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'The stock item does not have any available quantity to allocate'));
    }

    const totalAllocated = Array.from(allocationMap.values()).reduce((sum, value) => sum + value, 0);

    if (totalAllocated !== availableQuantity) {
      await client.query('ROLLBACK');
      return next(
        createHttpError(
          400,
          `Total allocated quantity (${totalAllocated}) must match the current available quantity (${availableQuantity}).`,
        ),
      );
    }

    const warehouseIds = Array.from(allocationMap.keys());
    const warehouseRes = await client.query('SELECT id, name FROM warehouses WHERE id = ANY($1)', [warehouseIds]);
    const warehouseNames = new Map(warehouseRes.rows.map((row) => [row.id, row.name]));

    if (warehouseRes.rowCount !== warehouseIds.length) {
      const missingIds = warehouseIds.filter((id) => !warehouseNames.has(id));
      await client.query('ROLLBACK');
      return next(createHttpError(400, `One or more warehouses do not exist: ${missingIds.join(', ')}`));
    }

    const allocations = [];

    for (const [warehouseId, quantity] of allocationMap.entries()) {
      await client.query(
        `INSERT INTO warehouse_stock_levels (warehouse_id, stock_item_id, item_name, quantity, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (warehouse_id, stock_item_id)
         DO UPDATE SET
           quantity = warehouse_stock_levels.quantity + EXCLUDED.quantity,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP,
           item_name = EXCLUDED.item_name`,
        [warehouseId, stockItemId, stockItem.name, quantity, req.user.id],
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
            notes,
            created_by
          ) VALUES ($1, $2, $3, 'in', $4, NULL, NULL, $5, $6)`,
        [warehouseId, stockItemId, stockItem.name, quantity, 'Initial warehouse allocation from stock_items.available_quantity', req.user.id],
      );

      allocations.push({ warehouse_id: warehouseId, warehouse_name: warehouseNames.get(warehouseId), quantity });
    }

    await recalculateAvailableQuantity(client, stockItemId);

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Stock item availability assigned to warehouses',
      stock_item_id: stockItemId,
      total_allocated: totalAllocated,
      allocations,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to assign stock item to warehouses:', err);
    next(createHttpError(500, 'Failed to assign stock item to warehouses'));
  } finally {
    client.release();
  }
};

module.exports = { getStockItems, getUnassignedStockItems, assignStockItemToWarehouses };