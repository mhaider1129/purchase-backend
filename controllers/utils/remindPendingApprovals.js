const pool = require('../../config/db');
const { sendEmail } = require('../../utils/emailService');

const remindPendingApprovals = async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT a.request_id, u.email
      FROM approvals a
      JOIN users u ON a.approver_id = u.id
      JOIN requests r ON a.request_id = r.id
      WHERE a.status = 'Pending'
        AND a.is_active = true
        AND r.created_at <= NOW() - INTERVAL '3 days'
        AND u.email IS NOT NULL
    `);

    for (const row of rows) {
      await sendEmail(
        row.email,
        'Approval Reminder',
        `Request ID ${row.request_id} has been pending your approval for more than 3 days.`
      );
    }
  } catch (err) {
    console.error('❌ Failed to send pending approval reminders:', err);
  } finally {
    client.release();
  }
};

module.exports = remindPendingApprovals;