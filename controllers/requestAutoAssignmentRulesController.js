const pool = require("../config/db");
const withTransaction = require("../utils/withTransaction");
const ensureSchema = require("../utils/ensureRequestAutoAssignmentRulesTable");
const {
  createAssignmentPolicy,
  id,
  error,
  missing,
} = require("../services/procurementAssignmentPolicy");
const {
  AUTO_ASSIGNMENT_REQUEST_TYPES,
  normalizeRequestType,
  isSupportedAutoAssignmentType,
} = require("../services/requestAutoAssignmentService");
const { writeAuditEvent } = require("../services/auditService");
const policy = createAssignmentPolicy();
const serialize = (row) => ({
  id: row.id,
  institute_id: row.institute_id,
  request_type: row.request_type,
  warehouse_id: row.warehouse_id,
  warehouse_name: row.warehouse_name,
  assignee_user_id: row.assignee_user_id,
  assignee_name: row.assignee_name,
  assignee_email: row.assignee_email,
  is_active: row.is_active,
  created_at: row.created_at,
  updated_at: row.updated_at,
});
async function payload(actor, body, client) {
  const requestType = normalizeRequestType(body?.request_type);
  if (!isSupportedAutoAssignmentType(requestType))
    throw error(400, "Choose a supported request type for auto-assignment");
  const warehouseId =
    body.warehouse_id == null || body.warehouse_id === ""
      ? null
      : id(body.warehouse_id);
  if (requestType === "Stock" && warehouseId === null)
    throw error(
      400,
      "Stock auto-assignment rules must select the submitted warehouse",
    );
  if (requestType !== "Stock" && warehouseId !== null)
    throw error(400, "Warehouse criteria is only available for Stock requests");
  if (warehouseId !== null)
    await policy.warehouse(warehouseId, actor.institute_id, client);
  const assigneeId = id(body.assignee_user_id ?? body.user_id);
  await policy.assignee(assigneeId, actor.institute_id, client);
  if (body.is_active !== undefined && typeof body.is_active !== "boolean")
    throw error(400, "is_active must be a boolean");
  return {
    requestType,
    warehouseId,
    assigneeId,
    isActive: body.is_active ?? true,
  };
}
async function audit(client, actor, before, after, action) {
  await writeAuditEvent({
    client,
    entityType: "request_auto_assignment_rule",
    entityId: (after || before).id,
    actorUserId: actor.id,
    instituteId: actor.institute_id,
    action,
    beforeData: before,
    afterData: after,
  });
}
const listAutoAssignmentRules = async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const actor = await policy.actor(req.user, client);
      await ensureSchema(client);
      const rules = (
        await client.query(
          `SELECT r.*,u.name AS assignee_name,u.email AS assignee_email,w.name AS warehouse_name
        FROM request_auto_assignment_rules r JOIN users u ON u.id=r.assignee_user_id LEFT JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN departments warehouse_department ON warehouse_department.id=w.department_id
        WHERE r.institute_id=$1 AND u.institute_id=r.institute_id AND (r.warehouse_id IS NULL OR (w.institute_id=r.institute_id AND (w.department_id IS NULL OR warehouse_department.institute_id=r.institute_id)))
        ORDER BY LOWER(r.request_type),w.name NULLS FIRST,u.name`,
          [actor.institute_id],
        )
      ).rows;
      const users = (
        await client.query(
          "SELECT id FROM users WHERE institute_id=$1 AND is_active=true ORDER BY id",
          [actor.institute_id],
        )
      ).rows;
      const assignees = [];
      for (const user of users) {
        try {
          const u = await policy.assignee(user.id, actor.institute_id, client);
          assignees.push({ id: u.id, name: u.name, role: u.role });
        } catch (e) {
          if (![400, 404].includes(e.statusCode)) throw e;
        }
      }
      const warehouses = (
        await client.query(
          `SELECT w.id,w.name FROM warehouses w LEFT JOIN departments d ON d.id=w.department_id WHERE w.institute_id=$1 AND w.is_active=true AND (w.department_id IS NULL OR d.institute_id=w.institute_id) ORDER BY w.name`,
          [actor.institute_id],
        )
      ).rows;
      return {
        request_types: AUTO_ASSIGNMENT_REQUEST_TYPES,
        rules: rules.map(serialize),
        assignees,
        warehouses,
      };
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
};
const mutate = (mode) => async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const actor = await policy.actor(req.user, client);
      await ensureSchema(client);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('assignment-rules:'||$1::text,0))",
        [actor.institute_id],
      );
      let before = null;
      if (mode !== "upsert") {
        before = (
          await client.query(
            "SELECT * FROM request_auto_assignment_rules WHERE id=$1 AND institute_id=$2 FOR UPDATE",
            [id(req.params.id), actor.institute_id],
          )
        ).rows[0];
        if (!before) throw missing();
      }
      if (mode === "delete") {
        await client.query(
          "DELETE FROM request_auto_assignment_rules WHERE id=$1 AND institute_id=$2",
          [before.id, actor.institute_id],
        );
        await audit(
          client,
          actor,
          before,
          null,
          "AUTO_ASSIGNMENT_RULE_DELETED",
        );
        return null;
      }
      const v = await payload(actor, req.body, client);
      const duplicate = (
        await client.query(
          "SELECT * FROM request_auto_assignment_rules WHERE institute_id=$1 AND LOWER(request_type)=LOWER($2) AND COALESCE(warehouse_id,0)=COALESCE($3::integer,0) FOR UPDATE",
          [actor.institute_id, v.requestType, v.warehouseId],
        )
      ).rows[0];
      if (
        mode === "update" &&
        duplicate &&
        Number(duplicate.id) !== Number(before.id)
      )
        throw error(
          409,
          "A rule already exists for this request type and warehouse",
        );
      before = before || duplicate || null;
      const after = before
        ? (
            await client.query(
              "UPDATE request_auto_assignment_rules SET request_type=$1,warehouse_id=$2,assignee_user_id=$3,is_active=$4,updated_by=$5,updated_at=NOW() WHERE id=$6 AND institute_id=$7 RETURNING *",
              [
                v.requestType,
                v.warehouseId,
                v.assigneeId,
                v.isActive,
                actor.id,
                before.id,
                actor.institute_id,
              ],
            )
          ).rows[0]
        : (
            await client.query(
              "INSERT INTO request_auto_assignment_rules(institute_id,request_type,warehouse_id,assignee_user_id,is_active,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *",
              [
                actor.institute_id,
                v.requestType,
                v.warehouseId,
                v.assigneeId,
                v.isActive,
                actor.id,
              ],
            )
          ).rows[0];
      await audit(
        client,
        actor,
        before,
        after,
        before
          ? "AUTO_ASSIGNMENT_RULE_UPDATED"
          : "AUTO_ASSIGNMENT_RULE_CREATED",
      );
      return after;
    });
    if (mode === "delete") res.json({ success: true });
    else
      res
        .status(mode === "upsert" ? 201 : 200)
        .json({ rule: serialize(result) });
  } catch (e) {
    next(e);
  }
};
module.exports = {
  listAutoAssignmentRules,
  upsertAutoAssignmentRule: mutate("upsert"),
  updateAutoAssignmentRule: mutate("update"),
  deleteAutoAssignmentRule: mutate("delete"),
};
