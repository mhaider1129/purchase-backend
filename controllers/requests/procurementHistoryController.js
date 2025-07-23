const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');

const getCompletedAssignedRequests = async (req, res, next) => {
  const userId = req.user.id;
  const { search } = req.query;

  try {
    const params = [userId];
    let searchClause = '';

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      searchClause = `
        AND (
          LOWER(r.justification) LIKE $${params.length}
          OR LOWER(r.request_type) LIKE $${params.length}
          OR CAST(r.id AS TEXT) LIKE $${params.length}
          OR EXISTS (
            SELECT 1 FROM requested_items ri
            WHERE ri.request_id = r.id
              AND LOWER(ri.item_name) LIKE $${params.length}
          )
        )`;
    }

    const result = await pool.query(
      `SELECT r.*, u.name AS requester_name, u.role AS requester_role
       FROM requests r
       JOIN users u ON r.requester_id = u.id
       WHERE r.assigned_to = $1 AND r.status = 'completed'${searchClause}
       ORDER BY r.completed_at DESC NULLS LAST`,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('❌ Error in getCompletedAssignedRequests:', err);
    next(createHttpError(500, 'Failed to fetch completed requests'));
  }
};

module.exports = { getCompletedAssignedRequests };