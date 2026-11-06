const pool = require("../../config/db");
const notices = require("../../services/workflowNotificationService");
const ensureApprovalReminderColumn = require("../../utils/ensureApprovalReminderColumn");
const remindPendingApprovals = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureApprovalReminderColumn(client);
    const { rows } = await client.query(
      `SELECT a.id,a.request_id,a.approver_id,r.institute_id FROM approvals a JOIN requests r ON r.id=a.request_id JOIN users u ON u.id=a.approver_id AND u.institute_id=r.institute_id AND u.is_active WHERE a.status='Pending' AND COALESCE(a.is_superseded,false)=false AND a.is_active AND COALESCE(a.reminder_sent_at,r.created_at)<=now()-interval '72 hours' AND u.email IS NOT NULL FOR UPDATE OF a SKIP LOCKED`,
    );
    for (const row of rows) {
      const operationKey = `scheduled-reminder:${row.id}:${new Date().toISOString().slice(0, 10)}`;
      await client.query(
        "UPDATE approvals SET reminder_sent_at=now() WHERE id=$1",
        [row.id],
      );
      await notices.email(client, {
        requestId: row.request_id,
        userId: row.approver_id,
        subject: "Approval Reminder",
        message: `Request ${row.request_id} is pending your approval. Please sign in to review it.`,
        approvalId: row.id,
        operationKey,
      });
      await require("../../services/auditService").writeAuditEvent({
        client,
        entityType: "approval",
        entityId: row.id,
        requestId: row.request_id,
        instituteId: row.institute_id,
        actorUserId: null,
        action: "APPROVAL_REMINDER_QUEUED",
        operationKey,
        afterData: { delivery_status: "queued" },
      });
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
module.exports = remindPendingApprovals;
