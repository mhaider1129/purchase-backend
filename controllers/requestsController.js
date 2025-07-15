//controller/requestsController.js
const pool = require('../config/db');
const { sendEmail } = require('../utils/emailService');

// 🔧 Reusable Error Creator
function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// Centralized Approval Chain Mapping
const APPROVAL_CHAINS = {
  'Stock-Medical-0-5000': ['HOD', 'CMO', 'SCM'],
  'Stock-Medical-5001-999999999': ['HOD', 'CMO', 'SCM', 'CFO'],
  'Stock-Operational-0-999999999': ['HOD', 'SCM', 'COO'],
  'Non-Stock-Medical-0-999999999': ['HOD', 'WarehouseManager', 'CMO', 'SCM', 'COO'],
  'Non-Stock-Operational-0-10000': ['HOD', 'WarehouseManager', 'SCM', 'COO'],
  'Non-Stock-Operational-10001-999999999': ['HOD', 'WarehouseManager', 'SCM', 'COO', 'CFO'],
  'Medical Device-Medical-0-999999999': ['HOD', 'MedicalDevices', 'CMO', 'SCM', 'COO'],
};

const getApproverIdByRole = async (client, role, departmentId) => {
  const globalRoles = ['CMO', 'COO', 'SCM', 'CEO'];

  const query = globalRoles.includes(role.toUpperCase())
    ? `SELECT id FROM users WHERE role = $1 AND is_active = true LIMIT 1`
    : `SELECT id FROM users WHERE role = $1 AND department_id = $2 AND is_active = true LIMIT 1`;

  const values = globalRoles.includes(role.toUpperCase())
    ? [role]
    : [role, departmentId];

  const result = await client.query(query, values);
  return result.rows[0]?.id || null;
};

// ✅ Utility to assign or auto-approve if role is missing
const assignApprover = async (client, role, departmentId, requestId, level) => {
  const globalRoles = ['CMO', 'COO', 'SCM', 'CEO'];
  const query = globalRoles.includes(role.toUpperCase())
    ? `SELECT id, email FROM users WHERE role = $1 AND is_active = true LIMIT 1`
    : `SELECT id, email FROM users WHERE role = $1 AND department_id = $2 AND is_active = true LIMIT 1`;
  const values = globalRoles.includes(role.toUpperCase()) ? [role] : [role, departmentId];
  const result = await client.query(query, values);

  const approverId = result.rows[0]?.id || null;
  const approverEmail = result.rows[0]?.email || null;

  await client.query(
    `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status, approved_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      requestId,
      approverId,
      level,
      approverId ? level === 1 : false,
      approverId ? 'Pending' : 'Approved',
      approverId ? null : new Date(),
    ],
  );

  if (approverId && level === 1 && approverEmail) {
    await sendEmail(
      approverEmail,
      'Approval Required',
      `A new request (ID: ${requestId}) requires your approval.`,
    );
  }
};

// 🔘 Create New Request
const createRequest = async (req, res, next) => {
  const { request_type, justification, budget_impact_month, items } = req.body;

  if (!Array.isArray(items)) return next(createHttpError(400, 'Items must be an array'));
  if (!req.user?.id || !req.user?.department_id) return next(createHttpError(400, 'Invalid user context'));

  if (request_type === 'Stock' && !['warehouse_keeper', 'warehouse_manager'].includes(req.user.role)) {
    return next(createHttpError(403, 'Only warehouse staff can submit stock requests'));
  }

  const requester_id = req.user.id;
  const department_id = req.body.target_department_id || req.user.department_id;
  const section_id = req.body.target_section_id || req.user.section_id || null;

  let maintenance_ref_number = null;
  let initiated_by_technician_id = null;

  if (request_type === 'Maintenance') {
    if (!req.user.role.toLowerCase().includes('technician')) {
      return next(createHttpError(403, 'Only technicians can submit maintenance requests'));
    }
    maintenance_ref_number = req.body.maintenance_ref_number || null;
    initiated_by_technician_id = req.user.id;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: Estimate total cost
    let estimatedCost = 0;
    if (request_type !== 'Stock') {
      estimatedCost = items.reduce((sum, item) => {
        const qty = parseInt(item.quantity) || 0;
        const unitCost = parseInt(item.unit_cost) || 0;
        return sum + (qty * unitCost);
      }, 0);
    }

    // Step 2: Determine domain based on department type
    const deptRes = await client.query('SELECT type FROM departments WHERE id = $1', [department_id]);
    const deptType = deptRes.rows[0]?.type?.toLowerCase();
    const requestDomain = deptType === 'medical' ? 'medical' : 'operational';

    // Step 3: Insert into requests table
    const requestRes = await client.query(
      `INSERT INTO requests (
        request_type, requester_id, department_id, section_id, justification,
        budget_impact_month, estimated_cost, request_domain,
        maintenance_ref_number, initiated_by_technician_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        request_type,
        requester_id,
        department_id,
        section_id,
        justification,
        budget_impact_month,
        estimatedCost,
        requestDomain,
        maintenance_ref_number,
        initiated_by_technician_id
      ]
    );

    const request = requestRes.rows[0];
    if (!request?.id) throw createHttpError(500, '❌ Failed to retrieve request ID after insertion');

    // Step 4: Insert each requested item
    for (const item of items) {
      const { item_name, quantity, unit_cost, available_quantity, intended_use } = item;
      const total_cost = (parseInt(quantity) || 0) * (parseInt(unit_cost) || 0);

      await client.query(
        `INSERT INTO requested_items (
          request_id, item_name, quantity, unit_cost, total_cost, available_quantity, intended_use
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          request.id,
          item_name,
          quantity,
          unit_cost,
          total_cost,
          available_quantity || null,
          intended_use || null
        ]
      );
    }

    // Step 5: Insert approval chain
    if (request_type === 'Maintenance') {
      const designatedRequesterRes = await client.query(
        `SELECT id FROM users 
         WHERE role = 'requester' 
           AND department_id = $1 
           AND ($2::int IS NULL OR section_id = $2) 
           AND is_active = true 
         LIMIT 1`,
        [department_id, section_id]
      );
      const designatedRequesterId = designatedRequesterRes.rows[0]?.id;
      if (!designatedRequesterId) throw createHttpError(400, 'No designated requester found for this section');

      await client.query(`
        INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status)
        VALUES ($1, $2, 1, true, 'Pending')`,
        [request.id, designatedRequesterId]
      );

    } else {
      const capitalize = (s = '') => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

      let costKey;
      if (request_type === 'Stock' && deptType === 'medical') {
        costKey = estimatedCost <= 5000 ? '0-5000' : '5001-999999999';
      } else if (request_type === 'Stock') {
        costKey = '0-999999999';
      } else if (request_type === 'Non-Stock' && deptType === 'medical') {
        costKey = '0-999999999';
      } else if (request_type === 'Non-Stock') {
        costKey = estimatedCost <= 10000 ? '0-10000' : '10001-999999999';
      } else if (request_type === 'Medical Device') {
        costKey = '0-999999999';
      } else {
        throw createHttpError(400, `Unhandled request_type: ${request_type}`);
      }

      const chainKey = `${request_type}-${capitalize(deptType)}-${costKey}`;
      const approvalRoles = APPROVAL_CHAINS[chainKey];
      if (!approvalRoles) throw createHttpError(400, `No approval chain found for ${chainKey}`);

      for (let i = 0; i < approvalRoles.length; i++) {
        const role = approvalRoles[i];

        if (role === req.user.role && i === 0) {
          await client.query(
            `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status, approved_at)
             VALUES ($1, $2, $3, false, 'Approved', CURRENT_TIMESTAMP)`,
            [request.id, requester_id, i + 1]
          );
        } else {
          await assignApprover(client, role, department_id, request.id, i + 1);
        }
      }
    }

    // Step 6: Log creation
    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Created', $2, $3)`,
      [request.id, requester_id, justification]
    );

    await client.query('COMMIT');
    res.status(201).json({
      message: '✅ Request created successfully with approval routing',
      request_id: request.id,
      estimated_cost: estimatedCost,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating request:', err);
    next(createHttpError(500, 'Failed to create request'));
  } finally {
    client.release();
  }
};

// 🔘 Additional Request Controllers

// 🔍 Get Request Details
const getRequestDetails = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const accessCheck = await pool.query(
      `SELECT r.*
       FROM requests r
       LEFT JOIN approvals a ON r.id = a.request_id
       WHERE r.id = $1 AND (r.requester_id = $2 OR a.approver_id = $2 OR r.assigned_to = $2)
       LIMIT 1`,
      [id, userId]
    );

    if (accessCheck.rowCount === 0)
      return next(createHttpError(404, 'Request not found or access denied'));

    const request = accessCheck.rows[0];

    const itemsRes = await pool.query(
      `SELECT item_name, quantity, unit_cost, total_cost FROM requested_items WHERE request_id = $1`,
      [id]
    );

    let assignedUser = null;
    if (request.assigned_to) {
      const assignedRes = await pool.query(
        `SELECT id, name, role FROM users WHERE id = $1`,
        [request.assigned_to]
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
  const userId = req.user.id;

  try {
    // Check if the user is the requester, approver, or assigned procurement user
    const accessCheck = await pool.query(
      `
      SELECT r.id
      FROM requests r
      LEFT JOIN approvals a ON r.id = a.request_id
      WHERE r.id = $1 
        AND (
          r.requester_id = $2 
          OR a.approver_id = $2
          OR r.assigned_to = $2
        )
      `,
      [id, userId]
    );

    if (accessCheck.rowCount === 0) {
      return next(createHttpError(404, 'Request not found or access denied'));
    }

    const itemsRes = await pool.query(
      `
      SELECT id, item_name, quantity, unit_cost, total_cost, procurement_status, procurement_comment
      FROM requested_items 
      WHERE request_id = $1
      `,
      [id]
    );

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
        AND EXISTS (
          SELECT 1 FROM requested_items ri
          WHERE ri.request_id = r.id
            AND LOWER(ri.item_name) LIKE $${params.length}
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
      params
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching my requests:', err);
    next(createHttpError(500, 'Failed to fetch your requests'));
  }
};

// ✅ Get Approval History for Logged-in User
const getApprovalHistory = async (req, res, next) => {
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
         a.approved_at AS approved_at
       FROM approvals a
       JOIN requests r ON a.request_id = r.id
       WHERE a.approver_id = $1 AND a.status IN ('Approved', 'Rejected')
       ORDER BY a.approved_at DESC`,
      [req.user.id]
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

const { successResponse, errorResponse } = require('../utils/responseFormatter');

const getAllRequests = async (req, res, next) => {
  const {
    filter,
    sort,
    request_type,
    search,
    from_date,
    to_date,
    page = 1,
    limit = 10,
  } = req.query;

  const offset = (page - 1) * limit;
  const params = [];
  let whereClauses = [];
  let orderBy = 'r.created_at DESC';

  // Filtering
  if (filter === 'unassigned') {
    whereClauses.push('r.assigned_to IS NULL');
  }

  if (request_type) {
    params.push(request_type);
    whereClauses.push(`r.request_type = $${params.length}`);
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    whereClauses.push(`(LOWER(r.justification) LIKE $${params.length} OR LOWER(r.request_type) LIKE $${params.length})`);
  }

  if (from_date) {
    params.push(from_date);
    whereClauses.push(`r.created_at >= $${params.length}`);
  }

  if (to_date) {
    params.push(to_date);
    whereClauses.push(`r.created_at <= $${params.length}`);
  }

  // Sorting
  if (sort === 'assigned') {
    orderBy = 'r.assigned_to NULLS LAST, r.created_at DESC';
  }

  const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `
      SELECT 
        r.*,
        u.name AS assigned_user_name,
        u.role AS assigned_user_role,
        ap.approval_level AS current_approval_level,
        au.role AS current_approver_role
      FROM requests r
      LEFT JOIN users u ON r.assigned_to = u.id
      LEFT JOIN approvals ap ON r.id = ap.request_id AND ap.is_active = true
      LEFT JOIN users au ON ap.approver_id = au.id
      ${whereSQL}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limit, offset]
    );

    const totalCountRes = await pool.query(
      `SELECT COUNT(*) FROM requests r ${whereSQL}`,
      params
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
      [userId]
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
       WHERE a.approver_id = $1 AND a.is_active = true AND a.status = 'Pending'
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch pending approvals:', err);
    next(createHttpError(500, 'Server error while fetching pending approvals'));
  }
};


const assignRequestToProcurement = async (req, res, next) => {
  const { request_id, user_id } = req.body;
  if (!['SCM', 'admin'].includes(req.user.role))
    return next(createHttpError(403, 'Only SCM or Admin can assign requests'));
  
  try {
    const userCheck = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role IN ('ProcurementSupervisor', 'ProcurementSpecialist')`,
      [user_id]
    );
    if (userCheck.rowCount === 0)
      return next(createHttpError(400, 'Invalid procurement staff'));

    await pool.query(
      `UPDATE requests SET assigned_to = $1 WHERE id = $2`,
      [user_id, request_id]
    );

    res.json({ message: '✅ Request assigned successfully' });
  } catch (err) {
    console.error('❌ Assignment error:', err);
    next(createHttpError(500, 'Failed to assign request'));
  }
};

const updateApprovalStatus = async (req, res, next) => {
  const approval_id = req.params.id;
  const { status: decision, comments = '', is_urgent = false } = req.body;
  const approver_id = req.user.id;

  console.log('📦 Incoming body:', req.body);
  console.log('🛠️ DEBUG — Approval ID from params:', approval_id);

  if (!['Approved', 'Rejected'].includes(decision)) {
    return next(createHttpError(400, 'Approval status must be either Approved or Rejected'));
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Validate active approval
    const approvalRes = await client.query(
      `SELECT id, request_id, approval_level FROM approvals 
       WHERE id = $1 AND approver_id = $2 AND is_active = true`,
      [approval_id, approver_id]
    );

    if (approvalRes.rowCount === 0) {
      return next(createHttpError(403, 'You are not the active approver for this request'));
    }

    const currentApproval = approvalRes.rows[0];
    const request_id = currentApproval.request_id;

    // Step 2: Update approval record
    await client.query(
      `UPDATE approvals 
       SET status = $1, is_active = false, approved_at = CURRENT_TIMESTAMP, comments = $2, is_urgent = COALESCE($3, is_urgent)
       WHERE id = $4`,
      [decision, comments, is_urgent, approval_id]
    );

    // Step 3: If urgent, flag the request
    if (is_urgent === true) {
      await client.query(`UPDATE requests SET is_urgent = true WHERE id = $1`, [request_id]);
    }

    // Step 4: Log the decision
    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, $2, $3, $4)`,
      [request_id, decision, approver_id, comments]
    );

    // Step 5: Special maintenance technician approval handling
    const reqRes = await client.query(
      `SELECT request_type, department_id FROM requests WHERE id = $1`,
      [request_id]
    );
    const { request_type, department_id } = reqRes.rows[0];

    if (request_type === 'Maintenance' && currentApproval.approval_level === 1) {
      // Reassign requester
      await client.query(`UPDATE requests SET requester_id = $1 WHERE id = $2`, [approver_id, request_id]);

      // Determine department type
      const deptRes = await client.query(`SELECT type FROM departments WHERE id = $1`, [department_id]);
      const deptType = deptRes.rows[0]?.type.toLowerCase(); // 'medical' or 'operational'

      // Define next roles
      let nextRoles = ['HOD', 'SCM', 'COO'];
      if (deptType === 'medical') nextRoles.splice(2, 0, 'CMO');

      // Assign next approval steps
      for (let i = 0; i < nextRoles.length; i++) {
        const nextUserRes = await client.query(
          `SELECT id FROM users WHERE role = $1 AND department_id = $2 AND is_active = true LIMIT 1`,
          [nextRoles[i], department_id]
        );

        if (nextUserRes.rowCount > 0) {
          await client.query(
            `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status)
             VALUES ($1, $2, $3, $4, 'Pending')`,
            [request_id, nextUserRes.rows[0].id, currentApproval.approval_level + 1 + i, i === 0] // Activate next
          );
        }
      }
    } else {
      // Step 6: Continue normal approval flow
      if (decision === 'Rejected') {
        await client.query(`UPDATE requests SET status = 'Rejected' WHERE id = $1`, [request_id]);
      } else {
        const nextApprovalRes = await client.query(
          `SELECT id FROM approvals WHERE request_id = $1 AND approval_level = $2`,
          [request_id, currentApproval.approval_level + 1]
        );

        if (nextApprovalRes.rowCount > 0) {
          await client.query(
            `UPDATE approvals SET is_active = true WHERE id = $1`,
            [nextApprovalRes.rows[0].id]
          );
        } else {
          await client.query(`UPDATE requests SET status = 'Approved' WHERE id = $1`, [request_id]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ message: `✅ Request ${decision.toLowerCase()} successfully` });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error in approval workflow:', err);
    next(createHttpError(500, 'Failed to update approval status'));
  } finally {
    client.release();
  }
};

const markRequestAsCompleted = async (req, res, next) => {
  const { id } = req.params;
  const { user_id, role } = req.user;

  const allowedRoles = ['SCM', 'ProcurementSupervisor', 'ProcurementSpecialist'];
  if (!allowedRoles.includes(role)) {
    return next(createHttpError(403, 'Unauthorized to mark request as completed'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ✅ Ensure all items have a procurement status
    const itemCheck = await client.query(
      `SELECT COUNT(*) AS incomplete_count
       FROM requested_items
       WHERE request_id = $1 AND (procurement_status IS NULL OR procurement_status = '')`,
      [id]
    );

    const incompleteCount = parseInt(itemCheck.rows[0].incomplete_count);
    if (incompleteCount > 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Not all items have a procurement status.'));
    }

    // ✅ Update request status and completion time
    await client.query(
      `UPDATE requests
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    // 📝 Log it
    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Marked as Completed', $2, 'All items finalized by procurement')`,
      [id, user_id]
    );

    await client.query('COMMIT');
    res.json({ message: '✅ Request marked as completed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to mark request as completed:', err.message);
    next(createHttpError(500, 'Failed to complete the request'));
  } finally {
    client.release();
  }
};

// ✅ Fetch all completed or rejected requests
const getClosedRequests = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name AS assigned_user_name
       FROM requests r
       LEFT JOIN users u ON r.assigned_to = u.id
       WHERE r.status IN ('completed', 'Rejected')
       ORDER BY r.updated_at DESC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch closed requests:', err);
    next(createHttpError(500, 'Failed to fetch closed requests'));
  }
};

const getMyMaintenanceRequests = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, justification, maintenance_ref_number, status, created_at
       FROM requests
       WHERE request_type = 'Maintenance' AND initiated_by_technician_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching maintenance requests:', err);
    next(createHttpError(500, 'Failed to fetch maintenance requests'));
  }
};

const getPendingMaintenanceApprovals = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT 
         r.id AS request_id, 
         r.justification, 
         r.maintenance_ref_number, 
         r.budget_impact_month, 
         u.name AS technician_name, 
         d.name AS department_name,
         s.name AS section_name,
         r.created_at
       FROM requests r
       JOIN users u ON r.requester_id = u.id -- 👈 FIXED: use requester_id instead of technician_id
       JOIN departments d ON r.department_id = d.id
       LEFT JOIN sections s ON r.section_id = s.id
       JOIN approvals a ON a.request_id = r.id
       WHERE r.request_type = 'Maintenance'
         AND a.approver_id = $1
         AND a.status = 'Pending'
         AND a.is_active = true
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching maintenance approvals:', err);
    next(createHttpError(500, 'Failed to fetch maintenance requests'));
  }
};

const approveMaintenanceRequest = async (req, res, next) => {
  const { request_id, decision, comments = '' } = req.body;
  const user_id = req.user.id;

  if (!['Approved', 'Rejected'].includes(decision)) {
    return next(createHttpError(400, 'Decision must be Approved or Rejected'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqRes = await client.query(`SELECT * FROM requests WHERE id = $1`, [request_id]);
    if (reqRes.rowCount === 0) throw createHttpError(404, 'Request not found');

    const originalRequest = reqRes.rows[0];

    if (decision === 'Rejected') {
      // ❌ Rejected: update status and log
      await client.query(`UPDATE requests SET status = 'Rejected' WHERE id = $1`, [request_id]);

      await client.query(
        `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Maintenance Request Rejected by Requester', $2, $3)`,
        [request_id, user_id, comments]
      );
    } else {
      // ✅ Approved by Requester → Set status to Submitted
      await client.query(
        `UPDATE requests 
         SET requester_id = $1, status = 'Submitted', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [user_id, request_id]
      );

      await client.query(
        `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Maintenance Request Approved by Requester', $2, $3)`,
        [request_id, user_id, comments]
      );

      // ✅ Mark requester's approval as approved
      await client.query(
        `UPDATE approvals
         SET status = 'Approved',
             approved_at = NOW(),
             comments = $1,
             is_active = false
         WHERE request_id = $2 AND approver_id = $3`,
        [comments, request_id, user_id]
      );

      // 🔄 Initialize next approvals
      const { initializeApprovals } = require('./utils/initializeApprovals');
      await initializeApprovals(request_id, client); // Pass client to reuse transaction
    }

    await client.query('COMMIT');
    res.json({ message: `Request ${decision.toLowerCase()} successfully.` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Maintenance approval error:', err);
    next(createHttpError(500, 'Failed to process maintenance request decision'));
  } finally {
    client.release();
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
      [requestId]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch request logs:', err);
    next(createHttpError(500, 'Failed to fetch request logs'));
  }
};

module.exports = {
  createRequest,
  getRequestDetails,
  getRequestItemsOnly,
  getMyRequests,
  getAllRequests,
  getPendingApprovals,
  assignRequestToProcurement,
  updateApprovalStatus,
  getApprovalHistory,
  assignApprover,
  getProcurementUsers,
  getAssignedRequests,
  getMyMaintenanceRequests,
  getPendingMaintenanceApprovals,
  approveMaintenanceRequest,
  getApproverIdByRole,
  getRequestLogs,
  markRequestAsCompleted,
  getClosedRequests,
};