"use strict";
const profiles = require("./technicalReviewProfiles");
const { error, canManage } = require("./preprocurementTechnicalReviewModel");
async function ensureRequiredReview(client, requestId) {
  if (!(await profiles.installed(client))) return null;
  const request = (
    await client.query(
      "SELECT * FROM requests WHERE id=$1 AND lower(trim(status)) IN ('approved','partially procured','partially_procured') AND request_type<>'Warehouse Supply'",
      [requestId],
    )
  ).rows[0];
  if (!request) return null;
  await client.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended('technical-review-policy:'||$1::text,0))",
    [request.institute_id],
  );
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('technical-review:'||$1::text,0))",
    [requestId],
  );
  if (
    (
      await client.query(
        "SELECT id FROM preprocurement_technical_reviews WHERE request_id=$1",
        [requestId],
      )
    ).rows.length
  )
    return null;
  const items = (
    await client.query(
      "SELECT ri.* FROM requested_items ri WHERE request_id=$1 AND COALESCE(purchased_quantity,0)<quantity AND lower(COALESCE(approval_status,'')) NOT IN ('rejected','available in stock','available_in_stock','in stock','in_stock') AND lower(COALESCE(procurement_status,'')) NOT IN ('purchased','completed','received','cancelled','canceled','not_procured','available in stock','available_in_stock')",
      [requestId],
    )
  ).rows;
  const itemProfiles = await profiles.forItems(
    client,
    items.map((item) => item.id),
    request.institute_id,
  );
  const resolvedProfiles = new Map();
  const selected = [],
    reviewers = [];
  let ownerId = null;
  for (const item of items) {
    const p = itemProfiles?.get(String(item.id));
    if (!p?.settings.pre_required) continue;
    ownerId = ownerId || p.updated_by;
    if (!resolvedProfiles.has(p.profile_key))
      resolvedProfiles.set(
        p.profile_key,
        await profiles.resolveReviewers(client, p, request.department_id),
      );
    const resolved = resolvedProfiles.get(p.profile_key);
    for (const reviewer of resolved)
      if (!reviewers.some((u) => u.id === reviewer.id))
        reviewers.push(reviewer);
    selected.push({
      item_id: item.id,
      evidence: {
        basis: "description",
        category: profiles.categoryForType(p.profile_key),
        evidence_description: item.specs || item.item_name,
        no_sample_reason:
          "Procurement must prepare the proposed product and evidence before technical opinions can be submitted",
        attachment_ids: [],
      },
    });
  }
  if (!selected.length) return null;
  // Include the requesting department independently even when a specialist profile
  // configures only Biomedical/IT/etc. No selection of an arbitrary HOD.
  if (
    !reviewers.some(
      (u) => String(u.department_id) === String(request.department_id),
    )
  ) {
    const extra = await profiles.resolveReviewers(
      client,
      {
        institute_id: request.institute_id,
        settings: { reviewers: [{ department_id: "REQUESTING" }] },
      },
      request.department_id,
    );
    reviewers.push(...extra);
  }
  const actor = (
    await client.query(
      `SELECT u.*,COALESCE((SELECT array_agg(DISTINCT p.code) FROM permissions p WHERE p.id IN (SELECT permission_id FROM user_permissions WHERE user_id=u.id UNION SELECT rp.permission_id FROM role_permissions rp JOIN roles ro ON ro.id=rp.role_id WHERE lower(trim(ro.name))=lower(trim(u.role)))),'{}'::text[]) AS permissions FROM users u WHERE u.id=$1 AND u.institute_id=$2 AND u.is_active`,
      [ownerId, request.institute_id],
    )
  ).rows[0];
  if (!actor || !canManage(actor))
    throw error(
      409,
      "The technical profile owner no longer has SCM management authority; update the profile before generating tasks",
    );
  const nested = {
    query: (sql, params) =>
      sql === "BEGIN"
        ? client.query("SAVEPOINT technical_auto")
        : sql === "COMMIT"
          ? client.query("RELEASE SAVEPOINT technical_auto")
          : sql === "ROLLBACK"
            ? client.query("ROLLBACK TO SAVEPOINT technical_auto")
            : client.query(sql, params),
    release: () => {},
  };
  return require("./preprocurementTechnicalReviewService")
    .createTechnicalReviewService({
      query: nested.query,
      connect: async () => nested,
    })
    .create(
      actor,
      {
        request_id: request.id,
        items: selected,
        reviewer_ids: reviewers.map((u) => u.id),
        reviewer_assignments: reviewers.map((u) => ({
          reviewer_id: u.id,
          department_id: u.department_id,
        })),
        instructions:
          "Required technical review. Procurement must prepare the proposed product and supporting evidence before departmental assessment.",
        submission_key: `automatic-technical:${request.id}`,
      },
      true,
    );
}
module.exports = { ensureRequiredReview };
