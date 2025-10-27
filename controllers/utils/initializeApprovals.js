const pool = require('../../config/db');
const { getApproverIdByRole } = require('./getApproverIdByRole');

const getApprovalChain = (requestType, isMedical) => {
  if (requestType === 'Maintenance') {
    return isMedical ? ['HOD', 'CMO', 'SCM', 'COO'] : ['HOD', 'SCM', 'COO'];
  }

  // Default fallback
  return ['HOD', 'SCM'];
};

const initializeApprovals = async (request_id, externalClient = null) => {
  const client = externalClient || (await pool.connect());
  const releaseClient = !externalClient;

  try {
    // 1. Fetch request
    const { rows } = await client.query(
      `SELECT id, department_id, request_type, estimated_cost 
       FROM requests 
       WHERE id = $1`,
      [request_id]
    );
    if (rows.length === 0) throw new Error('Request not found');
    const request = rows[0];

    // 2. Determine if department is medical
    const deptRes = await client.query(
      `SELECT type FROM departments WHERE id = $1`,
      [request.department_id]
    );
    const isMedical = deptRes.rows[0]?.type?.toLowerCase() === 'medical';

    // 3. Get approval chain
    const chain = getApprovalChain(request.request_type, isMedical);

    // 4. Insert approvals
    for (let i = 0; i < chain.length; i++) {
      const role = chain[i];
      const approverId = await getApproverIdByRole(client, role, request.department_id);

      if (!approverId) {
        console.warn(`⚠️ No user found for role: ${role} in department_id: ${request.department_id}`);
      }

      await client.query(
        `INSERT INTO approvals (request_id, approver_id, approval_level, status, is_active) 
         VALUES ($1, $2, $3, 'Pending', $4)`,
        [request_id, approverId, i + 1, i === 0]
      );
    }
  } catch (err) {
    console.error('❌ Failed to initialize approvals:', err);
    throw err;
  } finally {
    if (releaseClient) client.release();
  }
};

module.exports = { initializeApprovals };
