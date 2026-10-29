"use strict";
const {
  snapshotItem,
  fingerprint,
  error,
} = require("./preprocurementTechnicalReviewModel");
const GATED_COMMANDS = new Set([
  "create_award",
  "create_purchase_order",
  "register_procurement",
]);
async function assertTechnicalClearance(
  client,
  item,
  actor,
  command,
  context = {},
) {
  if (!GATED_COMMANDS.has(command)) return;
  if (!client?.query)
    throw error(
      503,
      "Technical review gate requires a transactional database client",
    );
  const configured = await client.query(
    "SELECT to_regclass('public.preprocurement_technical_reviews') IS NOT NULL AS technical_review_available, to_regclass('public.device_demo_workspaces') IS NOT NULL AS demo_workspace_available",
  );
  if (configured.rows[0]?.demo_workspace_available === true)
    await require("./deviceDemoGate").assertDemoSelection(
      client,
      item,
      actor,
      command,
      context,
    );
  // Before SQL 049 exists there cannot be a selected review or enabled policy.
  if (configured.rows[0]?.technical_review_available !== true) return;
  const id = item.id || item.item_id;
  const found = await client.query(
    `SELECT ri.*,r.institute_id,r.department_id AS requesting_department_id,r.request_type,r.status AS request_status
    FROM public.requested_items ri JOIN public.requests r ON r.id=ri.request_id WHERE ri.id=$1 AND ($2::integer IS NULL OR ri.request_id=$2)`,
    [id, item.request_id || null],
  );
  const current = found.rows[0];
  if (!current)
    throw error(404, "Requested item not found for technical clearance");
  if (current.request_type === "Warehouse Supply") return;
  await client.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended('technical-review-policy:'||$1::text,0))",
    [current.institute_id],
  );
  await client.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended('technical-review:'||$1::text,0))",
    [current.request_id],
  );
  const policy = (
    await client.query(
      "SELECT require_for_all FROM public.preprocurement_technical_review_policy WHERE institute_id=$1",
      [current.institute_id],
    )
  ).rows[0];
  const history = await client.query(
    "SELECT id,status,item_packets,requesting_department_id FROM public.preprocurement_technical_reviews WHERE request_id=$1 AND institute_id=$2 ORDER BY id DESC",
    [current.request_id, current.institute_id],
  );
  const review = history.rows.find((row) =>
    row.item_packets.some((packet) => String(packet.item_id) === String(id)),
  );
  if (!review && !policy?.require_for_all && !history.rows.length) return;
  if (
    !["approved", "partially procured", "partially_procured"].includes(
      String(current.request_status || "")
        .trim()
        .toLowerCase(),
    )
  )
    throw error(
      409,
      "This request is no longer approved for procurement",
      "TECHNICAL_REVIEW_REQUEST_NOT_APPROVED",
    );
  const packet = review?.item_packets.find(
    (row) => String(row.item_id) === String(id),
  );
  if (!review || review.status !== "APPROVED")
    throw error(
      409,
      "Departmental technical approval and SCM sign-off are required before procurement",
      "TECHNICAL_REVIEW_REQUIRED",
    );
  if (
    String(review.requesting_department_id) !==
      String(current.requesting_department_id) ||
    packet.fingerprint !== fingerprint(snapshotItem(current))
  )
    throw error(
      409,
      "The requested item changed after technical approval; send it for a new technical review",
      "TECHNICAL_REVIEW_STALE",
    );
}
module.exports = { assertTechnicalClearance, GATED_COMMANDS };
