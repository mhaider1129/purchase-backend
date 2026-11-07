"use strict";
const crypto = require("node:crypto");
const database = require("../config/db");
const auth = require("./p2pAuthorization");
const assignment =
  require("./procurementAssignmentPolicy").createAssignmentPolicy();
const { userHasPermission: has } = require("../utils/permissionService");
const audit = require("./auditService");
const evidence = require("./scopAllocationEvidence");
const { authorizeInventoryMovement } = require("../policies/inventoryPolicy");
const {
  fail,
  SOURCES,
  id,
  text,
  positive,
  scaled,
  decimal,
  capacity,
} = require("../policies/scopFoundationPolicy");
const identity = (item) =>
  Object.fromEntries(
    [
      "generic_item_id",
      "mandatory_product_id",
      "preferred_product_id",
      "request_mode",
      "stocking_policy",
    ].map((k) => [k, item[k] ?? null]),
  );
const same = (a, b) => a != null && b != null && String(a) === String(b);
const ordered = (v) =>
  Array.isArray(v)
    ? v.map(ordered)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, ordered(v[k])]),
        )
      : v;
const fingerprint = (v) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(ordered(v)))
    .digest("hex");
const enabled = () => process.env.SCOP_FOUNDATION_ENABLED === "true";
const requireEnabled = () => {
  if (!enabled())
    throw fail(404, "Operational foundation is disabled", "SCOP_DISABLED");
};
function strict(input, keys) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    throw fail(400, "Unknown or malformed command fields");
}
async function transaction(actor, params, write, work) {
  requireEnabled();
  const client = await database.connect();
  try {
    await client.query(
      write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ",
    );
    const a = await auth.loadActor(
      client,
      actor,
      write
        ? "scop.allocations.manage"
        : ["scop.allocations.view", "scop.allocations.manage"],
    );
    await require("../utils/runtimeSchemaContract").assertModuleContract(
      "services/scopFoundationService.js#schema",
      client,
    );
    const ready = (
      await client.query(
        "SELECT to_regclass('public.scop_allocation_commands') IS NOT NULL AS ready",
      )
    ).rows[0]?.ready;
    if (!ready)
      throw fail(
        503,
        "Apply reviewed manual SQL 072 first",
        "SCOP_SCHEMA_REQUIRED",
      );
    let r, item;
    if (params) {
      r = (
        await client.query(
          "SELECT * FROM requests WHERE id=$1 AND institute_id=$2 FOR UPDATE",
          [id(params.requestId), a.institute_id],
        )
      ).rows[0];
      if (!r) throw fail(404, "Requirement not found", "SCOP_NOT_FOUND");
      const dept = (
        await client.query(
          "SELECT institute_id FROM departments WHERE id=$1 FOR SHARE",
          [r.department_id],
        )
      ).rows[0];
      if (!dept || !same(dept.institute_id, r.institute_id))
        throw fail(404, "Requirement not found", "SCOP_NOT_FOUND");
      const table = {
        requested_item: "requested_items",
        warehouse_supply_item: "warehouse_supply_items",
      }[params.itemKind];
      if (typeof table !== "string")
        throw fail(400, "Use requested_item or warehouse_supply_item");
      item = (
        await client.query(
          `SELECT * FROM ${table} WHERE id=$1 AND request_id=$2 FOR SHARE`,
          [id(params.itemId), r.id],
        )
      ).rows[0];
      if (!item)
        throw fail(404, "Requirement item not found", "SCOP_NOT_FOUND");
      if (
        (r.request_type === "Warehouse Supply") !==
        (params.itemKind === "warehouse_supply_item")
      )
        throw fail(
          409,
          "Use the canonical request item kind",
          "SCOP_ITEM_KIND",
        );
    }
    const result = await work(client, a, r, item);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (["40001", "40P01", "23505", "23514"].includes(e.code))
      throw fail(
        409,
        "Requirement or evidence changed; reload before retrying",
        "SCOP_CONFLICT",
      );
    if (e.statusCode) throw e;
    if (["23503", "22003", "22P02"].includes(e.code))
      throw fail(400, "Invalid canonical reference", "SCOP_REFERENCE_INVALID");
    throw Object.assign(
      fail(
        503,
        "Operational foundation transaction failed",
        "SCOP_TRANSACTION_FAILED",
      ),
      { cause: e },
    );
  } finally {
    client.release();
  }
}
async function approved(client, r, item) {
  await assignment.approved(r, client);
  if (
    String(item.approval_status ?? "")
      .trim()
      .toLowerCase() === "rejected"
  )
    throw fail(
      409,
      "Rejected requirement cannot be allocated",
      "SCOP_ITEM_REJECTED",
    );
}
async function profile(client, r, item, params) {
  const column =
    params.itemKind === "requested_item"
      ? "requested_item_id"
      : "warehouse_supply_item_id";
  const p = (
    await client.query(
      `SELECT * FROM scop_requirement_profiles WHERE ${column}=$1 AND request_id=$2 AND institute_id=$3`,
      [item.id, r.id, r.institute_id],
    )
  ).rows[0];
  if (!p)
    throw fail(
      409,
      "Classify and explicitly enroll this item first",
      "SCOP_PROFILE_REQUIRED",
    );
  if (
    scaled(item.quantity) < scaled(p.approved_quantity) ||
    String(r.approval_route_snapshot_id ?? "") !==
      String(p.approval_snapshot.approval_route_snapshot_id ?? "") ||
    fingerprint(identity(item)) !== fingerprint(p.approval_snapshot.identity)
  )
    throw fail(
      409,
      "Approved quantity changed; allocation reconciliation is required",
      "SCOP_APPROVAL_CHANGED",
    );
  return p;
}
async function source(client, actor, p, input) {
  const kind = input.source_kind;
  if (!SOURCES.includes(kind))
    throw fail(400, "Unsupported fulfillment source");
  const note =
    input.evidence_note == null
      ? null
      : text(input.evidence_note, "evidence_note");
  const policy = (
    await client.query(
      "SELECT * FROM scop_fulfillment_policies WHERE code=$1 AND is_active FOR SHARE",
      [p.policy_code],
    )
  ).rows[0];
  if (!policy) throw fail(409, "Classification policy is inactive");
  if (
    policy.requires_local_override &&
    kind === "LOCAL_PROCUREMENT" &&
    (!has(actor, "scop.allocations.override-policy") || !note)
  )
    throw fail(
      403,
      "Local allocation requires an evidenced policy exception",
      "SCOP_POLICY_EXCEPTION_REQUIRED",
    );
  const ownerId = id(input.responsible_user_id);
  if (
    !(
      await client.query(
        "SELECT id FROM users WHERE id=$1 AND institute_id=$2 FOR SHARE",
        [ownerId, p.institute_id],
      )
    ).rowCount
  )
    throw fail(404, "Responsible user not found", "SCOP_REFERENCE_NOT_FOUND");
  const owner = await auth.loadActor(
    client,
    { id: id(input.responsible_user_id) },
    "scop.allocations.manage",
  );
  if (!same(owner.institute_id, p.institute_id))
    throw fail(404, "Responsible user not found", "SCOP_REFERENCE_NOT_FOUND");
  if (kind === "LOCAL_PROCUREMENT")
    await assignment.assignee(owner.id, p.institute_id, client);
  const warehouse = input.warehouse_id == null ? null : id(input.warehouse_id),
    contract = input.contract_id == null ? null : id(input.contract_id),
    transfer = input.transfer_id == null ? null : id(input.transfer_id),
    transferLine =
      input.transfer_line_id == null ? null : id(input.transfer_line_id);
  if (
    ["WAREHOUSE_STOCK", "TRANSFER"].includes(kind) !== (warehouse != null) ||
    (kind === "CONTRACT") !== (contract != null) ||
    (kind === "TRANSFER") !== (transfer != null) ||
    (kind === "TRANSFER") !== (transferLine != null)
  )
    throw fail(400, "Source references do not match source kind");
  if (warehouse) {
    const w = await assignment.warehouse(warehouse, p.institute_id, client);
    authorizeInventoryMovement(
      actor,
      { permission: "scop.allocations.manage" },
      w,
    );
  }
  if (contract) {
    if (!has(actor, "contracts.manage"))
      throw fail(403, "Permission required: contracts.manage");
    const boundary = require("./contractAuthorizationService");
    const c = (
      await client.query(
        `SELECT c.* FROM contracts c WHERE c.id=$1 AND ${boundary.ownerSql("c")}=$2 AND ${boundary.ownership("c")} FOR SHARE OF c`,
        [contract, p.institute_id],
      )
    ).rows[0];
    if (
      !c ||
      !["active", "expiring_soon", "renewed"].includes(
        String(c.status ?? "").toLowerCase(),
      )
    )
      throw fail(
        404,
        "Active owned contract not found",
        "SCOP_REFERENCE_NOT_FOUND",
      );
    const lines = (
      await client.query(
        "SELECT ci.* FROM contract_items ci WHERE ci.contract_id=$1 AND ci.is_active FOR SHARE",
        [contract],
      )
    ).rows;
    const original = p.requested_item_id
      ? (
          await client.query(
            "SELECT generic_item_id,mandatory_product_id FROM requested_items WHERE id=$1",
            [p.requested_item_id],
          )
        ).rows[0]
      : null;
    if (
      !original?.generic_item_id ||
      !lines.some(
        (l) =>
          same(l.generic_item_id, original.generic_item_id) &&
          (original.mandatory_product_id == null ||
            same(l.approved_product_id, original.mandatory_product_id)),
      )
    )
      throw fail(
        409,
        "Contract item identity must be resolved",
        "SCOP_CONTRACT_IDENTITY_REQUIRED",
      );
  }
  if (transfer) {
    const t = (
      await client.query(
        "SELECT * FROM warehouse_transfer_requests WHERE id=$1 FOR SHARE",
        [transfer],
      )
    ).rows[0];
    if (
      !t ||
      !same(t.destination_warehouse_id, warehouse) ||
      same(t.origin_warehouse_id, t.destination_warehouse_id) ||
      !["Approved", "Dispatched", "In Transit", "Received", "Closed"].includes(
        t.status,
      )
    )
      throw fail(
        404,
        "Authorized transfer not found",
        "SCOP_REFERENCE_NOT_FOUND",
      );
    const origin = (
      await client.query(
        "SELECT * FROM warehouses WHERE id=$1 AND is_active FOR SHARE",
        [t.origin_warehouse_id],
      )
    ).rows[0];
    if (!origin)
      throw fail(404, "Transfer origin not found", "SCOP_REFERENCE_NOT_FOUND");
    if (
      !same(origin.institute_id, p.institute_id) &&
      (!has(actor, "inventory.cross-institute") ||
        !(actor.data_scopes?.institute_ids || [])
          .map(String)
          .includes(String(origin.institute_id)))
    )
      throw fail(
        403,
        "Explicit bounded inter-institute authority required",
        "SCOP_TRANSFER_SCOPE",
      );
    const line = (
      await client.query(
        `SELECT ti.*,s.generic_item_id,s.unit FROM warehouse_transfer_items ti JOIN stock_items s ON s.id=ti.stock_item_id WHERE ti.id=$1 AND ti.transfer_id=$2 FOR SHARE OF ti,s`,
        [transferLine, transfer],
      )
    ).rows[0];
    const original = p.requested_item_id
      ? (
          await client.query(
            "SELECT generic_item_id FROM requested_items WHERE id=$1",
            [p.requested_item_id],
          )
        ).rows[0]
      : null;
    if (
      !line ||
      !original?.generic_item_id ||
      !same(line.generic_item_id, original.generic_item_id) ||
      String(line.unit).trim().toUpperCase() !==
        String(p.uom).trim().toUpperCase()
    )
      throw fail(
        409,
        "Transfer item identity/UOM must match the original requirement",
        "SCOP_TRANSFER_IDENTITY_REQUIRED",
      );
    if (!has(actor, "inventory.transfer"))
      throw fail(403, "Permission required: inventory.transfer");
  }
  return {
    source_kind: kind,
    warehouse_id: warehouse,
    contract_id: contract,
    transfer_id: transfer,
    transfer_line_id: transferLine,
    responsible_user_id: owner.id,
    evidence_note: note,
    reason: text(input.reason, "reason"),
    quantity: positive(input.quantity),
  };
}
async function insertAllocation(client, p, s, actor, parent = null) {
  return (
    await client.query(
      `INSERT INTO scop_fulfillment_allocations(profile_id,parent_allocation_id,source_kind,warehouse_id,contract_id,transfer_id,transfer_line_id,responsible_user_id,quantity,reason,evidence_note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        p.id,
        parent,
        s.source_kind,
        s.warehouse_id,
        s.contract_id,
        s.transfer_id,
        s.transfer_line_id,
        s.responsible_user_id,
        s.quantity,
        s.reason,
        s.evidence_note,
        actor.id,
      ],
    )
  ).rows[0];
}
async function allocations(client, p) {
  return (
    await client.query(
      "SELECT * FROM scop_fulfillment_allocations WHERE profile_id=$1 ORDER BY id FOR UPDATE",
      [p.id],
    )
  ).rows;
}
async function auditChange(
  client,
  actor,
  r,
  key,
  action,
  before,
  after,
  reason,
) {
  await audit.writeAuditEvent({
    client,
    entityType: "request",
    entityId: r.id,
    requestId: r.id,
    instituteId: r.institute_id,
    actorUserId: actor.id,
    action: `request.scop.${action}`,
    operationKey: `scop:${r.institute_id}:${key}`,
    beforeData: before,
    afterData: after,
    reason,
  });
}
const sourceKeys = [
  "source_kind",
  "warehouse_id",
  "contract_id",
  "transfer_id",
  "transfer_line_id",
  "responsible_user_id",
  "quantity",
  "reason",
  "evidence_note",
];
const fields = {
  classify: ["category_id", "purpose_code", "policy_code"],
  create: sourceKeys,
  reassign: sourceKeys.filter((k) => k !== "quantity"),
  split: ["parts", "reason"],
  cancel: ["reason"],
  close: ["reason"],
  evidence: ["kind", "source_id", "reason"],
};
async function command(actor, params, action, input) {
  if (!fields[action]) throw fail(400, "Unsupported allocation command");
  strict(input, [...fields[action], "command_key", "expected_revision"]);
  const key = text(input.command_key, "command_key");
  if (key.length > 120)
    throw fail(400, "command_key is limited to 120 characters");
  const hash = fingerprint({ params, action, input });
  return transaction(actor, params, true, async (client, a, r, item) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,72001))",
      [`${r.institute_id}:${key}`],
    );
    const prior = (
      await client.query(
        "SELECT * FROM scop_allocation_commands WHERE institute_id=$1 AND command_key=$2",
        [r.institute_id, key],
      )
    ).rows[0];
    if (prior) {
      if (
        !same(prior.actor_id, a.id) ||
        prior.fingerprint !== hash ||
        !same(prior.request_id, r.id)
      )
        throw fail(
          409,
          "Command identity was already used for another operation",
          "SCOP_IDEMPOTENCY_CONFLICT",
        );
      return prior.response;
    }
    let result,
      before = null;
    if (action === "classify") {
      await approved(client, r, item);
      if (
        params.itemKind === "warehouse_supply_item" &&
        item.requested_item_id != null
      )
        throw fail(
          409,
          "Enroll the original requested item instead of duplicating diverted demand",
          "SCOP_USE_ORIGINAL_ITEM",
        );
      if (
        params.itemKind === "requested_item" &&
        (!item.unit_of_measure || !item.unit_of_measure.trim())
      )
        throw fail(
          409,
          "Resolve original item UOM before enrollment",
          "SCOP_UOM_UNSUPPORTED",
        );
      if (
        (
          await client.query(
            "SELECT id FROM item_categories WHERE id=$1 AND is_active FOR SHARE",
            [id(input.category_id)],
          )
        ).rowCount !== 1
      )
        throw fail(400, "Active category is required");
      if (
        !(
          await client.query(
            "SELECT code FROM scop_request_purposes WHERE code=$1 AND is_active FOR SHARE",
            [input.purpose_code],
          )
        ).rowCount ||
        !(
          await client.query(
            "SELECT code FROM scop_fulfillment_policies WHERE code=$1 AND is_active FOR SHARE",
            [input.policy_code],
          )
        ).rowCount
      )
        throw fail(400, "Active purpose and fulfillment policy are required");
      const approvalRows = (
        await client.query(
          "SELECT id,status,approver_id FROM approvals WHERE request_id=$1 AND NOT COALESCE(is_superseded,false) ORDER BY id FOR SHARE",
          [r.id],
        )
      ).rows;
      result = (
        await client.query(
          `INSERT INTO scop_requirement_profiles(institute_id,request_id,requested_item_id,warehouse_supply_item_id,category_id,requesting_function_id,purpose_code,policy_code,approved_quantity,uom,approval_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            r.institute_id,
            r.id,
            params.itemKind === "requested_item" ? item.id : null,
            params.itemKind === "warehouse_supply_item" ? item.id : null,
            id(input.category_id),
            r.department_id,
            input.purpose_code,
            input.policy_code,
            positive(item.quantity),
            item.unit_of_measure?.trim() || null,
            JSON.stringify({
              request_status: r.status,
              item_approval_status: item.approval_status,
              identity: identity(item),
              item_approved_by: item.approved_by,
              item_approved_at: item.approved_at,
              approval_route_snapshot: r.approval_route_snapshot,
              approval_route_snapshot_id: r.approval_route_snapshot_id,
              approvals: approvalRows,
            }),
            a.id,
          ],
        )
      ).rows[0];
    } else {
      const p = await profile(client, r, item, params),
        rows = await allocations(client, p);
      if (action === "create") {
        await approved(client, r, item);
        const s = await source(client, a, p, input);
        capacity(p.approved_quantity, [
          ...rows
            .filter((x) => ["ACTIVE", "CLOSED"].includes(x.status))
            .map((x) => x.quantity),
          s.quantity,
        ]);
        result = await insertAllocation(client, p, s, a);
      } else {
        const allocation = rows.find((x) => same(x.id, params.allocationId));
        if (!allocation)
          throw fail(404, "Allocation not found", "SCOP_NOT_FOUND");
        if (
          !Number.isSafeInteger(input.expected_revision) ||
          input.expected_revision < 1
        )
          throw fail(400, "expected_revision must be a positive integer");
        if (input.expected_revision !== allocation.revision)
          throw fail(
            409,
            "Allocation changed; reload before retrying",
            "SCOP_STALE",
          );
        if (allocation.status !== "ACTIVE")
          throw fail(
            409,
            "Allocation is no longer active",
            "SCOP_STATE_BLOCKED",
          );
        before = allocation;
        const bound = (
          await client.query(
            "SELECT id FROM scop_allocation_evidence WHERE allocation_id=$1",
            [allocation.id],
          )
        ).rowCount;
        if (action !== "cancel") await approved(client, r, item);
        if (["split", "reassign", "cancel"].includes(action) && bound)
          throw fail(
            409,
            "Attributed execution evidence requires reconciliation; it cannot be moved or cancelled",
            "SCOP_EXECUTION_EXISTS",
          );
        if (action === "reassign") {
          const s = await source(client, a, p, {
            ...input,
            quantity: allocation.quantity,
          });
          result = (
            await client.query(
              `UPDATE scop_fulfillment_allocations SET source_kind=$2,warehouse_id=$3,contract_id=$4,transfer_id=$5,transfer_line_id=$6,responsible_user_id=$7,reason=$8,evidence_note=$9,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
              [
                allocation.id,
                s.source_kind,
                s.warehouse_id,
                s.contract_id,
                s.transfer_id,
                s.transfer_line_id,
                s.responsible_user_id,
                s.reason,
                s.evidence_note,
              ],
            )
          ).rows[0];
        } else if (action === "split") {
          if (
            !Array.isArray(input.parts) ||
            input.parts.length < 2 ||
            input.parts.length > 20
          )
            throw fail(400, "Provide between 2 and 20 split parts");
          text(input.reason, "reason");
          const parts = [];
          for (const part of input.parts) {
            strict(part, sourceKeys);
            parts.push(await source(client, a, p, part));
          }
          if (
            parts.reduce((n, s) => n + scaled(s.quantity), 0n) !==
            scaled(allocation.quantity)
          )
            throw fail(
              409,
              "Split quantities must exactly conserve the parent allocation",
              "SCOP_SPLIT_QUANTITY",
            );
          await client.query(
            "UPDATE scop_fulfillment_allocations SET status='SPLIT',revision=revision+1,reason=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1",
            [allocation.id, input.reason],
          );
          result = { parent_id: allocation.id, allocations: [] };
          for (const s of parts)
            result.allocations.push(
              await insertAllocation(client, p, s, a, allocation.id),
            );
        } else if (action === "evidence") {
          text(input.reason, "reason");
          await evidence.bind(
            client,
            p,
            allocation,
            input.kind,
            input.source_id,
            a,
          );
          const q = await evidence.project(client, p, allocation);
          if (q.evidence_conflict)
            throw fail(
              409,
              "Evidence exceeds allocation or conflicts with canonical records",
              "SCOP_EVIDENCE_CONFLICT",
            );
          result = (
            await client.query(
              "UPDATE scop_fulfillment_allocations SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *",
              [allocation.id],
            )
          ).rows[0];
          result.progress = q;
        } else {
          text(input.reason, "reason");
          if (action === "close") {
            const q = await evidence.project(client, p, allocation);
            if (
              q.evidence_conflict ||
              scaled(q.outstanding_quantity) !== 0n ||
              scaled(q.pending_inspection_quantity) !== 0n
            )
              throw fail(
                409,
                "Closure requires full canonical fulfillment evidence and no pending inspection",
                "SCOP_CLOSURE_BLOCKED",
              );
          }
          result = (
            await client.query(
              "UPDATE scop_fulfillment_allocations SET status=$2,revision=revision+1,reason=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *",
              [
                allocation.id,
                action === "close" ? "CLOSED" : "CANCELLED",
                input.reason,
              ],
            )
          ).rows[0];
        }
      }
    }
    await auditChange(
      client,
      a,
      r,
      key,
      action,
      before,
      result,
      input.reason ?? "Explicit operational classification",
    );
    await client.query(
      "INSERT INTO scop_allocation_commands(institute_id,command_key,actor_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4,$5,$6)",
      [r.institute_id, key, a.id, r.id, hash, JSON.stringify(result)],
    );
    // JSON round trip ensures identical scalar representation on first execution and replay.
    return JSON.parse(JSON.stringify(result));
  });
}
async function get(actor, params) {
  return transaction(actor, params, false, async (client, a, r, item) => {
    const column =
      params.itemKind === "requested_item"
        ? "requested_item_id"
        : "warehouse_supply_item_id";
    const p = (
      await client.query(
        `SELECT * FROM scop_requirement_profiles WHERE ${column}=$1 AND request_id=$2 AND institute_id=$3`,
        [item.id, r.id, r.institute_id],
      )
    ).rows[0];
    if (!p)
      return {
        enrolled: false,
        request_id: r.id,
        item_id: item.id,
        approval_state: r.status,
      };
    const rows = await allocations(client, p),
      out = [];
    for (const row of rows) {
      const q = await evidence.project(client, p, row);
      out.push({
        ...row,
        counts_toward_requirement: ["ACTIVE", "CLOSED"].includes(row.status),
        progress: q,
        closure_evidence_valid:
          row.status === "CLOSED"
            ? !q.evidence_conflict &&
              scaled(q.outstanding_quantity) === 0n &&
              scaled(q.pending_inspection_quantity) === 0n
            : null,
        evidence: (
          await client.query(
            "SELECT * FROM scop_allocation_evidence WHERE allocation_id=$1 ORDER BY id",
            [row.id],
          )
        ).rows,
      });
    }
    const used = rows
      .filter((x) => ["ACTIVE", "CLOSED"].includes(x.status))
      .reduce((n, x) => n + scaled(x.quantity), 0n);
    const totals = {};
    for (const field of [
      "allocated",
      "ordered",
      "received",
      "accepted",
      "rejected",
      "short",
      "pending_inspection",
      "quarantined",
      "issued",
      "fulfilled",
    ])
      totals[field + "_quantity"] = decimal(
        out
          .filter((x) => x.counts_toward_requirement)
          .reduce((n, x) => n + scaled(x.progress[field + "_quantity"]), 0n),
      );
    const remaining = scaled(item.quantity) - scaled(totals.fulfilled_quantity);
    totals.outstanding_quantity = decimal(remaining < 0n ? 0n : remaining);
    totals.evidence_conflict =
      remaining < 0n ||
      out.some(
        (x) => x.counts_toward_requirement && x.progress.evidence_conflict,
      );
    const pending =
      (
        await client.query(
          "SELECT id FROM approvals WHERE request_id=$1 AND NOT COALESCE(is_superseded,false) AND LOWER(TRIM(COALESCE(status,'Pending'))) NOT IN ('approved','skipped','superseded') LIMIT 1",
          [r.id],
        )
      ).rowCount > 0;
    const canViewFinance = has(a, "procure-to-pay.lifecycle.view");
    const finance = canViewFinance
      ? (
          await client.query(
            `SELECT ap.currency,SUM(ap.invoice_total) AS payable_total,SUM(ap.open_balance) AS open_balance FROM ap_payables ap WHERE ap.request_id=$1 AND ap.payable_status IN ('OPEN','PARTIALLY_PAID','PAID') AND ${require("./p2pReadScope").predicate("payable", "ap", "$2")} GROUP BY ap.currency ORDER BY ap.currency`,
            [r.id, r.institute_id],
          )
        ).rows
      : [];
    const canonical = (
      await client.query(
        "SELECT canonical_procurement_completion($1,$2,$3) AS value",
        [r.id, r.institute_id, p.requested_item_id],
      )
    ).rows[0].value;
    return {
      enrolled: true,
      progress_scope: "ATTRIBUTED_LINES_ONLY",
      canonical_completion: canonical,
      profile: p,
      totals,
      approval_state: pending ? "PENDING" : r.status,
      stored_request_state: r.status,
      item_approval_state: item.approval_status,
      approval_changed:
        scaled(item.quantity) !== scaled(p.approved_quantity) ||
        String(r.approval_route_snapshot_id ?? "") !==
          String(p.approval_snapshot.approval_route_snapshot_id ?? "") ||
        fingerprint(identity(item)) !==
          fingerprint(p.approval_snapshot.identity),
      unallocated_quantity: decimal(
        scaled(p.approved_quantity) > used
          ? scaled(p.approved_quantity) - used
          : 0n,
      ),
      allocations: out,
      financial_settlement: {
        scope: "REQUEST",
        authority: "LOCAL_CANONICAL",
        state: !canViewFinance
          ? "RESTRICTED"
          : finance.length
            ? finance.every((x) => scaled(x.open_balance) === 0n)
              ? "SETTLED"
              : "OPEN"
            : "NOT_POSTED",
        currencies: finance,
      },
      completion_policy:
        "Operational allocations never change request completion; canonical completion remains authoritative",
    };
  });
}
async function classifications(actor) {
  return transaction(actor, null, false, async (client) => ({
    categories: (
      await client.query(
        "SELECT id,category_name FROM item_categories WHERE is_active ORDER BY id",
      )
    ).rows,
    purposes: (
      await client.query(
        "SELECT * FROM scop_request_purposes WHERE is_active ORDER BY code",
      )
    ).rows,
    fulfillment_policies: (
      await client.query(
        "SELECT * FROM scop_fulfillment_policies WHERE is_active ORDER BY code",
      )
    ).rows,
    sources: SOURCES,
  }));
}
module.exports = { command, get, classifications, enabled, requireEnabled };
