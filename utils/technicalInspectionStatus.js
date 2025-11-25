const pool = require('../config/db');
const ensureTechnicalInspectionsTable = require('./ensureTechnicalInspectionsTable');

const normalizeRunner = (client) => (client && client.query ? client : pool);

const getInspectionSummaryForRequest = async (client, requestId) => {
  if (!requestId) {
    return { pendingCount: 0, totalCount: 0 };
  }

  const runner = normalizeRunner(client);
  await ensureTechnicalInspectionsTable(runner);

  const { rows } = await runner.query(
    `SELECT
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(acceptance_status, 'pending')) <> 'passed'
        ) AS pending_count,
        COUNT(*) AS total_count
      FROM technical_inspections
     WHERE request_id = $1`,
    [requestId],
  );

  const pendingCount = Number(rows[0]?.pending_count || 0);
  const totalCount = Number(rows[0]?.total_count || 0);

  return { pendingCount, totalCount };
};

const applyRequestStatusFromInspections = async (
  client,
  { requestId, actorId = null, pendingComment, completedComment },
) => {
  const runner = normalizeRunner(client);
  const summary = await getInspectionSummaryForRequest(runner, requestId);

  if (summary.totalCount === 0) {
    return { ...summary, appliedStatus: null, statusUpdated: false };
  }

  const hasPending = summary.pendingCount > 0;
  const targetStatus = hasPending ? 'technical_inspection_pending' : 'completed';

  const updateRes = await runner.query(
    `UPDATE requests
        SET status = $1,
            completed_at = CASE
              WHEN $1 = 'completed' THEN COALESCE(completed_at, CURRENT_TIMESTAMP)
              ELSE completed_at
            END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
        AND LOWER(status) <> 'received'`,
    [targetStatus, requestId],
  );

  const statusUpdated = updateRes.rowCount > 0;

  if (statusUpdated) {
    const comment = hasPending
      ? pendingComment || 'Awaiting technical inspection before requester receipt.'
      : completedComment || 'Technical inspections passed; request marked as completed.';

    await runner.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, $2, $3, $4)`,
      [
        requestId,
        hasPending ? 'Technical Inspection Pending' : 'Marked as Completed',
        actorId ?? null,
        comment,
      ],
    );
  }

  return { ...summary, appliedStatus: targetStatus, statusUpdated };
};

module.exports = { getInspectionSummaryForRequest, applyRequestStatusFromInspections };