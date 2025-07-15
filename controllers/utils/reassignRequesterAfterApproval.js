//controllers/utils/reassignRequesterAfterApproval.js
const pool = require('../../config/db');

const reassignRequesterAfterApproval = async (requestId, newRequesterId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Optional: Validate new requester
    const userCheck = await client.query(
      'SELECT id FROM users WHERE id = $1 AND is_active = true',
      [newRequesterId]
    );
    if (userCheck.rowCount === 0) {
      throw new Error('New requester is not active or does not exist');
    }

    // Store old requester for logging
    const oldRequesterRes = await client.query(
      'SELECT requester_id FROM requests WHERE id = $1',
      [requestId]
    );
    const oldRequesterId = oldRequesterRes.rows[0]?.requester_id;

    // Update requester_id
    await client.query(
      `UPDATE requests SET requester_id = $1 WHERE id = $2`,
      [newRequesterId, requestId]
    );

    // Log reassignment
    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Requester Reassigned', $2, $3)`,
      [requestId, newRequesterId, `Requester changed from ${oldRequesterId} to ${newRequesterId} (Technician handoff)`]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = reassignRequesterAfterApproval;

