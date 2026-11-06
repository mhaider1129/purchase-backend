const pool = require('../../config/db');

const processScheduledRequests = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dueRes = await client.query(
      `SELECT id,institute_id
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
                 AND COALESCE(is_superseded, FALSE) = FALSE
            )`,
        [requestId],
      );
      const approvals=(await client.query("SELECT id,approver_id FROM approvals WHERE request_id=$1 AND status='Pending' AND is_active=true AND COALESCE(is_superseded,false)=false",[requestId])).rows;
      for(const approval of approvals)await require('../../services/workflowNotificationService').notice(client,{requestId,userId:approval.approver_id,title:'Scheduled request needs review',message:`Request ${requestId} is ready for review.`,link:`/requests/${requestId}`,approvalId:approval.id,email:true,operationKey:`scheduled:${requestId}:${approval.id}`});
      await require('../../services/auditService').writeAuditEvent({client,entityType:'request',entityId:requestId,requestId,instituteId:row.institute_id,actorUserId:null,action:'REQUEST_SCHEDULED_ACTIVATED',beforeData:{status:'Scheduled'},afterData:{status:'Submitted'},operationKey:`scheduled:${requestId}`});
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