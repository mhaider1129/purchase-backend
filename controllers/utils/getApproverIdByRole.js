// purchase-backend/controllers/utils/getApproverIdByRole.js

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

module.exports = { getApproverIdByRole };
