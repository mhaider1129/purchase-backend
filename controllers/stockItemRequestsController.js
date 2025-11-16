const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

// Create a new stock item request (Warehouse Manager)
const createStockItemRequest = async (req, res, next) => {
  const { name, description, unit } = req.body;
  const { id: rawUserId, user_id: fallbackUserId } = req.user || {};

  // Ensure the authenticated user id matches the UUID columns in the database
  const userIdCandidate = rawUserId ?? fallbackUserId;
  if (!userIdCandidate) {
    return next(createHttpError(401, 'Unauthorized: Missing user context'));
  }

  const userId = String(userIdCandidate).trim();
  const isValidUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);

  if (!isValidUUID) {
    return next(createHttpError(400, 'Invalid user ID format'));
  }
  if (!req.user.hasPermission('stock-requests.create')) {
    return next(createHttpError(403, 'You do not have permission to create stock item requests'));
  }

  if (!name) {
    return next(createHttpError(400, 'Item name is required'));
  }

  try {
    const result = await pool.query(
      `INSERT INTO stock_item_requests (name, description, unit, requested_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, description, unit, userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Failed to create stock item request:', err.message);
    next(createHttpError(500, 'Failed to create stock item request'));
  }
};

// Fetch stock item requests
const getStockItemRequests = async (req, res, next) => {
  const { id: userId } = req.user;
  try {
    let result;
    if (req.user.hasPermission('stock-requests.review')) {
      result = await pool.query(
        `SELECT * FROM stock_item_requests ORDER BY inserted_at DESC`
      );
    } else if (req.user.hasPermission('stock-requests.create')) {
      result = await pool.query(
        `SELECT * FROM stock_item_requests WHERE requested_by = $1 ORDER BY inserted_at DESC`,
        [userId]
      );
    } else {
      return next(createHttpError(403, 'You do not have permission to view stock item requests'));
    }
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch stock item requests:', err.message);
    next(createHttpError(500, 'Failed to fetch stock item requests'));
  }
};

// Update request status (SCM approval)
const updateStockItemRequestStatus = async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body; // expected 'approved' or 'rejected'
  const { id: userId } = req.user;

  if (!req.user.hasPermission('stock-requests.review')) {
    return next(createHttpError(403, 'You do not have permission to approve stock item requests'));
  }

  if (!['approved', 'rejected'].includes(status)) {
    return next(createHttpError(400, 'Invalid status'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRes = await client.query(
      `UPDATE stock_item_requests
         SET status = $1, approved_by = $2
       WHERE id = $3
       RETURNING *`,
      [status, userId, id]
    );

    if (reqRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Request not found'));
    }

    const request = reqRes.rows[0];

    if (status === 'approved') {
      await client.query(
        `INSERT INTO stock_items (name, description, unit, created_by)
         VALUES ($1, $2, $3, $4)`,
        [request.name, request.description, request.unit, request.requested_by]
      );
    }

    await client.query('COMMIT');
    res.json(request);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update stock item request status:', err.message);
    next(createHttpError(500, 'Failed to update stock item request status'));
  } finally {
    client.release();
  }
};

module.exports = {
  createStockItemRequest,
  getStockItemRequests,
  updateStockItemRequestStatus,
};