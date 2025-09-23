const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');

const getRequestDetails = async (req, res, next) => {
  const { id } = req.params;
  const { id: userId, role } = req.user;
  const isPrivilegedViewer = ['admin', 'SCM'].includes(role);

  try {
    let accessCheck;

    if (isPrivilegedViewer) {
      accessCheck = await pool.query(
        `SELECT r.*
         FROM requests r
         WHERE r.id = $1
         LIMIT 1`,
        [id],
      );
    } else {
      accessCheck = await pool.query(
        `SELECT r.*
         FROM requests r
         LEFT JOIN approvals a ON r.id = a.request_id
         WHERE r.id = $1 AND (r.requester_id = $2 OR a.approver_id = $2 OR r.assigned_to = $2)
         LIMIT 1`,
        [id, userId],
      );
    }

    if (accessCheck.rowCount === 0)
      return next(createHttpError(404, 'Request not found or access denied'));

    const request = accessCheck.rows[0];

    let itemsRes;
    if (request.request_type === 'Warehouse Supply') {
      itemsRes = await pool.query(
        `SELECT id, item_name, quantity FROM warehouse_supply_items WHERE request_id = $1`,
        [id]
      );
    } else {
      itemsRes = await pool.query(
        `SELECT item_name, brand, quantity, purchased_quantity, unit_cost, total_cost, specs FROM requested_items WHERE request_id = $1`,
        [id]
      );
    }

    let assignedUser = null;
    if (request.assigned_to) {
      const assignedRes = await pool.query(
        `SELECT id, name, role FROM users WHERE id = $1`,
        [request.assigned_to],
      );
      assignedUser = assignedRes.rows[0] || null;
    }

    res.json({
      request,
      items: itemsRes.rows,
      assigned_user: assignedUser,
    });
  } catch (err) {
    console.error('❌ Failed to fetch request details:', err);
    next(createHttpError(500, 'Failed to fetch request details'));
  }
};

const getRequestItemsOnly = async (req, res, next) => {
  const { id } = req.params;
  const { id: userId, role } = req.user;
  const isPrivilegedViewer = ['admin', 'SCM'].includes(role);
  
  try {
    let accessCheck;

    if (isPrivilegedViewer) {
      accessCheck = await pool.query(
        `SELECT r.id, r.request_type
         FROM requests r
         WHERE r.id = $1
         LIMIT 1`,
        [id],
      );
    } else {
      accessCheck = await pool.query(
        `
        SELECT r.id, r.request_type
        FROM requests r
        LEFT JOIN approvals a ON r.id = a.request_id
        WHERE r.id = $1
          AND (
            r.requester_id = $2
            OR a.approver_id = $2
            OR r.assigned_to = $2
          )
        LIMIT 1
        `,
        [id, userId],
      );
    }

    if (accessCheck.rowCount === 0) {
      return next(createHttpError(404, 'Request not found or access denied'));
    }

    let itemsRes;
    const reqType = accessCheck.rows[0]?.request_type;
    if (reqType === 'Warehouse Supply') {
      itemsRes = await pool.query(
        `SELECT id, item_name, quantity FROM warehouse_supply_items WHERE request_id = $1`,
        [id]
      );
    } else {
      itemsRes = await pool.query(
        `
      SELECT id, item_name, brand, quantity, purchased_quantity, unit_cost, total_cost, procurement_status, procurement_comment, specs
      FROM requested_items
      WHERE request_id = $1
      `,
        [id]
      );
    }

    res.json({ items: itemsRes.rows });
  } catch (err) {
    console.error('❌ Error in getRequestItemsOnly:', err);
    next(createHttpError(500, 'Failed to fetch request items'));
  }
};

const getMyRequests = async (req, res, next) => {
  const { search } = req.query;

  try {
    const params = [req.user.id];
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
      `SELECT
        r.id,
        r.request_type,
        r.justification,
        r.estimated_cost,
        r.status,
        r.created_at,
        EXISTS (
          SELECT 1 FROM approvals a
          WHERE a.request_id = r.id AND a.is_urgent = true
        ) AS is_urgent
       FROM requests r
       WHERE r.requester_id = $1${searchClause}
       ORDER BY r.created_at DESC`,
      params,
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching my requests:', err);
    next(createHttpError(500, 'Failed to fetch your requests'));
  }
};

const getApprovalHistory = async (req, res, next) => {
  const { status, from_date, to_date, department_id } = req.query;

  const params = [req.user.id];
  const conditions = [
    `a.approver_id = $1`,
    `a.status IN ('Approved', 'Rejected')`,
  ];

  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }

  if (department_id) {
    params.push(department_id);
    conditions.push(`r.department_id = $${params.length}`);
  }

  if (from_date) {
    params.push(from_date);
    conditions.push(`a.approved_at >= $${params.length}`);
  }

  if (to_date) {
    params.push(to_date);
    conditions.push(`a.approved_at <= $${params.length}`);
  }

  const whereSQL = conditions.join(' AND ');

  try {
    const result = await pool.query(
      `SELECT
         r.id AS request_id,
         r.request_type,
         r.justification,
         r.estimated_cost,
         r.status,
         a.status AS decision,
         a.comments,
         a.approval_level,
         a.approved_at AS approved_at,
         d.name AS department_name       FROM approvals a
       JOIN requests r ON a.request_id = r.id
       JOIN departments d ON r.department_id = d.id
       WHERE ${whereSQL}
       ORDER BY a.approved_at DESC`,
      params,
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching approval history:', err);
    next(createHttpError(500, 'Failed to fetch approval history'));
  }
};

const getProcurementUsers = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, name FROM users
      WHERE role IN ('ProcurementSupervisor', 'ProcurementSpecialist', 'SCM')
      AND is_active = true
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch procurement users:', err);
    next(createHttpError(500, 'Failed to fetch procurement users'));
  }
};

const { successResponse, errorResponse } = require('../../utils/responseFormatter');

const getAllRequests = async (req, res, next) => {
  const {
    filter,
    sort,
    request_type,
    search,
    from_date,
    to_date,
    status,
    department_id,
    page = 1,
    limit = 10,
  } = req.query;

  const offset = (page - 1) * limit;
  const params = [];
  let whereClauses = [];
  let orderBy = 'r.created_at DESC';

  if (filter === 'unassigned') {
    whereClauses.push('r.assigned_to IS NULL');
  }

  if (request_type) {
    params.push(request_type);
    whereClauses.push(`r.request_type = $${params.length}`);
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    whereClauses.push(`(
      LOWER(r.justification) LIKE $${params.length}
      OR LOWER(r.request_type) LIKE $${params.length}
      OR CAST(r.id AS TEXT) LIKE $${params.length}
      OR EXISTS (
        SELECT 1 FROM requested_items ri
        WHERE ri.request_id = r.id
          AND LOWER(ri.item_name) LIKE $${params.length}
      )
    )`);
  }

  if (from_date) {
    params.push(from_date);
    whereClauses.push(`r.created_at >= $${params.length}`);
  }

  if (to_date) {
    params.push(to_date);
    whereClauses.push(`r.created_at <= $${params.length}`);
  }

    if (status) {
    params.push(status);
    whereClauses.push(`r.status = $${params.length}`);
  }

  if (department_id) {
    params.push(department_id);
    whereClauses.push(`r.department_id = $${params.length}`);
  }

  if (sort === 'assigned') {
    orderBy = 'r.assigned_to NULLS LAST, r.created_at DESC';
  }

  const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `
      SELECT
        r.*, 
        d.name AS department_name,
        u.name AS assigned_user_name,
        u.role AS assigned_user_role,
        ap.approval_level AS current_approval_level,
        au.role AS current_approver_role
      FROM requests r
      JOIN departments d ON r.department_id = d.id
      LEFT JOIN users u ON r.assigned_to = u.id
      LEFT JOIN approvals ap ON r.id = ap.request_id AND ap.is_active = true
      LEFT JOIN users au ON ap.approver_id = au.id
      ${whereSQL}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limit, offset],
    );

    const totalCountRes = await pool.query(
      `SELECT COUNT(*) FROM requests r ${whereSQL}`,
      params,
    );

    return res.json({
      data: result.rows,
      total: parseInt(totalCountRes.rows[0].count, 10),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('❌ Error in getAllRequests:', err);
    return res.status(500).json({ error: 'Failed to fetch requests' });
  }
};

const getAssignedRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT r.*, u.name AS requester_name, u.role AS requester_role
       FROM requests r
       JOIN users u ON r.requester_id = u.id
       WHERE r.assigned_to = $1 AND r.status != 'completed'
       ORDER BY r.created_at DESC`,
      [userId],
    );

    return successResponse(res, 'Assigned requests fetched', result.rows);
  } catch (err) {
    console.error('❌ Error in getAssignedRequests:', err);
    return errorResponse(res, 500, 'Internal server error');
  }
};

const getPendingApprovals = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         a.id AS approval_id,
         r.id AS request_id,
         r.request_type,
         r.justification,
         r.estimated_cost,
         r.status
       FROM requests r
       JOIN approvals a ON r.id = a.request_id
       WHERE a.approver_id = $1
         AND a.is_active = true
         AND a.status = 'Pending'
         AND r.request_type != 'Maintenance'
         ORDER BY r.created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch pending approvals:', err);
    next(createHttpError(500, 'Server error while fetching pending approvals'));
  }
};

const getMyMaintenanceRequests = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, justification, maintenance_ref_number, status, created_at
       FROM requests
       WHERE request_type = 'Maintenance' AND initiated_by_technician_id = $1
       ORDER BY created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching maintenance requests:', err);
    next(createHttpError(500, 'Failed to fetch maintenance requests'));
  }
};

const getPendingMaintenanceApprovals = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         a.id AS approval_id,
         r.id AS request_id,
         r.justification,
         r.maintenance_ref_number,
         u.name AS requester_name,
         d.name AS department_name,
         s.name AS section_name,
         r.created_at,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT('item_name', ri.item_name, 'quantity', ri.quantity)
           ) FILTER (WHERE ri.id IS NOT NULL),
           '[]'
         ) AS items
       FROM requests r
       JOIN users u ON r.requester_id = u.id
       JOIN departments d ON r.department_id = d.id
       LEFT JOIN sections s ON r.section_id = s.id
       JOIN approvals a ON a.request_id = r.id
       LEFT JOIN requested_items ri ON ri.request_id = r.id
       WHERE r.request_type = 'Maintenance'
         AND a.approver_id = $1
         AND a.status = 'Pending'
         AND a.is_active = true
       GROUP BY a.id, r.id, u.name, d.name, s.name
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching maintenance approvals:', err);
    next(createHttpError(500, 'Failed to fetch maintenance requests'));
  }
};

const getAuditApprovedRejectedRequests = async (req, res, next) => {
  const { role } = req.user;
  if (role !== 'audit') {
    return next(createHttpError(403, 'Access denied'));
  }

  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.request_type, r.justification, r.status,
              MAX(a.approved_at) AS approval_timestamp
         FROM requests r
         JOIN approvals a ON r.id = a.request_id
        WHERE r.request_type IN ('IT Item', 'Stock', 'Non-Stock')
          AND r.status IN ('Approved', 'Rejected')
        GROUP BY r.id, r.request_type, r.justification, r.status
        ORDER BY approval_timestamp DESC`
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch audit requests:', err);
    next(createHttpError(500, 'Failed to fetch audit requests'));
  }
};

const getClosedRequests = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name AS assigned_user_name
       FROM requests r
       LEFT JOIN users u ON r.assigned_to = u.id
       WHERE r.status IN ('completed', 'Rejected')
         AND r.requester_id = $1
       ORDER BY r.updated_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch closed requests:', err);
    next(createHttpError(500, 'Failed to fetch closed requests'));
  }
};

const getRequestLogs = async (req, res, next) => {
  const requestId = req.params.id;

  try {
    const { rows } = await pool.query(
      `SELECT rl.*, u.name AS actor_name
       FROM request_logs rl
       LEFT JOIN users u ON rl.actor_id = u.id
       WHERE rl.request_id = $1
       ORDER BY rl.timestamp ASC`,
      [requestId],
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch request logs:', err);
    next(createHttpError(500, 'Failed to fetch request logs'));
  }
};

module.exports = {
  getRequestDetails,
  getRequestItemsOnly,
  getMyRequests,
  getAllRequests,
  getPendingApprovals,
  getAssignedRequests,
  getApprovalHistory,
  getProcurementUsers,
  getMyMaintenanceRequests,
  getPendingMaintenanceApprovals,
  getAuditApprovedRejectedRequests,
  getClosedRequests,
  getRequestLogs,
};