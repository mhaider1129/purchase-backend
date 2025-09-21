const pool = require('../config/db');

const getStockItems = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, category FROM stock_items ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch stock items:', err);
    next(err);
  }
};

module.exports = { getStockItems };