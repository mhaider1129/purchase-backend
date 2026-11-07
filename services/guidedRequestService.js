"use strict";
const httpError = require("../utils/httpError");
const {
  getPermissionsForUserId,
  userHasPermission,
} = require("../utils/permissionService");
const { fetchApprovalRoutes } = require("../controllers/utils/approvalRoutes");
const {
  getAttachmentMaxFiles,
  getAttachmentMaxSizeBytes,
} = require("../config/uploadLimits");

// These are entry guides, not new request types or approval policies.
const FAMILIES = [
  ["general", "Non-Stock", []],
  ["warehouse", "Stock", []],
  ["medication", "Medication", ["dosage"]],
  ["medical_supplies", "Non-Stock", []],
  ["specialty", "Non-Stock", ["specialty", "procedure"]],
  ["it", "IT Item", ["location", "equipment_model"]],
  ["maintenance", "Non-Stock", ["location", "work_order_reference"]],
  ["recurring", "Non-Stock", ["period", "frequency"]],
  ["laboratory", "Non-Stock", ["analyzer_model", "period"]],
  ["spare_parts", "Non-Stock", ["equipment_model", "part_number"]],
  ["device", "Medical Device", ["intended_use", "location"]],
  ["procedure", "Non-Stock", ["procedure", "procedure_date"]],
  ["safety", "Non-Stock", ["function"]],
  [
    "nuclear",
    "Non-Stock",
    [
      "isotope",
      "activity",
      "activity_unit",
      "calibration_at",
      "authorization_reference",
    ],
  ],
].map(([id, request_type, fields]) => ({ id, request_type, fields }));
const fail = (status, message) => {
  throw httpError(status, message);
};
const text = (value, field, max = 2000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, `Invalid ${field}`);
  return value.trim();
};
function enabled() {
  if (process.env.GUIDED_REQUESTS_ENABLED !== "true")
    fail(404, "Guided request submission is not enabled");
}
async function actor(runner, userId, lock = false) {
  const { rows } = await runner.query(
    `SELECT u.id,u.name,u.role,u.institute_id,u.department_id,u.section_id,
    u.warehouse_id,u.can_request_medication,d.name AS department_name,d.type AS department_type,
    i.name AS institute_name FROM users u JOIN departments d ON d.id=u.department_id
    JOIN institutes i ON i.id=u.institute_id
    WHERE u.id=$1 AND u.is_active=TRUE AND d.institute_id=u.institute_id
    ${lock ? "FOR SHARE OF u,d" : ""}`,
    [userId],
  );
  if (!rows.length)
    fail(
      403,
      "An active requester with an institute and department is required",
    );
  const user = rows[0];
  const grants = await getPermissionsForUserId(userId, runner);
  user.permissions = grants.permissions;
  user.hasPermission = (code) => userHasPermission(user, code);
  return user;
}
function allowed(family, user) {
  // Match the canonical writer's existing restrictions. General submission is
  // authenticated-user based; do not invent or grant a new role permission.
  if (family.request_type === "Medication")
    return (
      user.role?.toLowerCase() === "requester" &&
      user.can_request_medication === true
    );
  if (family.request_type === "Stock") return Number(user.warehouse_id) > 0;
  return true;
}
async function references(runner) {
  const [categories, purposes] = await Promise.all([
    runner.query(
      "SELECT id,category_name AS name FROM item_categories WHERE is_active=TRUE ORDER BY category_name",
    ),
    runner.query(
      "SELECT code,label FROM scop_request_purposes WHERE is_active=TRUE ORDER BY code",
    ),
  ]);
  return { categories: categories.rows, purposes: purposes.rows };
}
async function options(runner, userId) {
  enabled();
  const user = await actor(runner, userId);
  return {
    requester: {
      id: user.id,
      name: user.name,
      institute_id: user.institute_id,
      institute_name: user.institute_name,
      department_id: user.department_id,
      department_name: user.department_name,
    },
    families: FAMILIES.map((family) => ({
      ...family,
      enabled: allowed(family, user),
    })),
    ...(await references(runner)),
    attachments: {
      max_files: getAttachmentMaxFiles(),
      max_bytes: getAttachmentMaxSizeBytes(),
    },
    sap_inventory: { available: false, reason: "NO_VERIFIED_SYNCHRONIZATION" },
  };
}
async function catalog(runner, userId, query = "") {
  enabled();
  const user = await actor(runner, userId);
  if (typeof query !== "string" || query.length > 160)
    fail(400, "Invalid item search");
  const { rows } = await runner.query(
    `SELECT id,item_code,generic_name,canonical_description,inventory_uom,category,interchangeability_policy
    FROM generic_items WHERE is_active=TRUE AND lifecycle_status='active'
    AND (institute_id IS NULL OR institute_id=$1)
    AND (generic_name ILIKE $2 OR item_code ILIKE $2 OR canonical_description ILIKE $2)
    ORDER BY item_code,id LIMIT 10`,
    [user.institute_id, `%${query}%`],
  );
  return { data: rows };
}
function date(value, field, today) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value || "") ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value ||
    value < today
  )
    fail(400, `Invalid ${field}: use today or a future date`);
  return value;
}
async function prepare(
  runner,
  userId,
  payload,
  { lock = false, now = new Date() } = {},
) {
  enabled();
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    fail(400, "Invalid guided request");
  const topKeys = [
    "family",
    "category_id",
    "purpose",
    "required_by",
    "justification",
    "operational_impact",
    "specialized",
    "items",
    "client_submission_key",
  ];
  if (Object.keys(payload).some((key) => !topKeys.includes(key)))
    fail(
      400,
      "Unexpected field: requester, institute and department are server-derived; patient identifiers are not accepted",
    );
  const user = await actor(runner, userId, lock);
  const family = FAMILIES.find((row) => row.id === payload.family);
  if (!family) fail(400, "Select a request family");
  if (!allowed(family, user))
    fail(403, "You are not authorized for this request family");
  if (family.request_type === "Stock") {
    const warehouse = await runner.query(
      `SELECT id FROM warehouses WHERE id=$1 AND institute_id=$2 AND is_active=TRUE ${lock ? "FOR SHARE" : ""}`,
      [user.warehouse_id, user.institute_id],
    );
    if (!warehouse.rows.length)
      fail(403, "Assigned warehouse is outside your institute");
  }
  const refs = await references(runner);
  const category = refs.categories.find(
    (row) => String(row.id) === String(payload.category_id),
  );
  if (!category) fail(400, "Select an active item category");
  if (!refs.purposes.some((row) => row.code === payload.purpose))
    fail(400, "Select an active request purpose");
  const requiredBy = date(
    payload.required_by,
    "required-by date",
    now.toISOString().slice(0, 10),
  );
  const justification = text(payload.justification, "justification");
  const impact = text(payload.operational_impact, "operational impact");
  const specialized = payload.specialized || {};
  if (
    typeof specialized !== "object" ||
    Array.isArray(specialized) ||
    Object.keys(specialized).some((key) => !family.fields.includes(key))
  )
    fail(
      400,
      "Unexpected specialized field; patient identifiers and unchecked object IDs are not accepted",
    );
  const details = Object.fromEntries(
    family.fields.map((field) => [field, text(specialized[field], field, 400)]),
  );
  if (details.procedure_date)
    date(
      details.procedure_date,
      "procedure date",
      now.toISOString().slice(0, 10),
    );
  if (details.period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(details.period))
    fail(400, "Invalid requirement period");
  if (
    details.calibration_at &&
    (!/(Z|[+-]\d{2}:\d{2})$/.test(details.calibration_at) ||
      Number.isNaN(Date.parse(details.calibration_at)) ||
      Date.parse(details.calibration_at) < now.getTime())
  )
    fail(400, "Calibration time must be in the future");
  if (
    details.activity &&
    (!Number.isFinite(Number(details.activity)) ||
      Number(details.activity) <= 0)
  )
    fail(400, "Activity must be positive");
  if (
    !Array.isArray(payload.items) ||
    !payload.items.length ||
    payload.items.length > 50
  )
    fail(400, "Include between 1 and 50 items");
  const items = [];
  for (const [index, item] of payload.items.entries()) {
    if (!item || typeof item !== "object")
      fail(400, `Invalid item ${index + 1}`);
    const itemKeys = [
      "item_name",
      "generic_item_id",
      "request_mode",
      "pending_item",
      "restriction_justification",
      "quantity",
      "unit_of_measure",
      "unit_cost",
      "specs",
    ];
    if (Object.keys(item).some((key) => !itemKeys.includes(key)))
      fail(400, `Unexpected field on item ${index + 1}`);
    const quantity = Number(item.quantity),
      cost = Number(item.unit_cost ?? 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      fail(400, `Item ${index + 1}: quantity must be a positive whole number`);
    if (
      !Number.isSafeInteger(cost) ||
      cost < 0 ||
      !Number.isSafeInteger(cost * quantity)
    )
      fail(
        400,
        `Item ${index + 1}: estimated unit cost must be a non-negative whole number`,
      );
    let name, uom, pending, itemType;
    if (item.request_mode === "generic_item") {
      if (
        !Number.isSafeInteger(Number(item.generic_item_id)) ||
        Number(item.generic_item_id) <= 0
      )
        fail(400, "Invalid catalog item ID");
      const { rows } = await runner.query(
        `SELECT generic_name,inventory_uom,category_id,item_type FROM generic_items
        WHERE id=$1 AND is_active=TRUE AND lifecycle_status='active' AND (institute_id IS NULL OR institute_id=$2)
        ${lock ? "FOR SHARE" : ""}`,
        [item.generic_item_id, user.institute_id],
      );
      if (!rows.length)
        fail(
          403,
          `Item ${index + 1}: catalog item is unavailable in your institute`,
        );
      if (String(rows[0].category_id) !== String(category.id))
        fail(
          400,
          `Item ${index + 1}: select its catalog category (split requests with different categories)`,
        );
      name = rows[0].generic_name;
      uom = rows[0].inventory_uom;
      itemType = rows[0].item_type;
      if (item.pending_item)
        fail(400, "Catalog items cannot also request item creation");
    } else if (item.request_mode === "pending_item_creation") {
      pending = item.pending_item;
      if (
        !pending ||
        Object.keys(pending).some(
          (key) =>
            ![
              "proposed_name",
              "item_type",
              "category",
              "justification",
            ].includes(key),
        )
      )
        fail(400, "Invalid pending item referral");
      name = text(pending.proposed_name, "proposed item name", 240);
      const types = [
        "general_item",
        "medication",
        "medical_supply",
        "medical_device",
        "laboratory_item",
        "maintenance_spare_part",
        "it_item",
        "stationery",
        "furniture",
        "equipment",
        "consumable",
        "cleaning_supply",
        "linen",
        "food_beverage",
        "service",
      ];
      if (
        !types.includes(pending.item_type) ||
        pending.category !== category.name ||
        item.generic_item_id
      )
        fail(400, "Pending item type and category must match the request");
      pending = {
        ...pending,
        justification: text(pending.justification, "new item justification"),
      };
      uom = text(item.unit_of_measure, "unit of measure", 80);
      itemType = pending.item_type;
    } else
      fail(
        400,
        "Select a catalog item or request controlled Item Master review",
      );
    if (family.request_type === "Stock") {
      const boundary = require("./contractAuthorizationService");
      const covered = await runner.query(
        `SELECT ci.id FROM contract_items ci JOIN contracts c ON c.id=ci.contract_id
        LEFT JOIN stock_items stock ON stock.id=ci.item_id
        WHERE ${boundary.ownership("c")} AND ${boundary.ownerSql("c")}=$1
        AND ci.is_active=TRUE AND c.status IN ('active','renewed','expiring_soon')
        AND (ci.price_valid_from IS NULL OR ci.price_valid_from<=CURRENT_DATE)
        AND (ci.price_valid_to IS NULL OR ci.price_valid_to>=CURRENT_DATE)
        AND (lower(trim(ci.item_name))=lower(trim($2)) OR ($3::bigint IS NOT NULL AND stock.generic_item_id=$3)) LIMIT 1`,
        [user.institute_id, name, pending ? null : item.generic_item_id],
      );
      if (covered.rows.length)
        fail(
          409,
          "This stock item is covered by an active contract. Use the specialized Stock form to select its contracted item.",
        );
    }
    const protectedTypes = {
      medication: "medication",
      medical_device: "device",
      it_item: "it",
    };
    if (
      (protectedTypes[itemType] && protectedTypes[itemType] !== family.id) ||
      (["medication", "device"].includes(family.id) &&
        protectedTypes[itemType] !== family.id)
    )
      fail(400, "Catalog type requires its specialized request family");
    const specifications = item.specs
      ? text(item.specs, "specifications", 3000)
      : "";
    // Existing specs are the canonical operational specification, not a new master
    // or lifecycle. Human-readable context remains visible to legacy consumers.
    const context = [
      "WICI guided submission v1",
      `Family: ${family.id}`,
      `Category: ${category.name}`,
      `Purpose: ${payload.purpose}`,
      `Required by: ${requiredBy}`,
      `Operational impact: ${impact}`,
      ...Object.entries(details).map(([key, value]) => `${key}: ${value}`),
      specifications,
    ]
      .filter(Boolean)
      .join("\n");
    items.push({
      item_name: name,
      quantity,
      unit_cost: cost,
      unit_of_measure: uom,
      request_mode: item.request_mode,
      generic_item_id: pending ? null : item.generic_item_id,
      ...(pending
        ? {
            pending_item: pending,
            restriction_justification: pending.justification,
          }
        : {}),
      required_date: requiredBy,
      intended_use: details.intended_use || justification,
      specs: context,
    });
  }
  if (
    !Number.isSafeInteger(
      items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0),
    )
  )
    fail(400, "Estimated total exceeds supported range");
  const key = text(payload.client_submission_key, "submission key", 128);
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(key)) fail(400, "Invalid submission key");
  return {
    user,
    family,
    body: {
      request_type: family.request_type,
      justification,
      items,
      target_department_id: user.department_id,
      target_section_id: user.section_id || "",
      client_submission_key: key,
    },
  };
}
async function preview(runner, userId, payload) {
  const result = await prepare(runner, userId, payload);
  const amount =
    result.family.request_type === "Stock"
      ? 0
      : result.body.items.reduce(
          (sum, item) => sum + item.quantity * item.unit_cost,
          0,
        );
  const rules = await fetchApprovalRoutes({
    client: runner,
    requestType: result.family.request_type,
    departmentType: result.user.department_type,
    amount,
  });
  return {
    request_type: result.family.request_type,
    estimated_cost: amount,
    approvals: (rules.length
      ? rules
      : [{ role: "SCM", approval_level: 1 }]
    ).map((rule) => ({ role: rule.role, level: rule.approval_level })),
    estimated: true,
    fallback: !rules.length,
    pending_item_review: result.body.items.some((item) => item.pending_item),
    sap_inventory: { available: false },
  };
}
async function verifyForCommit(client, submission, user) {
  const fresh = await prepare(client, user.id, submission.payload, {
    lock: true,
  });
  if (
    JSON.stringify(fresh.body) !== JSON.stringify(submission.body) ||
    fresh.user.institute_id !== user.institute_id
  )
    fail(
      409,
      "Requester or catalog context changed. Review the request again.",
    );
}
async function assertResolvedRoute(client, requestId) {
  // The legacy writer treats an absent approver as an auto-approved step. A
  // new guide must not imply that an unconfigured approval role was resolved.
  const { rows } = await client.query(
    "SELECT id FROM approvals WHERE request_id=$1 AND approver_id IS NULL LIMIT 1",
    [requestId],
  );
  if (rows.length)
    fail(
      409,
      "The approval route has an unassigned role. Ask the approval administrator to configure it before submitting.",
    );
}
module.exports = {
  FAMILIES,
  enabled,
  actor,
  allowed,
  options,
  catalog,
  prepare,
  preview,
  verifyForCommit,
  assertResolvedRoute,
};
