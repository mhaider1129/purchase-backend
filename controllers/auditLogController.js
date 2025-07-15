//controllers/auditLogController.js
const pool = require('../config/db');

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const getAuditLog = async (req, res, next) => {
  let {
    request_id,
    approver_id,
    action,
    from_date,
    to_date,
    page = 1,
    limit = 10
  } = req.query;

  // Sanitize and limit pagination
  page = Math.max(1, parseInt(page));
  limit = Math.min(Math.max(1, parseInt(limit)), 100);

  // Default date range: Last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  from_date = from_date || thirtyDaysAgo.toISOString().split('T')[0];
  to_date = to_date || today.toISOString().split('T')[0];

  const filters = [];
  const values = [];

  if (request_id) {
    filters.push(`l.request_id = $${values.length + 1}`);
    values.push(request_id);
  }

  if (approver_id) {
    filters.push(`l.approver_id = $${values.length + 1}`);
    values.push(approver_id);
  }

  if (action) {
    filters.push(`LOWER(l.action) LIKE LOWER($${values.length + 1})`);
    values.push(`%${action}%`);
  }

  if (from_date) {
    filters.push(`l.created_at >= $${values.length + 1}`);
    values.push(from_date);
  }

  if (to_date) {
    filters.push(`l.created_at <= $${values.length + 1}`);
    values.push(to_date);
  }

  let query = `
    SELECT 
      l.id,
      l.request_id,
      l.approval_id,
      l.approver_id,
      u.name AS approver_name,
      u.role AS approver_role,
      l.action,
      l.comments,
      l.created_at,
      r.justification,
      COUNT(*) OVER() AS total_count
    FROM approval_logs l
    LEFT JOIN users u ON l.approver_id = u.id
    JOIN requests r ON l.request_id = r.id
  `;

  if (filters.length > 0) {
    query += ' WHERE ' + filters.join(' AND ');
  }

  query += ` ORDER BY l.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(limit, (page - 1) * limit);

  try {
    const result = await pool.query(query, values);
    const totalCount = result.rows[0]?.total_count || 0;

    res.json({
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      count: totalCount,
      logs: result.rows.map(({ total_count, ...log }) => ({
        ...log,
        created_at: new Date(log.created_at).toISOString()
      }))
    });
  } catch (err) {
    console.error('❌ getAuditLog failed:', err);
    next(createHttpError(500, 'Failed to retrieve audit logs'));
  }
};

module.exports = { getAuditLog };
