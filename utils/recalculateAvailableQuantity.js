const pool = require('../config/db');

/**
 * Recalculate and persist the available quantity for a stock item based on
 * the sum of all warehouse stock levels. This keeps the denormalized
 * stock_items.available_quantity column in sync with the authoritative
 * warehouse_stock_levels table.
 *
 * @param {object} client - pg client or pool with a .query method
 * @param {number} stockItemId - ID of the stock item to recalculate
 * @returns {Promise<number>} The recalculated available quantity
 */
const recalculateAvailableQuantity = async (client, stockItemId) => {
  const runner = client && client.query ? client : pool;

  const totalRes = await runner.query(
    `SELECT COALESCE(SUM(quantity), 0) AS total_quantity
       FROM warehouse_stock_levels
      WHERE stock_item_id = $1`,
    [stockItemId],
  );

  const totalQuantity = Number(totalRes.rows[0]?.total_quantity) || 0;

  await runner.query(
    `UPDATE stock_items
        SET available_quantity = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [stockItemId, totalQuantity],
  );

  return totalQuantity;
};

module.exports = recalculateAvailableQuantity;