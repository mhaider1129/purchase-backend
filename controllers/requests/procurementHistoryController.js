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
            SELECT 1 FROM public.requested_items ri
            WHERE ri.request_id = r.id
              AND LOWER(ri.item_name) LIKE $${params.length}
          )
        )`;
    }


    const result = await pool.query(
      `SELECT r.*, p.name AS project_name,
              COALESCE(NULLIF(TRIM(r.temporary_requester_name), ''), u.name) AS requester_name,
              CASE
                WHEN NULLIF(TRIM(r.temporary_requester_name), '') IS NOT NULL THEN 'Temporary Requester'
                ELSE u.role
              END AS requester_role,
              assigned_scope.completed_item_count,
              assigned_scope.latest_completed_at,
              assigned_scope.is_split_assignment
       FROM requests r
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN users u ON r.requester_id = u.id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (
             WHERE LOWER(TRIM(COALESCE(ri.procurement_status, ''))) IN ('purchased', 'completed')
           )::int AS completed_item_count,
           MAX(COALESCE(ri.procurement_updated_at, ri.marked_at, ri.assigned_at, r.completed_at, r.updated_at)) FILTER (
             WHERE LOWER(TRIM(COALESCE(ri.procurement_status, ''))) IN ('purchased', 'completed')
           ) AS latest_completed_at,
           BOOL_OR(ri.assigned_to = $1) AND COALESCE(r.assigned_to, 0) <> $1 AS is_split_assignment
         FROM public.requested_items ri
         WHERE ri.request_id = r.id
           AND ri.assigned_to = $1
       ) assigned_scope ON TRUE
       WHERE (
           (r.assigned_to = $1 AND LOWER(TRIM(r.status)) IN ('completed', 'received'))
           OR COALESCE(assigned_scope.completed_item_count, 0) > 0
         )${searchClause}
       ORDER BY COALESCE(r.completed_at, assigned_scope.latest_completed_at, r.updated_at) DESC NULLS LAST`,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('❌ Error in getCompletedAssignedRequests:', err);
    next(createHttpError(500, 'Failed to fetch completed requests'));
  }
};

module.exports = { getCompletedAssignedRequests };