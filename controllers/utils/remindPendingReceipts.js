const pool = require('../../config/db');
const { sendEmail } = require('../../utils/emailService');
const { createNotifications } = require('../../utils/notificationService');
const ensureRequestedItemReceivedColumns = require('../../utils/ensureRequestedItemReceivedColumns');

const remindPendingReceipts = async () => {
  const client = await pool.connect();
  try {
    await ensureRequestedItemReceivedColumns(client);

    const { rows } = await client.query(`
      SELECT r.id AS request_id, r.request_type, r.requester_id, u.email,
             r.completed_at, r.receipt_prompt_sent_at
      FROM requests r
      JOIN users u ON u.id = r.requester_id
      WHERE LOWER(COALESCE(r.status, '')) = 'completed'
        AND r.completed_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM requested_items ri
          WHERE ri.request_id = r.id
            AND COALESCE(ri.is_received, false) = false
        )
        AND (
          (r.receipt_prompt_sent_at IS NULL AND r.completed_at <= NOW() - INTERVAL '48 hours')
          OR (r.receipt_prompt_sent_at IS NOT NULL AND r.receipt_prompt_sent_at <= NOW() - INTERVAL '24 hours')
        )
    `);

    for (const row of rows) {
      const isFollowUp = Boolean(row.receipt_prompt_sent_at);
      const title = isFollowUp
        ? `Request ${row.request_id} auto-received`
        : `Confirm receipt for request ${row.request_id}`;
      const message = isFollowUp
        ? `Your ${row.request_type || 'purchase'} request (ID: ${row.request_id}) was automatically marked as received because the receipt confirmation prompt was not answered within 24 hours.`
        : `Your ${row.request_type || 'purchase'} request (ID: ${row.request_id}) was purchased. Please go to My Closed Requests and confirm item receipt.`;

      try {
        await client.query('BEGIN');

        if (isFollowUp) {
          await client.query(
            `UPDATE requested_items
             SET is_received = TRUE,
                 received_at = COALESCE(received_at, CURRENT_TIMESTAMP)
             WHERE request_id = $1
               AND COALESCE(is_received, FALSE) = FALSE`,
            [row.request_id],
          );

          await client.query(
            `UPDATE requests
             SET status = 'received',
                 auto_received_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [row.request_id],
          );
        } else {
          await client.query(
            `UPDATE requests
             SET receipt_prompt_sent_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [row.request_id],
          );
        }

        await createNotifications([
          {
            userId: row.requester_id,
            title,
            message,
            link: '/closed-requests',
            metadata: {
              requestId: row.request_id,
              action: isFollowUp ? 'request_auto_received' : 'request_receipt_confirmation_required',
            },
          },
        ], client);

        await client.query('COMMIT');

        if (row.email) {
          await sendEmail(row.email, title, `${message}\nOpen: My Closed Requests to review.`);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed to process receipt reminder for request ${row.request_id}:`, err);
      }
    }
  } catch (err) {
    console.error('❌ Failed to run pending receipt reminder job:', err);
  } finally {
    client.release();
  }
};

module.exports = remindPendingReceipts;