"use strict";
const {
  error,
  text,
  canManage,
} = require("./preprocurementTechnicalReviewModel");
const { writeAuditEvent } = require("./auditService");
const KEYS = [
  "unclassified",
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
const DELIVERY_CHECKS = {
  specifications: ["yes", "no"],
  physical_condition: ["yes", "no"],
  documents: ["yes", "no", "not_applicable"],
  functional_test: ["pass", "fail", "not_required"],
  calibration: ["pass", "fail", "not_applicable"],
  electrical_safety: ["pass", "fail", "not_applicable"],
  installation: ["pass", "fail", "not_applicable"],
  packaging: ["pass", "fail", "not_applicable"],
  expiry: ["pass", "fail", "not_applicable"],
  sterility: ["pass", "fail", "not_applicable"],
  configuration: ["pass", "fail", "not_applicable"],
};
for (const choices of Object.values(DELIVERY_CHECKS))
  choices.push("not_assessed");
const BASE_CHECKS = [
  "specifications",
  "physical_condition",
  "documents",
  "functional_test",
];
const installed = async (db) =>
  (
    await db.query(
      "SELECT to_regclass('public.technical_review_profiles') IS NOT NULL AS available",
    )
  )?.rows?.[0]?.available === true;
const requireSchema = async (db) => {
  const ready = (
    await db.query(
      "SELECT to_regclass('public.technical_review_profiles') IS NOT NULL AND to_regclass('public.technical_evidence_references') IS NOT NULL AND to_regclass('public.delivery_inspection_tasks') IS NOT NULL AND to_regclass('public.delivery_inspection_assignments') IS NOT NULL AND to_regclass('public.technical_workflow_history') IS NOT NULL AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='goods_receipt_items' AND column_name IN ('technical_inspection_required','technical_accepted_quantity','technical_rejected_quantity'))=3 AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='preprocurement_technical_review_assignments' AND column_name='opinion_round') AS available",
    )
  )?.rows?.[0]?.available;
  if (!ready)
    throw error(
      503,
      "Apply complete SQL 054 for technical profiles and delivery inspections",
      "TECHNICAL_WORKFLOW_SCHEMA_REQUIRED",
    );
};
const requireManager = (a) => {
  if (!a?.id || !Number(a.institute_id) || !canManage(a))
    throw error(403, "SCM technical management permission is required");
};
async function forItems(db, ids, institute) {
  if (!(await installed(db))) return null;
  await requireSchema(db);
  const rows = (
    await db.query(
      `SELECT ri.id AS item_id,p.*,r.department_id FROM requested_items ri JOIN requests r ON r.id=ri.request_id LEFT JOIN generic_items g ON g.id=ri.generic_item_id JOIN technical_review_profiles p ON p.institute_id=r.institute_id AND p.profile_key=COALESCE(g.item_type,'unclassified') WHERE ri.id=ANY($1::integer[]) AND r.institute_id=$2`,
      [ids, institute],
    )
  ).rows;
  return new Map(rows.map((row) => [String(row.item_id), row]));
}
async function profileForItem(db, item, requestedKey) {
  if (!(await installed(db))) return null;
  await requireSchema(db);
  return (
    (
      await db.query(
        `SELECT p.*,r.department_id FROM requested_items ri JOIN requests r ON r.id=ri.request_id LEFT JOIN generic_items g ON g.id=ri.generic_item_id JOIN technical_review_profiles p ON p.institute_id=r.institute_id AND p.profile_key=COALESCE($2::text,g.item_type,'unclassified') WHERE ri.id=$1`,
        [
          item.id || item.requested_item_id || item.item_id,
          requestedKey || null,
        ],
      )
    ).rows[0] || null
  );
}
async function resolveReviewers(db, profile, requestingDepartment) {
  const result = [];
  for (const rule of profile.settings.reviewers) {
    const department =
      rule.department_id === "REQUESTING"
        ? requestingDepartment
        : rule.department_id;
    const rows = (
      await db.query(
        `SELECT u.id,u.name,u.role,u.department_id FROM users u JOIN departments d ON d.id=$2 AND d.institute_id=$1 WHERE u.institute_id=$1 AND u.is_active IS TRUE AND (($3::integer IS NOT NULL AND u.id=$3 AND u.department_id=d.id) OR ($3::integer IS NULL AND (EXISTS(SELECT 1 FROM organization_positions p JOIN organization_units ou ON ou.id=p.organization_unit_id WHERE p.user_id=u.id AND ou.department_id=d.id AND ou.institute_id=$1 AND ou.is_active AND p.is_active AND p.position_type='DEPARTMENT_HEAD' AND (p.effective_from IS NULL OR p.effective_from<=(now() AT TIME ZONE 'Asia/Baghdad')::date) AND (p.effective_to IS NULL OR p.effective_to>=(now() AT TIME ZONE 'Asia/Baghdad')::date)) OR (lower(trim(u.role))='hod' AND u.department_id=d.id AND NOT EXISTS(SELECT 1 FROM organization_positions p JOIN organization_units ou ON ou.id=p.organization_unit_id WHERE ou.department_id=d.id AND ou.institute_id=$1 AND p.is_active AND ou.is_active AND p.position_type='DEPARTMENT_HEAD' AND (p.effective_from IS NULL OR p.effective_from<=(now() AT TIME ZONE 'Asia/Baghdad')::date) AND (p.effective_to IS NULL OR p.effective_to>=(now() AT TIME ZONE 'Asia/Baghdad')::date))))))`,
        [profile.institute_id, department, rule.reviewer_id || null],
      )
    ).rows;
    if (rows.length !== 1)
      throw error(
        409,
        `Technical responsibility for department ${department} must resolve to one active reviewer; review Management setup`,
      );
    const duplicate = result.find((u) => String(u.id) === String(rows[0].id));
    if (duplicate && String(duplicate.department_id) !== String(department))
      throw error(
        409,
        "Assign distinct reviewers to the different technical departments",
      );
    if (!result.some((u) => String(u.id) === String(rows[0].id)))
      result.push({ ...rows[0], department_id: department });
  }
  return result;
}
async function directory(db, actor) {
  requireManager(actor);
  await requireSchema(db);
  return {
    profiles: (
      await db.query(
        "SELECT * FROM technical_review_profiles WHERE institute_id=$1 ORDER BY profile_key",
        [actor.institute_id],
      )
    ).rows,
    departments: (
      await db.query(
        "SELECT id,name FROM departments WHERE institute_id=$1 ORDER BY name",
        [actor.institute_id],
      )
    ).rows,
    users: (
      await db.query(
        "SELECT id,name,role,department_id FROM users WHERE institute_id=$1 AND is_active ORDER BY name",
        [actor.institute_id],
      )
    ).rows,
    keys: KEYS,
    delivery_checks: DELIVERY_CHECKS,
    base_checks: BASE_CHECKS,
  };
}
async function save(db, actor, input) {
  requireManager(actor);
  await requireSchema(db);
  if (
    !KEYS.includes(input.profile_key) ||
    !text(input.reason) ||
    !input.settings
  )
    throw error(400, "Profile, settings and reason are required");
  const s = input.settings;
  if (
    typeof s.pre_required !== "boolean" ||
    typeof s.delivery_required !== "boolean" ||
    ![1, 2, 3].includes(Number(s.level)) ||
    !Array.isArray(s.reviewers) ||
    !s.reviewers.length ||
    s.reviewers.length > 20 ||
    !Array.isArray(s.delivery_checks) ||
    s.delivery_checks.some((k) => !DELIVERY_CHECKS[k]) ||
    BASE_CHECKS.some((k) => !s.delivery_checks.includes(k))
  )
    throw error(
      400,
      "Configure reviewers, inspection level and the required delivery checks",
    );
  if (Number(s.level) === 1 && (s.pre_required || s.delivery_required))
    throw error(
      400,
      "Basic verification uses normal receiving. Choose level 2 or 3 for automatic technical requirements",
    );
  const settings = {
    pre_required: s.pre_required,
    delivery_required: s.delivery_required,
    level: Number(s.level),
    evidence_required: Boolean(s.evidence_required) || Number(s.level) === 3,
    delivery_checks: [...new Set(s.delivery_checks)],
    pre_checks: Array.isArray(s.pre_checks) ? [...new Set(s.pre_checks)] : [],
    reviewers: s.reviewers.map((r) => ({
      department_id:
        r.department_id === "REQUESTING"
          ? "REQUESTING"
          : String(r.department_id),
      reviewer_id: r.reviewer_id ? String(r.reviewer_id) : null,
    })),
  };
  if (
    settings.pre_checks.some(
      (k) => !DELIVERY_CHECKS[k] || BASE_CHECKS.includes(k),
    )
  )
    throw error(400, "Invalid additional pre-procurement assessment");
  for (const r of settings.reviewers) {
    if (String(r.reviewer_id) === String(actor.id))
      throw error(
        400,
        "The SCM profile owner cannot be an independent opinion reviewer",
      );
    if (
      (r.department_id !== "REQUESTING" && !/^\d+$/.test(r.department_id)) ||
      (r.reviewer_id && !/^\d+$/.test(r.reviewer_id))
    )
      throw error(400, "Invalid department or reviewer identity");
    if (
      r.department_id !== "REQUESTING" &&
      !(
        await db.query(
          "SELECT id FROM departments WHERE id=$1 AND institute_id=$2",
          [r.department_id, actor.institute_id],
        )
      ).rows.length
    )
      throw error(403, "Technical department is outside this institute");
    if (
      r.reviewer_id &&
      !(
        await db.query(
          "SELECT id FROM users WHERE id=$1 AND institute_id=$2 AND is_active AND ($3::text='REQUESTING' OR department_id::text=$3)",
          [r.reviewer_id, actor.institute_id, r.department_id],
        )
      ).rows.length
    )
      throw error(403, "Reviewer must be active in the configured department");
    if (r.department_id === "REQUESTING" && r.reviewer_id)
      throw error(
        400,
        "Requesting-department responsibility must resolve its HOD dynamically",
      );
  }
  for (const r of settings.reviewers.filter(
    (r) => r.department_id !== "REQUESTING",
  ))
    await resolveReviewers(
      db,
      { institute_id: actor.institute_id, settings: { reviewers: [r] } },
      null,
    );
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('technical-review-policy:'||$1::text,0))",
    [actor.institute_id],
  );
  const before = (
    await db.query(
      "SELECT * FROM technical_review_profiles WHERE institute_id=$1 AND profile_key=$2",
      [actor.institute_id, input.profile_key],
    )
  ).rows[0];
  if (String(input.row_version || 0) !== String(before?.row_version || 0))
    throw error(409, "Technical profile changed; reload before saving");
  const after = (
    await db.query(
      `INSERT INTO technical_review_profiles(institute_id,profile_key,settings,updated_by) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(institute_id,profile_key) DO UPDATE SET settings=EXCLUDED.settings,row_version=technical_review_profiles.row_version+1,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
      [
        actor.institute_id,
        input.profile_key,
        JSON.stringify(settings),
        actor.id,
      ],
    )
  ).rows[0];
  await writeAuditEvent({
    client: db,
    entityType: "technical_review_profile",
    entityId: actor.institute_id,
    actorUserId: actor.id,
    instituteId: actor.institute_id,
    action: "TECHNICAL_PROFILE_CONFIGURED",
    beforeData: before,
    afterData: after,
    reason: text(input.reason),
  });
  return after;
}
async function history(
  db,
  { actor, reviewId = null, taskId = null, action, payload },
) {
  const result = (
    await db.query(
      "INSERT INTO technical_workflow_history(institute_id,review_id,delivery_task_id,action,actor_id,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *",
      [
        actor.institute_id,
        reviewId,
        taskId,
        action,
        actor.id,
        JSON.stringify(payload),
      ],
    )
  ).rows[0];
  await writeAuditEvent({
    client: db,
    entityType: taskId
      ? "delivery_inspection"
      : "preprocurement_technical_review",
    entityId: taskId || reviewId,
    actorUserId: actor.id,
    instituteId: actor.institute_id,
    action,
    metadata: { history_id: result.id },
    reason: payload.notes || null,
  });
  return result;
}
async function retainEvidence(db, actor, reviewId, taskId, ids) {
  if (!ids.length || !(await installed(db))) return;
  await db.query(
    "INSERT INTO technical_evidence_references(attachment_id,review_id,delivery_task_id,created_by) SELECT DISTINCT id,$2::bigint,$3::bigint,$4::integer FROM unnest($1::integer[]) id ON CONFLICT DO NOTHING",
    [ids, reviewId, taskId, actor.id],
  );
}
const categoryForType = (type) =>
  ({
    medication: "Medication",
    medical_supply: "Medical Supply",
    medical_device: "Medical Equipment",
    laboratory_item: "Laboratory Item",
    maintenance_spare_part: "Maintenance Item",
    it_item: "IT Equipment",
    stationery: "Stationery",
    furniture: "Furniture",
    cleaning_supply: "Housekeeping Supply",
  })[type] || "Other";
module.exports = {
  categoryForType,
  retainEvidence,
  forItems,
  KEYS,
  DELIVERY_CHECKS,
  BASE_CHECKS,
  installed,
  requireSchema,
  requireManager,
  profileForItem,
  resolveReviewers,
  directory,
  save,
  history,
};
