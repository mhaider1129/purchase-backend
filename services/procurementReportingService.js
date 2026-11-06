"use strict";
// Read-only reporting over the Phase 6A/6B authority. No status or quantity writers.
const pool = require("../config/db");
const {
  effectiveRequestStatusSql,
  completedRequestSql,
} = require("./requestFulfillmentSql");
const { activeSecondsSql } = require("./approvalTimingSql");
const { userHasPermission } = require("../utils/permissionService");
const has = (u, p) =>
  typeof u?.hasPermission === "function"
    ? u.hasPermission(p)
    : userHasPermission(u, p);
const fail = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });
const CONTRACT = "canonical_completion_v1";
const CATEGORIES = Object.freeze({
  awaiting_approval: "Awaiting approval",
  awaiting_procurement: "Awaiting procurement",
  procurement_in_progress: "Procurement in progress",
  awaiting_delivery: "Awaiting delivery",
  partially_received: "Partially received",
  awaiting_technical_acceptance: "Awaiting technical acceptance",
  awaiting_fulfillment: "Awaiting department fulfillment",
  partially_fulfilled: "Partially fulfilled",
  fully_fulfilled: "Fully fulfilled",
  cancelled_rejected: "Cancelled or rejected",
  evidence_review: "Requires evidence review",
});
const categorySql = (c = "c.value") => `CASE
 WHEN (${c}->>'terminal')::boolean THEN 'cancelled_rejected'
 WHEN (${c}->>'evidence_gap')::boolean THEN 'evidence_review'
 WHEN (${c}->>'fulfillment_complete')::boolean THEN 'fully_fulfilled'
 WHEN NOT (${c}->>'approved_demand')::boolean THEN 'awaiting_approval'
 WHEN (${c}->>'partially_fulfilled')::boolean THEN 'partially_fulfilled'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(${c}->'items') ci WHERE (ci->>'inspection_pending')::boolean) THEN 'awaiting_technical_acceptance'
 WHEN (${c}->>'partially_received')::boolean THEN 'partially_received'
 WHEN (${c}->>'receipt_complete')::boolean OR (${c}->>'stock_resolved')::boolean THEN 'awaiting_fulfillment'
 WHEN (${c}->>'procurement_complete')::boolean THEN 'awaiting_delivery'
 WHEN (${c}->>'procurement_started')::boolean THEN 'procurement_in_progress'
 ELSE 'awaiting_procurement' END`;
const recordSql = (r = "r", item = "NULL") =>
  `(WITH reporting_value AS MATERIALIZED (SELECT public.canonical_procurement_completion(${r}.id,${r}.institute_id,${item}) value) SELECT c.value || jsonb_build_object('category',${categorySql()},'reporting_basis','${CONTRACT}') FROM reporting_value c)`;
function positive(value, name) {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw fail(400, `${name} must be a positive integer`);
  return Number(value);
}
function date(value, name) {
  if (value == null || value === "") return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw fail(400, `${name} must be a valid YYYY-MM-DD date`);
  return value;
}
function scope(user, query = {}, params = [], alias = "r") {
  if (!user?.id || !user?.institute_id)
    throw fail(403, "An institute account is required for reporting");
  const uid = positive(user.id, "actor"),
    own = positive(user.institute_id, "institute");
  const ids = [own];
  if (has(user, "requests.cross-institute"))
    for (const v of user.data_scopes?.institute_ids || [])
      ids.push(positive(v, "authorized institute"));
  const add = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = [
    `${alias}.institute_id=ANY(${add([...new Set(ids)])}::int[])`,
    `EXISTS(SELECT 1 FROM departments ownership WHERE ownership.id=${alias}.department_id AND ownership.institute_id=${alias}.institute_id)`,
  ];
  const broad = ["requests.view-all", "requests.manage"].some((p) =>
    has(user, p),
  );
  if (!broad) {
    const actor = add(uid),
      department = has(user, "requests.view")
        ? add(user.department_id || null)
        : "NULL::integer",
      warehouse = has(user, "warehouse.view-supply")
        ? add(user.warehouse_id || null)
        : "NULL::integer";
    where.push(`(${alias}.requester_id=${actor} OR ${alias}.assigned_to=${actor}
      OR EXISTS(SELECT 1 FROM approvals ra WHERE ra.request_id=${alias}.id AND ra.approver_id=${actor})
      OR EXISTS(SELECT 1 FROM requested_items rai WHERE rai.request_id=${alias}.id AND rai.assigned_to=${actor})
      ${has(user, "requests.view") ? `OR ${alias}.department_id=${department}` : ""}
      ${has(user, "requests.view-incomplete") ? `OR (NOT COALESCE((public.canonical_procurement_completion(${alias}.id,${alias}.institute_id,NULL)->>'terminal')::boolean,true) AND NOT COALESCE((public.canonical_procurement_completion(${alias}.id,${alias}.institute_id,NULL)->>'fulfillment_complete')::boolean,true))` : ""}
      ${has(user, "procurement-performance.view") ? `OR EXISTS(SELECT 1 FROM procurement_cases rpc WHERE rpc.request_id=${alias}.id AND rpc.institute_id=${alias}.institute_id AND rpc.department_id=${alias}.department_id AND EXISTS(SELECT 1 FROM requested_items rpci WHERE rpci.id=rpc.requested_item_id AND rpci.request_id=${alias}.id))` : ""}
      ${has(user, "warehouse.view-supply") ? `OR (${alias}.request_type='Warehouse Supply' AND ${alias}.supply_warehouse_id=${warehouse} AND EXISTS(SELECT 1 FROM warehouses rw WHERE rw.id=${warehouse} AND rw.institute_id=${alias}.institute_id))` : ""})`);
  }
  for (const key of ["department_id", "section_id", "request_id"])
    if (query[key])
      where.push(
        `${alias}.${key === "request_id" ? "id" : key}=${add(positive(query[key], key))}`,
      );
  if (query.assigned_to && query.assigned_to !== "unassigned") {
    const a = add(positive(query.assigned_to, "assigned_to"));
    where.push(
      `(${alias}.assigned_to=${a} OR EXISTS(SELECT 1 FROM requested_items assigned WHERE assigned.request_id=${alias}.id AND assigned.assigned_to=${a}))`,
    );
  }
  if (query.assigned_to === "unassigned")
    where.push(
      `${alias}.assigned_to IS NULL AND NOT EXISTS(SELECT 1 FROM requested_items ai WHERE ai.request_id=${alias}.id AND ai.assigned_to IS NOT NULL)`,
    );
  if (query.status) {
    const status = String(query.status).trim().toLowerCase();
    if (status === "completed") where.push(completedRequestSql(alias));
    else if (status === "pending")
      where.push(
        `COALESCE(NULLIF(lower(trim(${effectiveRequestStatusSql(alias)})),''),'pending') NOT IN ('completed','received','approved','rejected','available in stock')`,
      );
    else
      where.push(
        `lower(trim(${effectiveRequestStatusSql(alias)}))=${add(status)}`,
      );
  }
  if (query.filter === "unassigned")
    where.push(
      `${alias}.assigned_to IS NULL AND NOT EXISTS(SELECT 1 FROM requested_items uai WHERE uai.request_id=${alias}.id AND uai.assigned_to IS NOT NULL) AND ${effectiveRequestStatusSql(alias)}='Approved'`,
    );
  if (query.maintenance_ref_number)
    where.push(
      `${alias}.maintenance_ref_number ILIKE ${add("%" + String(query.maintenance_ref_number) + "%")}`,
    );
  if (query.request_type) {
    if (
      ["printing logbook", "logbooks"].includes(
        String(query.request_type).toLowerCase(),
      )
    )
      where.push(
        `(${alias}.request_type='Printing Logbook' OR EXISTS(SELECT 1 FROM requested_items logbook WHERE logbook.request_id=${alias}.id AND lower(logbook.item_name) LIKE '%logbook%'))`,
      );
    else where.push(`${alias}.request_type=${add(String(query.request_type))}`);
  }
  if (query.central_supply_status === "sent")
    where.push(`${alias}.sent_to_central_supply_at IS NOT NULL`);
  if (query.central_supply_status === "not_sent")
    where.push(`${alias}.sent_to_central_supply_at IS NULL`);
  if (query.current_step) {
    const step = String(query.current_step).trim(),
      key = step.toLowerCase();
    if (key === "completed") where.push(completedRequestSql(alias));
    else if (
      [
        "rejected",
        "received",
        "technical inspection pending",
        "partially procured",
        "approved",
        "available in stock",
      ].includes(key)
    ) {
      where.push(
        `lower(trim(${effectiveRequestStatusSql(alias)}))=${add(key === "technical inspection pending" ? "technical_inspection_pending" : key)}`,
      );
      if (key === "approved")
        where.push(
          `NOT EXISTS(SELECT 1 FROM approvals ca WHERE ca.request_id=${alias}.id AND ca.is_active AND NOT COALESCE(ca.is_superseded,false))`,
        );
    } else if (key === "submitted")
      where.push(
        `COALESCE(NULLIF(trim(${alias}.status),''),'Submitted')='Submitted'`,
      );
    else
      where.push(
        `EXISTS(SELECT 1 FROM approvals ca JOIN users cu ON cu.id=ca.approver_id WHERE ca.request_id=${alias}.id AND ca.is_active AND NOT COALESCE(ca.is_superseded,false) AND cu.role=${add(step)})`,
      );
  }
  if (query.request_domain) {
    if (!["medical", "operational"].includes(query.request_domain))
      throw fail(400, "Invalid request_domain");
    where.push(`${alias}.request_domain=${add(query.request_domain)}`);
  }
  const from = date(query.from_date || query.date_from, "from_date"),
    to = date(query.to_date || query.date_to, "to_date");
  if (from && to && from > to)
    throw fail(400, "from_date must not exceed to_date");
  if (from)
    where.push(
      `(${alias}.created_at AT TIME ZONE 'UTC')>=${add(from)}::date::timestamp AT TIME ZONE 'UTC'`,
    );
  if (to)
    where.push(
      `(${alias}.created_at AT TIME ZONE 'UTC')<(${add(to)}::date+1)::timestamp AT TIME ZONE 'UTC'`,
    );
  if (query.warehouse_id) {
    const wh = add(positive(query.warehouse_id, "warehouse_id"));
    if (!broad && Number(query.warehouse_id) !== Number(user.warehouse_id))
      throw fail(403, "Warehouse reporting scope denied");
    where.push(`EXISTS(SELECT 1 FROM warehouses reporting_wh WHERE reporting_wh.id=${wh} AND reporting_wh.institute_id=${alias}.institute_id AND
      (${alias}.supply_warehouse_id=reporting_wh.id OR EXISTS(SELECT 1 FROM goods_receipts gr JOIN goods_receipt_items gi ON gi.goods_receipt_id=gr.id JOIN purchase_orders po ON po.id=gr.purchase_order_id AND po.request_id=gr.request_id WHERE gr.request_id=${alias}.id AND gi.warehouse_id=reporting_wh.id)))`);
  }
  if (query.search) {
    const v = add("%" + String(query.search).slice(0, 300) + "%");
    where.push(
      `(${alias}.id::text ILIKE ${v} OR ${alias}.justification ILIKE ${v} OR ${alias}.request_type ILIKE ${v} OR COALESCE(NULLIF(trim(${alias}.temporary_requester_name),''),(SELECT name FROM users ru WHERE ru.id=${alias}.requester_id),(SELECT name FROM users rt WHERE rt.id=${alias}.initiated_by_technician_id)) ILIKE ${v} OR EXISTS(SELECT 1 FROM requested_items search_item WHERE search_item.request_id=${alias}.id AND search_item.item_name ILIKE ${v}))`,
    );
  }
  return {
    sql: where.join(" AND "),
    params,
    from,
    to,
    instituteIds: [...new Set(ids)],
  };
}
function source(user, query = {}, params = []) {
  const s = scope(user, query, params);
  let cte = `WITH reporting_source AS MATERIALIZED (SELECT r.*,${recordSql()} completion FROM public.requests r WHERE ${s.sql}),
    reporting_rows AS MATERIALIZED (SELECT r.*,r.completion->>'category' completion_category,${activeSecondsSql("r.id", "r.created_at", "CURRENT_TIMESTAMP")} active_elapsed_seconds FROM reporting_source r),
    reporting_filtered AS MATERIALIZED (SELECT * FROM reporting_rows WHERE true`;
  if (query.completion_category) {
    if (!Object.hasOwn(CATEGORIES, query.completion_category))
      throw fail(400, "Invalid completion_category");
    params.push(query.completion_category);
    cte += ` AND completion_category=$${params.length}`;
  }
  if (query.incomplete === true || query.incomplete === "true")
    cte += ` AND NOT (completion->>'terminal')::boolean AND NOT (completion->>'fulfillment_complete')::boolean`;
  return { cte: cte + ")", params, scope: s };
}
const eligibilitySql = (c = "completion") =>
  `(${c}->>'approved_demand')::boolean AND NOT (${c}->>'terminal')::boolean AND (${c}->>'eligible_lines')::int>0`;
const eligible = eligibilitySql();
const fields = `r.id,r.request_type,r.request_domain,r.department_id,r.section_id,r.institute_id,r.supply_warehouse_id,r.requester_id,r.assigned_to,r.justification,r.status AS stored_status,r.status,(r.created_at AT TIME ZONE 'UTC') AS created_at,r.is_urgent,r.completion,r.completion_category,r.active_elapsed_seconds,
 (SELECT name FROM departments d WHERE d.id=r.department_id AND d.institute_id=r.institute_id) department_name,
 (SELECT name FROM sections s WHERE s.id=r.section_id AND s.department_id=r.department_id) section_name,
 (SELECT name FROM projects p WHERE p.id=r.project_id) project_name,
 COALESCE(r.temporary_requester_name,(SELECT name FROM users u WHERE u.id=r.requester_id)) requester_name`;
async function ready(db) {
  const row = (
    await db.query(
      "SELECT to_regprocedure('public.canonical_receipt_inventory_quantity(bigint,integer,text,bigint)') IS NOT NULL ready",
    )
  ).rows[0];
  if (!row?.ready)
    throw Object.assign(
      fail(503, "Apply manual SQL 067 and 068 before canonical reporting"),
      { code: "COMPLETION_SCHEMA_REQUIRED" },
    );
}
async function list(
  user,
  query = {},
  db = pool,
  { all = false, legacy = false } = {},
) {
  const { cte, params, scope: reportScope } = source(user, query);
  const page = positive(query.page || 1, "page"),
    limit = Math.min(positive(query.limit || 50, "limit"), 250);
  await ready(db);
  // Count and data come from one statement/snapshot, including empty/out-of-range pages.
  const count = params.length;
  if (!all) params.push(limit, (page - 1) * limit);
  const window = all ? "" : `LIMIT $${count + 1} OFFSET $${count + 2}`;
  const fast =
    !query.completion_category &&
    query.incomplete !== true &&
    query.incomplete !== "true";
  // Ordinary pagination projects only selected rows. Category/incomplete filters
  // must evaluate the full cohort first so counts and page membership stay exact.
  const prefix = fast
    ? `WITH reporting_filtered AS MATERIALIZED (SELECT r.* FROM public.requests r WHERE ${reportScope.sql}),
    page_candidates AS MATERIALIZED (SELECT * FROM reporting_filtered ORDER BY created_at DESC,id DESC ${window}),
    page_data AS MATERIALIZED (SELECT r.*,${recordSql()} completion,${activeSecondsSql("r.id", "r.created_at", "CURRENT_TIMESTAMP")} active_elapsed_seconds FROM page_candidates r),
    page_evidence AS (SELECT r.*,r.completion->>'category' completion_category FROM page_data r)`
    : cte;
  const selected = fast ? "page_evidence" : "reporting_filtered";
  const result = await db.query(
    `${prefix}, page_rows AS (SELECT ${fields}${legacy ? ",r.estimated_cost" : ""} FROM ${selected} r ORDER BY r.created_at DESC,r.id DESC ${fast ? "" : window})
    SELECT (SELECT count(*)::int FROM reporting_filtered) total,COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id DESC) FROM page_rows p),'[]'::jsonb) data`,
    params,
  );

  return {
    ...result.rows[0],
    page,
    limit,
    basis: CONTRACT,
    date_basis: "request_created_at_utc",
    quantity_scope: "whole_request",
    categories: CATEGORIES,
  };
}
async function summary(user, query = {}, db = pool) {
  const { cte, params, scope: s } = source(user, query);
  await ready(db);
  const row = (
    await db.query(
      `${cte} SELECT count(*)::int total_requests,count(*) FILTER(WHERE ${eligible})::int eligible_requests,
    count(*) FILTER(WHERE ${eligible} AND (completion->>'procurement_complete')::boolean)::int procurement_complete_requests,
    count(*) FILTER(WHERE ${eligible} AND (completion->>'receipt_complete')::boolean)::int receipt_complete_requests,
    count(*) FILTER(WHERE ${eligible} AND (completion->>'fulfillment_complete')::boolean)::int fulfilled_requests,
    count(*) FILTER(WHERE ${eligible} AND (completion->>'stock_resolved')::boolean)::int stock_ready_requests,
    count(*) FILTER(WHERE (completion->>'legacy_completion_without_fulfillment')::boolean)::int legacy_unverified_requests,
    count(*) FILTER(WHERE (completion->>'terminal')::boolean)::int excluded_terminal_requests,
    count(*) FILTER(WHERE (completion->>'evidence_gap')::boolean)::int evidence_gap_requests,
    (SELECT COALESCE(jsonb_object_agg(completion_category,n),'{}') FROM (SELECT completion_category,count(*)::int n FROM reporting_filtered GROUP BY completion_category) x) categories,
    (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.month),'[]') FROM (SELECT to_char(created_at,'YYYY-MM') AS month,count(*)::int requests,count(*) FILTER(WHERE ${eligible})::int eligible_requests,count(*) FILTER(WHERE ${eligible} AND (completion->>'fulfillment_complete')::boolean)::int fulfilled_requests FROM reporting_filtered GROUP BY month) x) monthly,
    (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.department_id),'[]') FROM (SELECT department_id,count(*)::int requests,count(*) FILTER(WHERE ${eligible})::int eligible_requests,count(*) FILTER(WHERE ${eligible} AND (completion->>'fulfillment_complete')::boolean)::int fulfilled_requests FROM reporting_filtered GROUP BY department_id) x) departments
    FROM reporting_filtered`,
      params,
    )
  ).rows[0];
  return {
    ...row,
    basis: CONTRACT,
    date_basis: "request_created_at_utc",
    quantity_scope: "whole_request",
    institute_ids: s.instituteIds,
    fulfillment_rate: row.eligible_requests
      ? (100 * row.fulfilled_requests) / row.eligible_requests
      : null,
    timing_basis: "active_time_excluding_approval_holds",
    completion_cycle_time: null,
    completion_cycle_time_reason:
      "No immutable current-fulfillment timestamp is established; updated_at is not an endpoint",
  };
}
// Scope legacy queries without changing their historical calculations. Call only
// with backend-authored SQL. Appended parameter positions leave old binds intact.
function scopedDatabase(db, user, query = {}) {
  return {
    query: async (sql, values = []) => {
      const params = [...values],
        s = scope(user, query, params, "reporting_request");
      const prefix = `requests AS MATERIALIZED (SELECT reporting_request.* FROM public.requests reporting_request WHERE ${s.sql})`;
      const text = /^\s*WITH\s/i.test(sql)
        ? sql.replace(/^\s*WITH\s/i, `WITH ${prefix}, `)
        : `WITH ${prefix} ${sql}`;
      return db.query(text, params);
    },
  };
}
module.exports = {
  CONTRACT,
  CATEGORIES,
  categorySql,
  eligibilitySql,
  recordSql,
  scope,
  source,
  list,
  summary,
  scopedDatabase,
  date,
};
