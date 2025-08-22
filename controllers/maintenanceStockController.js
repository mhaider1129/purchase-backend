const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

// Get all maintenance stock items
const getStockItems = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, item_name, quantity, updated_at FROM maintenance_stock ORDER BY item_name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch maintenance stock:', err.message);
    next(createHttpError(500, 'Failed to fetch maintenance stock'));
  }
};

// Add new item or update existing
const upsertStockItem = async (req, res, next) => {
  const { id } = req.params;
  const { item_name, quantity } = req.body;
  const userRole = req.user.role;
  
  const allowedRoles = ['WarehouseManager', 'warehouse_manager'];

  if (!allowedRoles.includes(userRole)) {
    return next(createHttpError(403, 'Only Warehouse Managers can update stock'));
  }

  if (!item_name || quantity === undefined || quantity < 0) {
    return next(createHttpError(400, 'Item name and valid quantity are required'));
  }

  try {
    let result;
    if (id) {
      result = await pool.query(
        `UPDATE maintenance_stock
         SET item_name = $1, quantity = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *`,
        [item_name, quantity, id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO maintenance_stock (item_name, quantity)
         VALUES ($1, $2)
         ON CONFLICT (item_name)
         DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [item_name, quantity]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Failed to upsert maintenance stock:', err.message);
    next(createHttpError(500, 'Failed to update maintenance stock'));
  }
};

module.exports = { getStockItems, upsertStockItem };