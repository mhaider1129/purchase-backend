const pool = require('../../config/db');
const { assignApprover } = require('../requests/createRequestController');
const { fetchApprovalRoutes, resolveRouteDomain } = require('./approvalRoutes');

const initializeApprovals = async (request_id, externalClient = null) => {
  const client = externalClient || (await pool.connect());
  const releaseClient = !externalClient;

  try {
    const { rows } = await client.query(
      `SELECT id, department_id, request_type, request_domain, estimated_cost, requester_id
         FROM requests
        WHERE id = $1`,
      [request_id],
    );
    if (rows.length === 0) throw new Error('Request not found');
    const request = rows[0];

    const routeDomain = await resolveRouteDomain({
      client,
      departmentId: request.department_id,
      explicitDomain: request.request_domain,
      requestType: request.request_type,
    });

    const routeDefinitions = await fetchApprovalRoutes({
      client,
      requestType: request.request_type,
      departmentType: routeDomain,
      amount: request.estimated_cost || 0,
    });

    if (!routeDefinitions.length) {
      const existing = await client.query(
        `SELECT 1 FROM approvals WHERE request_id = $1 AND approval_level = 1 LIMIT 1`,
        [request_id],
      );

      if (existing.rowCount === 0) {
        await assignApprover(
          client,
          'SCM',
          request.department_id,
          request.id,
          request.request_type,
          1,
          routeDomain,
        );
      }
    } else {
      let requesterRole = '';
      if (request.requester_id) {
        const requesterRoleRes = await client.query(
          `SELECT role FROM users WHERE id = $1`,
          [request.requester_id],
        );
        requesterRole = requesterRoleRes.rows[0]?.role?.trim().toLowerCase() || '';
      }

      for (const route of routeDefinitions) {
        const existing = await client.query(
          `SELECT 1 FROM approvals WHERE request_id = $1 AND approval_level = $2 LIMIT 1`,
          [request_id, route.approval_level],
        );
        if (existing.rowCount > 0) {
          continue;
        }

        const normalizedRole = (route.role || '').trim().toLowerCase();

        if (normalizedRole === 'requester' && request.requester_id) {
          await client.query(
            `INSERT INTO approvals (request_id, approver_id, approval_level, status, is_active, approved_at)
             VALUES ($1, $2, $3, 'Approved', FALSE, CURRENT_TIMESTAMP)`,
            [request_id, request.requester_id, route.approval_level],
          );
          continue;
        }

        if (
          normalizedRole &&
          normalizedRole === requesterRole &&
          request.requester_id &&
          route.approval_level === 1
        ) {
          await client.query(
            `INSERT INTO approvals (request_id, approver_id, approval_level, status, is_active, approved_at)
             VALUES ($1, $2, $3, 'Approved', FALSE, CURRENT_TIMESTAMP)`,
            [request_id, request.requester_id, route.approval_level],
          );
          continue;
        }

        await assignApprover(
          client,
          route.role,
          request.department_id,
          request.id,
          request.request_type,
          route.approval_level,
          routeDomain,
        );
      }
    }

    await client.query(
      `UPDATE approvals
          SET is_active = TRUE
        WHERE request_id = $1
          AND approval_level = (
            SELECT MIN(approval_level)
              FROM approvals
             WHERE request_id = $1
               AND status = 'Pending'
          )`,
      [request_id],
    );
  } catch (err) {
    console.error('❌ Failed to initialize approvals:', err);
    throw err;
  } finally {
    if (releaseClient) client.release();
  }
};

module.exports = { initializeApprovals };