// Compatibility schema helper remains for existing read-only workspace callers.
const pool = require("../../config/db");
const {
  successResponse,
  errorResponse,
} = require("../../utils/responseFormatter");
const assignment = require("../../services/procurementAssignmentService");
let assignmentColumnsEnsurePromise = null;

const runRequestedItemAssignmentEnsure = async (clientOrPool) => {
  await clientOrPool.query(`
    ALTER TABLE public.requested_items
      ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES public.users(id),
      ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES public.users(id),
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS assignment_notes TEXT
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_requested_items_assigned_to
      ON public.requested_items(assigned_to)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_requested_items_request_assignee
      ON public.requested_items(request_id, assigned_to)
  `);
};

const ensureRequestedItemAssignmentColumns = async (clientOrPool = pool) => {
  if (clientOrPool !== pool) {
    await runRequestedItemAssignmentEnsure(clientOrPool);
    return;
  }

  if (!assignmentColumnsEnsurePromise) {
    assignmentColumnsEnsurePromise = runRequestedItemAssignmentEnsure(
      pool,
    ).catch((err) => {
      assignmentColumnsEnsurePromise = null;
      throw err;
    });
  }

  await assignmentColumnsEnsurePromise;
};

const command = (req, method) => ({
  actor: req.user,
  method,
  requestId: req.params.id || req.body.request_id,
  assignments:
    method === "split" ? req.body.assignments : [{ user_id: req.body.user_id }],
  expectedAssigneeId: req.body.expected_assignee_id,
  expectedItemAssignees: req.body.expected_item_assignees,
  reason: req.body.reason,
});
const handler = (method) => async (req, res) => {
  try {
    const result = await assignment.assign(command(req, method));
    return successResponse(
      res,
      method === "split"
        ? "✅ Request split assignment saved successfully"
        : "✅ Request assigned successfully",
      result,
    );
  } catch (e) {
    return errorResponse(
      res,
      e.statusCode || 500,
      e.statusCode
        ? e.message
        : "Internal server error while assigning request",
    );
  }
};
const assignRequestToUser = handler("manual");
const splitAssignRequest = handler("split");
const assignRequestLegacy = async (req, res, next) => {
  try {
    await assignment.assign(command(req, "manual"));
    return res.json({ message: "✅ Request assigned successfully" });
  } catch (e) {
    return next(e);
  }
};
module.exports = {
  assignRequestToUser,
  splitAssignRequest,
  assignRequestLegacy,
  ensureRequestedItemAssignmentColumns,
};
