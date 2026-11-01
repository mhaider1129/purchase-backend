"use strict";
const pool = require("../config/db");
const { effectiveRequestStatusSql } = require("./requestFulfillmentSql");
const {
  getPermissionsForUserId,
  userHasPermission,
  getDefaultPermissionsForRole,
} = require("../utils/permissionService");
const error = (statusCode, message, code = "ASSIGNMENT_DENIED") =>
  Object.assign(new Error(message), { statusCode, code });
const missing = () => error(404, "Assignment record or reference not found");
const id = (value) => {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 2147483647
  )
    throw error(400, "A positive record ID is required");
  return Number(value);
};
const has = (actor, permission) => userHasPermission(actor, permission);
// Preserve the established procurement-staff eligibility from the canonical role
// catalog, in addition to current grants. A random user granted one capability is
// not thereby eligible for every procurement assignment.
const eligibleRole = (role) =>
  getDefaultPermissionsForRole(role).includes("procurement.update-status");
function createAssignmentPolicy(
  database = pool,
  lookup = getPermissionsForUserId,
) {
  async function actor(input, db = database, manage = true) {
    if (!input?.id) throw error(401, "Authentication required");
    const user = (
      await db.query(
        "SELECT id,name,email,role,institute_id,department_id,is_active FROM users WHERE id=$1 FOR SHARE",
        [id(input?.id)],
      )
    ).rows[0];
    if (!user?.is_active || user.institute_id == null)
      throw error(403, "An active institute account is required");
    id(user.institute_id);
    const grants = await lookup(user.id, db);
    if (
      !Array.isArray(grants?.permissions) ||
      grants.found === false ||
      (grants.dataScopes != null &&
        (typeof grants.dataScopes !== "object" ||
          Array.isArray(grants.dataScopes)))
    )
      throw error(503, "Assignment authorization unavailable");
    const current = {
      ...user,
      permissions: grants.permissions,
      data_scopes: grants.dataScopes || {},
    };
    if (manage && !has(current, "requests.manage"))
      throw error(403, "Permission required: requests.manage");
    return current;
  }
  function institute(actor, instituteId, cross = true) {
    if (instituteId == null) throw missing();
    id(instituteId);
    if (Number(actor.institute_id) === Number(instituteId)) return;
    if (
      !cross ||
      !has(actor, "requests.cross-institute") ||
      !Array.isArray(actor.data_scopes?.institute_ids) ||
      !actor.data_scopes.institute_ids.some(
        (value) => String(value) === String(instituteId),
      )
    )
      throw missing();
  }
  async function request(actor, requestId, db = database) {
    const row = (
      await db.query(
        `SELECT r.*,${effectiveRequestStatusSql("r")} AS assignment_effective_status FROM requests r WHERE r.id=$1 FOR UPDATE OF r`,
        [id(requestId)],
      )
    ).rows[0];
    if (!row) throw missing();
    institute(actor, row.institute_id);
    const department = (
      await db.query(
        "SELECT id,institute_id FROM departments WHERE id=$1 FOR SHARE",
        [row.department_id],
      )
    ).rows[0];
    if (
      !department ||
      Number(department.institute_id) !== Number(row.institute_id)
    )
      throw missing();
    if (row.supply_warehouse_id != null)
      await warehouse(row.supply_warehouse_id, row.institute_id, db);
    return row;
  }
  async function warehouse(value, instituteId, db = database) {
    const row = (
      await db.query(
        "SELECT w.*,d.institute_id AS department_institute_id FROM warehouses w LEFT JOIN departments d ON d.id=w.department_id WHERE w.id=$1 FOR SHARE OF w",
        [id(value)],
      )
    ).rows[0];
    if (
      !row ||
      row.is_active !== true ||
      Number(row.institute_id) !== Number(instituteId) ||
      row.institute_id == null ||
      (row.department_id != null &&
        Number(row.department_institute_id) !== Number(instituteId))
    )
      throw missing();
    return row;
  }
  async function assignee(value, instituteId, db = database) {
    const user = (
      await db.query(
        "SELECT id,name,email,role,institute_id,department_id,is_active FROM users WHERE id=$1 FOR SHARE",
        [id(value)],
      )
    ).rows[0];
    if (
      !user ||
      !user.is_active ||
      user.institute_id == null ||
      Number(user.institute_id) !== Number(instituteId)
    )
      throw missing();
    if (user.department_id != null) {
      const department = (await db.query(
        'SELECT id,institute_id FROM departments WHERE id=$1 FOR SHARE',
        [user.department_id],
      )).rows[0];
      if (!department || Number(department.institute_id) !== Number(instituteId))
        throw missing();
    }
    const grants = await lookup(user.id, db);
    if (!Array.isArray(grants?.permissions) || grants.found === false)
      throw error(503, "Assignment eligibility unavailable");
    if (
      !eligibleRole(user.role) ||
      !has({ permissions: grants.permissions }, "procurement.update-status")
    )
      throw error(400, "Assignee is not currently eligible procurement staff");
    return user;
  }
  async function approved(request, db = database) {
    if (
      String(request.assignment_effective_status || request.status || "")
        .trim()
        .toLowerCase() !== "approved"
    )
      throw error(
        409,
        "Request must be fully approved and active before assignment",
        "ASSIGNMENT_STATE_BLOCKED",
      );
    const pending = await db.query(
      "SELECT id FROM approvals WHERE request_id=$1 AND NOT COALESCE(is_superseded,false) AND LOWER(TRIM(COALESCE(status,'Pending'))) NOT IN ('approved','skipped','superseded') LIMIT 1 FOR SHARE",
      [request.id],
    );
    if (pending.rows.length)
      throw error(
        409,
        "Request still has an unresolved approval",
        "ASSIGNMENT_APPROVAL_PENDING",
      );
  }
  async function automaticAuthority(actor, request, db = database) {
    if (has(actor, "requests.manage")) return;
    const proof = await db.query(
      "SELECT id FROM approvals WHERE request_id=$1 AND approver_id=$2 AND status='Approved' AND NOT COALESCE(is_superseded,false) LIMIT 1 FOR SHARE",
      [request.id, actor.id],
    );
    if (!proof.rows.length)
      throw error(
        403,
        "Automatic assignment requires an authorized approval continuation",
      );
  }
  return {
    actor,
    institute,
    request,
    warehouse,
    assignee,
    approved,
    automaticAuthority,
  };
}
module.exports = {
  createAssignmentPolicy,
  eligibleRole,
  id,
  has,
  error,
  missing,
};
