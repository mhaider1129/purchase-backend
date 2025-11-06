const pool = require('../../config/db');
const { sendEmail } = require('../../utils/emailService');
const ensureApprovalReminderColumn = require('../../utils/ensureApprovalReminderColumn');

const remindPendingApprovals = async () => {
  const client = await pool.connect();
  try {
    await ensureApprovalReminderColumn(client);

    const { rows } = await client.query(`
      SELECT a.id, a.request_id, u.email
      FROM approvals a
      JOIN users u ON a.approver_id = u.id
      JOIN requests r ON a.request_id = r.id
      WHERE a.status = 'Pending'
        AND a.is_active = true
        AND COALESCE(a.reminder_sent_at, r.created_at) <= NOW() - INTERVAL '72 hours'
        AND u.email IS NOT NULL
    `);

    for (const row of rows) {
      try {
        await sendEmail(
          row.email,
          'Approval Reminder',
          `Request ID ${row.request_id} has been pending your approval for at least 72 hours. Please review the request.`
        );

        await client.query(
          `UPDATE approvals SET reminder_sent_at = NOW() WHERE id = $1`,
          [row.id]
        );
      } catch (emailErr) {
        console.error(
          `❌ Failed to send reminder for approval ${row.id} (request ${row.request_id}):`,
          emailErr
        );
      }
    }
  } catch (err) {
    console.error('❌ Failed to send pending approval reminders:', err);
  } finally {
    client.release();
  }
};

module.exports = remindPendingApprovals;