const pool = require('../../config/db');
const createHttpError = require('http-errors');

const getCompletedAssignedRequests = async (req, res, next) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT r.*, u.name AS requester_name, u.role AS requester_role
       FROM requests r
       JOIN users u ON r.requester_id = u.id
       WHERE r.assigned_to = $1 AND r.status = 'completed'
       ORDER BY r.completed_at DESC NULLS LAST`,
      [userId]
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('❌ Error in getCompletedAssignedRequests:', err);
    next(createHttpError(500, 'Failed to fetch completed requests'));
  }
};

module.exports = { getCompletedAssignedRequests };
