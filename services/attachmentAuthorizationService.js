"use strict";
const pool = require("../config/db");
const { getPermissionsForUserId } = require("../utils/permissionService");
const reviewerScope = require("./technicalReviewerScope");
const denied = () =>
  Object.assign(new Error("File or parent record not found"), {
    statusCode: 404,
    code: "ATTACHMENT_NOT_FOUND",
  });
const positive = (v) =>
  /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
const has = (a, p) => a.permissions.includes(p);

function createAttachmentAuthorization(
  database = pool,
  lookupPermissions = getPermissionsForUserId,
) {
  async function actor(input, db = database) {
    if (!positive(input?.id))
      throw Object.assign(new Error("Authentication required"), {
        statusCode: 401,
      });
    const user = (
      await db.query(
        `SELECT id,role,department_id,institute_id,is_active FROM users WHERE id=$1${db !== database ? " FOR SHARE" : ""}`,
        [input.id],
      )
    ).rows[0];
    if (!user?.is_active || !positive(user.institute_id)) throw denied();
    const authority = await lookupPermissions(user.id);
    if (!Array.isArray(authority?.permissions) || authority.found === false)
      throw Object.assign(new Error("Authorization unavailable"), {
        statusCode: 503,
      });
    return {
      ...user,
      permissions: authority.permissions,
      data_scopes: authority.dataScopes || {},
    };
  }
  function institute(a, id) {
    if (!positive(id)) throw denied();
    if (String(a.institute_id) === String(id)) return;
    // Both the explicit override capability AND its bounded scope are required.
    if (
      !has(a, "requests.cross-institute") ||
      !(a.data_scopes.institute_ids || []).some((x) => String(x) === String(id))
    )
      throw denied();
  }
  async function optional(db, table, sql, args) {
    const exists = (
      await db.query("SELECT to_regclass($1) IS NOT NULL AS available", [
        "public." + table,
      ])
    ).rows[0]?.available;
    return exists ? (await db.query(sql, args)).rows : [];
  }
  async function request(a, id, action = "read", db = database, itemId = null) {
    if (!positive(id)) throw denied();
    const r = (await db.query("SELECT * FROM requests WHERE id=$1", [id]))
      .rows[0];
    if (!r) throw denied();
    institute(a, r.institute_id);
    const approvals = (
      await db.query(
        `SELECT id FROM approvals WHERE request_id=$1 AND approver_id=$2 AND NOT COALESCE(is_superseded,false) AND ${action === "read" ? "status NOT IN ('Skipped','Superseded')" : "(is_active IS TRUE OR status IN ('Approved','Rejected'))"}`,
        [id, a.id],
      )
    ).rows;
    const assigned = (
      await db.query(
        "SELECT id FROM requested_items WHERE request_id=$1 AND assigned_to=$2",
        [id, a.id],
      )
    ).rows;
    const owner =
      String(r.requester_id) === String(a.id) ||
      String(r.initiated_by_technician_id) === String(a.id);
    const buyer =
      (String(r.assigned_to) === String(a.id) || assigned.length > 0) &&
      has(a, "procurement.update-status");
    const manager = has(
      a,
      action === "read" ? "requests.view-all" : "requests.manage",
    );
    let technical = false;
    // Current assignments are delegated parent action capabilities, not bucket access.
    const pre = await optional(
      db,
      "preprocurement_technical_review_assignments",
      `SELECT own.id FROM preprocurement_technical_review_assignments own JOIN preprocurement_technical_reviews t ON t.id=own.review_id JOIN users u ON u.id=own.reviewer_id WHERE t.request_id=$1 AND t.institute_id=$3 AND own.reviewer_id=$2 AND ${reviewerScope("u", "own.department_id", "$3")}`,
      [id, a.id, r.institute_id],
    );
    const delivery = await optional(
      db,
      "delivery_inspection_assignments",
      `SELECT own.id FROM delivery_inspection_assignments own JOIN delivery_inspection_tasks t ON t.id=own.task_id JOIN users u ON u.id=own.reviewer_id WHERE t.request_id=$1 AND t.institute_id=$3 AND own.reviewer_id=$2 AND ${reviewerScope("u", "own.department_id", "$3")}`,
      [id, a.id, r.institute_id],
    );
    const demos = await optional(
      db,
      "device_demo_reviewers",
      "SELECT own.id FROM device_demo_reviewers own JOIN device_demo_workspaces w ON w.id=own.workspace_id JOIN users u ON u.id=own.reviewer_id WHERE w.request_id=$1 AND own.reviewer_id=$2 AND u.department_id=own.department_id AND w.institute_id=$3",
      [id, a.id, r.institute_id],
    );
    const receiving = has(a, "procure-to-pay.receipts.manage")
      ? await optional(
          db,
          "delivery_inspection_tasks",
          "SELECT id FROM delivery_inspection_tasks WHERE request_id=$1 AND institute_id=$2 LIMIT 1",
          [id, r.institute_id],
        )
      : [];
    const demoAuthority = await optional(
      db,
      "device_demo_workspaces",
      "SELECT id FROM device_demo_workspaces WHERE request_id=$1 AND institute_id=$2 AND (created_by=$3 OR $4::boolean) LIMIT 1",
      [id, r.institute_id, a.id, require("./deviceDemoModel").isCoo(a)],
    );
    technical =
      pre.length +
        delivery.length +
        demos.length +
        receiving.length +
        demoAuthority.length >
      0;
    const technicalManager =
      has(a, "technical-inspections.manage") &&
      ["scm", "admin", "procurementsupervisor"].includes(
        String(a.role).toLowerCase().replace(/\s/g, ""),
      );
    if (!(
      owner ||
      approvals.length ||
      buyer ||
      manager ||
      technical ||
      technicalManager
    ))
      throw denied();
    // A split buyer cannot read another buyer's item evidence by changing itemId.
    if (
      itemId &&
      buyer &&
      !owner &&
      !manager &&
      !approvals.length &&
      !technical &&
      String(r.assigned_to) !== String(a.id) &&
      !assigned.some((i) => String(i.id) === String(itemId))
    )
      throw denied();
    if (action === "delete" && !owner && !has(a, "requests.manage"))
      throw denied();
    return {
      ...r,
      evidenceOnly:
        technical &&
        !owner &&
        !buyer &&
        !manager &&
        !approvals.length &&
        !technicalManager,
    };
  }
  async function contract(a, id, action = "read", db = database) {
    if (!positive(id)) throw denied();
    const c = (
      await db.query(
        `SELECT c.*,to_jsonb(c)->>'institute_id' AS explicit_institute_id,r.institute_id AS request_institute_id,d.institute_id AS department_institute_id,u.institute_id AS creator_institute_id FROM contracts c LEFT JOIN requests r ON r.id=c.source_request_id LEFT JOIN departments d ON d.id=c.end_user_department_id LEFT JOIN users u ON u.id=c.created_by WHERE c.id=$1`,
        [id],
      )
    ).rows[0];
    if (!c) throw denied();
    // Use actual business provenance. Conflicting/unknown legacy ownership fails closed.
    const scopes = [
      c.explicit_institute_id,
      c.request_institute_id,
      c.department_institute_id,
    ].filter((x) => x != null);
    // Creator identity is a legacy fallback, not an override of explicit business
    // ownership (a properly authorized cross-institute actor may create a file).
    if (!scopes.length && c.creator_institute_id != null)
      scopes.push(c.creator_institute_id);
    if (!scopes.length || new Set(scopes.map(String)).size !== 1)
      throw denied();
    institute(a, scopes[0]);
    const manager = has(a, "contracts.manage");
    const reviews = await optional(
      db,
      "contract_approvals",
      "SELECT * FROM contract_approvals WHERE contract_id=$1 AND (is_active OR status IN ('Approved','Rejected'))",
      [id],
    );
    const reviewer = reviews.some(
      (step) =>
        (!step.reviewer_department_id ||
          String(step.reviewer_department_id) === String(a.department_id)) &&
        require("../policies/contractApprovalPolicy").canUserDecideContractStep(
          a,
          step,
        ),
    );
    const related = [c.created_by, c.contract_manager_id].some(
      (x) => String(x) === String(a.id),
    );
    if (action === "delete" ? !manager : !(manager || related || reviewer))
      throw denied();
    return c;
  }
  // Plan aliases and file routes share the planning object/capability policy;
  // ordinary request permissions must not become an alternate plan-file grant.
  async function department(a, id, db = database) {
    const planning = require('./planningAuthorizationService').createPlanningAuthorization(database, lookupPermissions);
    try { return await planning.department(await planning.actor(a,'manage',db),id,db); }
    catch (e) { if ([401,403,404].includes(e.statusCode)) throw denied(); throw e; }
  }
  async function plan(a, id, action = 'read', db = database) {
    const planning = require('./planningAuthorizationService').createPlanningAuthorization(database, lookupPermissions);
    try { return await planning.plan(await planning.actor(a,action==='read'?'read':'manage',db),id,action==='read'?'read':'manage',db); }
    catch (e) { if ([401,403,404].includes(e.statusCode)) throw denied(); throw e; }
  }
  async function parent(a, spec, action = "read", db = database) {
    if (spec.surgicalCaseId) {
      const cases =
        require("./surgicalConsignmentService").createSurgicalConsignmentService(
          db,
        );
      const c = await cases.get(a, spec.surgicalCaseId);
      if (!c.clinical_access) throw denied();
      return c;
    }
    if (spec.departmentId) return department(a, spec.departmentId, db);
    if (spec.contractId) return contract(a, spec.contractId, action, db);
    if (spec.planId) return plan(a, spec.planId, action, db);
    if (spec.itemId) {
      if (!positive(spec.itemId)) throw denied();
      const i = (
        await db.query(
          "SELECT id,request_id FROM requested_items WHERE id=$1",
          [spec.itemId],
        )
      ).rows[0];
      if (
        !i ||
        (spec.requestId && String(spec.requestId) !== String(i.request_id))
      )
        throw denied();
      return request(a, i.request_id, action, db, i.id);
    }
    return request(a, spec.requestId, action, db);
  }
  async function attachment(a, id, action = "read", db = database) {
    if (!positive(id)) throw denied();
    const f = (await db.query("SELECT * FROM attachments WHERE id=$1", [id]))
      .rows[0];
    if (!f) throw denied();
    // Every non-null parent must authorize: malformed mixed-parent rows cannot broaden access.
    if (!f.request_id && !f.contract_id && !f.item_id) throw denied();
    if (f.request_id || f.item_id) {
      const r = await parent(
        a,
        { requestId: f.request_id, itemId: f.item_id },
        action,
        db,
      );
      if (
        r.evidenceOnly &&
        action === "read" &&
        String(f.uploaded_by) !== String(a.id)
      ) {
        const pre = await optional(
          db,
          "preprocurement_technical_review_assignments",
          `SELECT t.id FROM preprocurement_technical_reviews t JOIN preprocurement_technical_review_assignments own ON own.review_id=t.id JOIN users u ON u.id=own.reviewer_id WHERE t.request_id=$1 AND own.reviewer_id=$2 AND ${reviewerScope("u", "own.department_id", "$4")} AND jsonb_path_exists(t.item_packets,'$[*].evidence.attachment_ids[*] ? (@ == $id || @ == $text)',jsonb_build_object('id',$3::integer,'text',$3::text))`,
          [r.id, a.id, f.id, r.institute_id],
        );
        const deliveries = await optional(
          db,
          "technical_evidence_references",
          `SELECT e.id FROM technical_evidence_references e JOIN delivery_inspection_tasks t ON t.id=e.delivery_task_id LEFT JOIN delivery_inspection_assignments own ON own.task_id=t.id AND own.reviewer_id=$2 LEFT JOIN users u ON u.id=own.reviewer_id WHERE e.attachment_id=$1 AND t.institute_id=$3 AND ($4::boolean OR (own.reviewer_id=$2 AND ${reviewerScope("u", "own.department_id", "$3")}))`,
          [
            f.id,
            a.id,
            r.institute_id,
            has(a, "procure-to-pay.receipts.manage"),
          ],
        );
        const demos = await optional(
          db,
          "device_demo_events",
          `SELECT e.id FROM device_demo_events e JOIN device_demo_workspaces w ON w.id=e.workspace_id LEFT JOIN device_demo_reviewers own ON own.workspace_id=w.id AND own.reviewer_id=$2 LEFT JOIN users u ON u.id=own.reviewer_id WHERE w.institute_id=$3 AND ((own.reviewer_id=$2 AND u.department_id=own.department_id) OR w.created_by=$2 OR $4::boolean) AND (e.attachment_ids @> jsonb_build_array($1::integer) OR e.attachment_ids @> jsonb_build_array($1::text))`,
          [f.id, a.id, r.institute_id, require("./deviceDemoModel").isCoo(a)],
        );
        if (!pre.length && !deliveries.length && !demos.length) throw denied();
      }
    }
    if (f.contract_id) await contract(a, f.contract_id, action, db);
    if (
      action === "delete" &&
      String(f.uploaded_by) !== String(a.id) &&
      !has(a, f.contract_id ? "contracts.manage" : "requests.manage")
    )
      throw denied();
    return f;
  }
  return { actor, parent, attachment, request, contract, plan, optional };
}
module.exports = { createAttachmentAuthorization, denied, positive };
