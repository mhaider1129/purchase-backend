const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureWarehouseInventoryTables = require('../utils/ensureWarehouseInventoryTables');

const parseQuantity = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  return parsed;
};

const addWarehouseStock = async (req, res, next) => {
  const { stock_item_id: rawStockItemId, quantity: rawQuantity, notes, warehouse_id } = req.body || {};

  if (!req.user?.hasPermission('warehouse.manage-supply')) {
    return next(createHttpError(403, 'You do not have permission to manage warehouse stock'));
  }

  const stockItemId = Number(rawStockItemId);
  if (!Number.isInteger(stockItemId)) {
    return next(createHttpError(400, 'A valid stock_item_id is required'));
  }

  const quantity = parseQuantity(rawQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return next(createHttpError(400, 'Quantity must be a positive number'));
  }

  await ensureWarehouseAssignments();

  const fallbackWarehouseId = req.user?.warehouse_id;
  const providedWarehouseId =
    warehouse_id === undefined || warehouse_id === null || warehouse_id === ''
      ? null
      : Number(warehouse_id);
  const warehouseId = providedWarehouseId ?? fallbackWarehouseId;

  if (!Number.isInteger(warehouseId)) {
    return next(createHttpError(400, 'A valid warehouse must be specified'));
  }

  await ensureWarehouseInventoryTables();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const stockItemRes = await client.query(
      'SELECT id, name FROM stock_items WHERE id = $1',
      [stockItemId],
    );

    if (stockItemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Stock item not found'));
    }

    const itemName = stockItemRes.rows[0].name;

    const balanceRes = await client.query(
      `INSERT INTO warehouse_stock_levels (warehouse_id, stock_item_id, item_name, quantity, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (warehouse_id, stock_item_id)
       DO UPDATE SET
         quantity = warehouse_stock_levels.quantity + EXCLUDED.quantity,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP,
         item_name = EXCLUDED.item_name
       RETURNING id, warehouse_id, stock_item_id, item_name, quantity, updated_at`,
      [warehouseId, stockItemId, itemName, quantity, req.user.id],
    );

    await client.query(
      `INSERT INTO warehouse_stock_movements (
        warehouse_id, stock_item_id, item_name, direction, quantity, notes, created_by
      ) VALUES ($1, $2, $3, 'in', $4, $5, $6)`,
      [warehouseId, stockItemId, itemName, quantity, notes || null, req.user.id],
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Stock quantity added to warehouse',
      balance: balanceRes.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add warehouse stock:', err.message);
    next(createHttpError(500, 'Failed to add warehouse stock'));
  } finally {
    client.release();
  }
};

const getWeeklyDepartmentStockingReport = async (req, res, next) => {
  if (!req.user?.hasPermission('warehouse.view-supply')) {
    return next(createHttpError(403, 'You do not have permission to view warehouse reports'));
  }

  await ensureWarehouseInventoryTables();

  const now = new Date();
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    const { rows } = await pool.query(
      `SELECT
        d.id AS department_id,
        d.name AS department_name,
        COALESCE(
          json_agg(
            json_build_object(
              'stock_item_id', m.stock_item_id,
              'item_name', m.item_name,
              'total_quantity', m.total_quantity
            ) ORDER BY m.item_name
          ) FILTER (WHERE m.stock_item_id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM (
        SELECT
          to_department_id,
          stock_item_id,
          item_name,
          SUM(quantity) AS total_quantity
        FROM warehouse_stock_movements
        WHERE direction = 'out'
          AND to_department_id IS NOT NULL
          AND created_at >= $1
        GROUP BY to_department_id, stock_item_id, item_name
      ) m
      JOIN departments d ON d.id = m.to_department_id
      GROUP BY d.id, d.name
      ORDER BY d.name`,
      [windowStart],
    );

    res.json({
      generated_at: now.toISOString(),
      window_start: windowStart.toISOString(),
      window_end: now.toISOString(),
      departments: rows,
    });
  } catch (err) {
    console.error('❌ Failed to generate weekly stocking report:', err.message);
    next(createHttpError(500, 'Failed to generate weekly stocking report'));
  }
};

module.exports = {
  addWarehouseStock,
  getWeeklyDepartmentStockingReport,
};