// controllers/utils/reassignPendingApprovals.js
const pool = require('../../config/db');

const reassignPendingApprovals = async () => {
  const client = await pool.connect();
  const results = {
    reassigned: [],
    autoApproved: [],
    failed: [],
  };

  try {
    await client.query('BEGIN');

      const { rows: inactiveApprovals } = await client.query(`
        SELECT a.id AS approval_id, a.request_id, a.approval_level, u.role, u.department_id
        FROM approvals a
        JOIN users u ON a.approver_id = u.id
        WHERE u.is_active = false
          AND a.status = 'Pending'
          AND a.is_active = true
      `);

    for (const approval of inactiveApprovals) {
      const { approval_id, request_id, approval_level, role, department_id } = approval;

      try {
        const { rows, rowCount } = await client.query(
          `SELECT id FROM users 
           WHERE role = $1 AND department_id = $2 AND is_active = true 
           ORDER BY id LIMIT 1`,
          [role, department_id]
        );

        if (rowCount > 0) {
          const newApproverId = rows[0].id;

          await client.query(
            `UPDATE approvals 
             SET approver_id = $1 
             WHERE id = $2`,
            [newApproverId, approval_id]
          );

          await client.query(
            `UPDATE approvals
             SET is_active = true
             WHERE request_id = $1 AND approval_level = $2`,
            [request_id, approval_level + 1]
          );

          await client.query(
            `INSERT INTO request_logs (request_id, action, actor_id, comments)
             VALUES ($1, 'Approval Reassigned', NULL, $2)`,
            [request_id, `Approval level ${approval_level} reassigned to user ${newApproverId}`]
          );

          results.reassigned.push({
            approval_id,
            request_id,
            from_role: role,
            to_user_id: newApproverId,
          });
        } else {
          // Auto-approve
          await client.query(
            `UPDATE approvals
             SET status = 'Approved', approved_at = CURRENT_TIMESTAMP, is_active = false
             WHERE id = $1`,
            [approval_id]
          );

          await client.query(
            `UPDATE approvals
             SET is_active = true
             WHERE request_id = $1 AND approval_level = $2 AND is_active = false`,
            [request_id, approval_level + 1]
          );

          await client.query(
            `INSERT INTO approval_logs (approval_id, request_id, approver_id, action, comments)
             VALUES ($1, $2, NULL, 'Auto-Approved', $3)`,
            [approval_id, request_id, `No active ${role} in department ${department_id}`]
          );

          await client.query(
            `INSERT INTO request_logs (request_id, action, actor_id, comments)
             VALUES ($1, 'Auto-Approved', NULL, $2)`,
            [request_id, `Approval level ${approval_level} auto-approved: no active ${role}`]
          );

          results.autoApproved.push({
            approval_id,
            request_id,
            level: approval_level,
            reason: `No active ${role} in department ${department_id}`,
          });
        }
      } catch (innerErr) {
        console.error(`❌ Error handling approval ID ${approval_id}:`, innerErr);
        results.failed.push({
          approval_id,
          error: innerErr.message,
        });
      }
    }

    await client.query('COMMIT');
    console.log('✅ Pending approvals reassigned/auto-approved successfully');
    return results;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to reassign approvals:', err);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = reassignPendingApprovals;
