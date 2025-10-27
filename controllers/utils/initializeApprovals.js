const pool = require('../../config/db');
const {
  fetchApprovalRoutes,
  assignApprover,
} = require('./approvalRouting');

const initializeApprovals = async (request_id, externalClient = null) => {
  const client = externalClient || (await pool.connect());
  const releaseClient = !externalClient;

  try {
    // 1. Fetch request details
    const { rows } = await client.query(
      `SELECT id, department_id, request_type, estimated_cost, request_domain, requester_id
       FROM requests
       WHERE id = $1`,
      [request_id]
    );
    if (rows.length === 0) throw new Error('Request not found');
    const request = rows[0];

    // Normalize the initial requester approval to level 0 for legacy data
    const { rows: requesterApprovalRows } = await client.query(
      `SELECT id, approval_level
         FROM approvals
        WHERE request_id = $1
        ORDER BY approval_level ASC
        LIMIT 1`,
      [request_id],
    );

    if (
      requesterApprovalRows[0] &&
      Number(requesterApprovalRows[0].approval_level) > 0
    ) {
      await client.query(
        `UPDATE approvals SET approval_level = 0 WHERE id = $1`,
        [requesterApprovalRows[0].id],
      );
    }

    // Remove any previously generated approvals beyond the initial requester decision
    await client.query(
      `DELETE FROM approvals WHERE request_id = $1 AND approval_level > 0`,
      [request_id],
    );

    // Determine department context
    const deptRes = await client.query(
      `SELECT type FROM departments WHERE id = $1`,
      [request.department_id]
    );
    const deptType = deptRes.rows[0]?.type?.toLowerCase() || null;

    const domainForChain =
      request.request_type === 'Warehouse Supply'
        ? request.request_domain || deptType
        : deptType;

    const routes = await fetchApprovalRoutes(
      client,
      request.request_type,
      domainForChain,
      request.estimated_cost || 0,
    );

    const requesterRoleRes = await client.query(
      `SELECT role FROM users WHERE id = $1`,
      [request.requester_id],
    );
    const requesterRole = requesterRoleRes.rows[0]?.role || null;

    const { rows: maxLevelRows } = await client.query(
      `SELECT COALESCE(MAX(approval_level), 0) AS max_level
         FROM approvals
        WHERE request_id = $1`,
      [request_id],
    );
    let currentLevel = Number(maxLevelRows[0]?.max_level || 0);

    let inserted = false;

    if (!routes.length) {
      // Fallback to SCM approval if no routes are configured
      currentLevel += 1;
      await assignApprover(
        client,
        'SCM',
        request.department_id,
        request.id,
        request.request_type,
        currentLevel,
        request.request_domain,
      );
      inserted = true;
    } else {
      for (const { role, approval_level } of routes) {
        if (approval_level === 1 && requesterRole && role === requesterRole) {
          // Requester already approved at level 0
          continue;
        }

        currentLevel += 1;
        await assignApprover(
          client,
          role,
          request.department_id,
          request.id,
          request.request_type,
          currentLevel,
          request.request_domain,
        );
        inserted = true;
      }
    }

    if (inserted) {
      await client.query(
        `UPDATE approvals
            SET is_active = TRUE
          WHERE request_id = $1
            AND status = 'Pending'
            AND approval_level = (
              SELECT MIN(approval_level)
                FROM approvals
               WHERE request_id = $1
                 AND status = 'Pending'
            )`,
        [request_id],
      );
    } else {
      await client.query(
        `UPDATE requests
            SET status = 'Approved',
                updated_at = NOW()
          WHERE id = $1`,
        [request_id],
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
