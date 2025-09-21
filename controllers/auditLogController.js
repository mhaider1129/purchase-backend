//controllers/auditLogController.js
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const getAuditLog = async (req, res, next) => {
  let {
    request_id,
    approver_id,
    action,
    from_date,
    to_date,
    page = 1,
    limit = 10,
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
    filters.push(`log.request_id = $${values.length + 1}`);
    values.push(request_id);
  }

  if (approver_id) {
    filters.push(`log.actor_id = $${values.length + 1}`);
    values.push(approver_id);
  }

  if (action) {
    filters.push(`LOWER(log.action) LIKE LOWER($${values.length + 1})`);
    values.push(`%${action}%`);
  }

  if (from_date) {
    filters.push(`log.created_at >= $${values.length + 1}`);
    values.push(from_date);
  }

  if (to_date) {
    filters.push(`log.created_at <= $${values.length + 1}`);
    values.push(to_date);
  }

  let query = `
    SELECT
      log.id,
      log.request_id,
      log.approval_id,
      log.actor_id,
      log.actor_name,
      log.action,
      log.comments,
      log.created_at,
      log.log_type,
      r.justification,
      COUNT(*) OVER() AS total_count
    FROM (
      SELECT
        l.id,
        l.request_id,
        l.approval_id,
        l.approver_id AS actor_id,
        u.name AS actor_name,
        l.action,
        l.comments,
        l.created_at,
        'approval' AS log_type
      FROM approval_logs l
      LEFT JOIN users u ON l.approver_id = u.id

      UNION ALL

      SELECT
        rl.id,
        rl.request_id,
        NULL AS approval_id,
        rl.actor_id,
        u2.name AS actor_name,
        rl.action,
        rl.comments,
        rl.timestamp AS created_at,
        'request' AS log_type
      FROM request_logs rl
      LEFT JOIN users u2 ON rl.actor_id = u2.id
    ) log
    JOIN requests r ON log.request_id = r.id
  `;

  if (filters.length > 0) {
    query += ' WHERE ' + filters.join(' AND ');
  }

  query += ` ORDER BY log.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
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
        created_at: new Date(log.created_at).toISOString(),
      })),
    });
  } catch (err) {
    console.error('❌ getAuditLog failed:', err);
    next(createHttpError(500, 'Failed to retrieve audit logs'));
  }
};

module.exports = { getAuditLog };