const { sendEmail } = require('../../utils/emailService');

/**
 * Fetch approval routing configuration from the database.
 * Returns an array of objects: { approval_level, role }
 */
const fetchApprovalRoutes = async (
  client,
  requestType,
  departmentType,
  cost,
) => {
  const { rows } = await client.query(
    `SELECT approval_level, role
       FROM approval_routes
      WHERE request_type = $1
        AND department_type = $2
        AND $3 BETWEEN COALESCE(min_amount, 0) AND COALESCE(max_amount, 999999999)
      ORDER BY approval_level`,
    [requestType, departmentType, cost],
  );
  return rows;
};

const assignApprover = async (
  client,
  role,
  departmentId,
  requestId,
  requestType,
  level,
  requestDomain = null,
) => {
  const globalRoles = ['CMO', 'COO', 'SCM', 'CEO'];
  let targetDepartmentId = departmentId;

  if (role === 'WarehouseManager' && requestType === 'Non-Stock') {
    const opRes = await client.query(
      `SELECT d.id
       FROM departments d
       JOIN users u ON u.department_id = d.id
       WHERE LOWER(d.type) = 'operational'
         AND u.role = 'WarehouseManager'
         AND u.is_active = true
       ORDER BY d.id LIMIT 1`,
    );
    targetDepartmentId = opRes.rows[0]?.id || departmentId;
  }

  if (
    role === 'WarehouseManager' &&
    requestType === 'Warehouse Supply' &&
    requestDomain
  ) {
    const wsRes = await client.query(
      `SELECT d.id
         FROM departments d
         JOIN users u ON u.department_id = d.id
        WHERE LOWER(d.type) = $1
          AND u.role = 'WarehouseManager'
          AND u.is_active = TRUE
        LIMIT 1`,
      [requestDomain.toLowerCase()],
    );
    targetDepartmentId = wsRes.rows[0]?.id || targetDepartmentId;
  }

  const query = globalRoles.includes(role.toUpperCase())
    ? `SELECT id, email FROM users WHERE role = $1 AND is_active = true LIMIT 1`
    : `SELECT id, email FROM users WHERE role = $1 AND department_id = $2 AND is_active = true LIMIT 1`;
  const values = globalRoles.includes(role.toUpperCase())
    ? [role]
    : [role, targetDepartmentId];
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
      'New Purchase Request Awaiting Approval',
      `You have a new ${requestType} request to review.\nRequest ID: ${requestId}\nPlease log in to the system to take action.`,
    );
  }
};

module.exports = {
  fetchApprovalRoutes,
  assignApprover,
};
