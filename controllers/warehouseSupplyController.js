const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

// Record supplied items for a request
const recordSuppliedItems = async (req, res, next) => {
  const { requestId } = req.params;
  const { items } = req.body;
  const { role, id: userId } = req.user;

  if (!['warehouse_keeper', 'WarehouseKeeper'].includes(role)) {
    return next(createHttpError(403, 'Only warehouse keepers can record supplied items'));
  }

  if (!Array.isArray(items) || items.length === 0) {
    return next(createHttpError(400, 'Items array is required'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const { item_id, supplied_quantity } = item;
      if (!item_id || supplied_quantity === undefined) continue;
      await client.query(
        `INSERT INTO warehouse_supplied_items (request_id, item_id, supplied_quantity, supplied_by)
         VALUES ($1,$2,$3,$4)`,
        [requestId, item_id, supplied_quantity, userId]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ message: 'Supplied items recorded' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to record supplied items:', err);
    next(createHttpError(500, 'Failed to record supplied items'));
  } finally {
    client.release();
  }
};

// Fetch approved warehouse supply requests
const getWarehouseSupplyRequests = async (req, res, next) => {
  const allowed = [
    'WarehouseManager',
    'warehouse_manager',
    'WarehouseKeeper',
    'warehouse_keeper',
  ];
  if (!allowed.includes(req.user.role)) {
    return next(createHttpError(403, 'Forbidden'));
  }

  try {
    const deptRes = await pool.query(
      'SELECT type FROM departments WHERE id = $1',
      [req.user.department_id],
    );
    const deptType = deptRes.rows[0]?.type?.toLowerCase();
    const domain = deptType === 'medical' ? 'medical' : 'operational';

    const result = await pool.query(
      `SELECT r.id, r.justification, r.status, r.created_at,
              d.name AS department_name,
              s.name AS section_name
       FROM requests r
       JOIN departments d ON r.department_id = d.id
       LEFT JOIN sections s ON r.section_id = s.id
       WHERE r.request_type = 'Warehouse Supply'
         AND r.status = 'Approved'
         AND r.request_domain = $1
       ORDER BY r.created_at DESC`,
      [domain]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch warehouse supply requests:', err);
    next(createHttpError(500, 'Failed to fetch warehouse supply requests'));
  }
};

module.exports = { recordSuppliedItems, getWarehouseSupplyRequests };