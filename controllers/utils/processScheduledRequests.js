const pool = require('../../config/db');

const processScheduledRequests = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dueRes = await client.query(
      `SELECT id
         FROM requests
        WHERE status = 'Scheduled'
          AND scheduled_for IS NOT NULL
          AND scheduled_for <= NOW()
        FOR UPDATE SKIP LOCKED`
    );

    for (const row of dueRes.rows) {
      const requestId = row.id;

      await client.query(
        `UPDATE requests
            SET status = 'Submitted',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [requestId],
      );

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
        [requestId],
      );
    }

    await client.query('COMMIT');
    return dueRes.rowCount;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = processScheduledRequests;