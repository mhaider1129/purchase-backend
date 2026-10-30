"use strict";
const {
  snapshotItem,
  fingerprint,
  error,
} = require("./preprocurementTechnicalReviewModel");
const GATED_COMMANDS = new Set([
  "create_award",
  "create_purchase_order",
  "release_purchase_order",
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
    "SELECT to_regclass('public.preprocurement_technical_reviews') IS NOT NULL AS technical_review_available, to_regclass('public.device_demo_workspaces') IS NOT NULL AS demo_workspace_available, to_regclass('public.technical_review_profiles') IS NOT NULL AS technical_workflow_available",
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
    FROM public.requested_items ri JOIN public.requests r ON r.id=ri.request_id WHERE ri.id=$1 AND ($2::integer IS NULL OR ri.request_id=$2) FOR SHARE OF ri,r`,
    [id, item.request_id || null],
  );
  const current = found.rows[0];
  if (!current)
    throw error(404, "Requested item not found for technical clearance");
  if (!actor?.id || !Number.isInteger(Number(actor.institute_id)) ||
      Number(actor.institute_id) !== Number(current.institute_id))
    throw error(403, 'Technical clearance requires an actor in the request institute', 'TECHNICAL_REVIEW_SCOPE_DENIED');
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
    "SELECT id,status,item_packets,requesting_department_id,row_version,signed_at,signed_by FROM public.preprocurement_technical_reviews WHERE request_id=$1 AND institute_id=$2 ORDER BY id DESC",
    [current.request_id, current.institute_id],
  );
  const review = history.rows.find((row) =>
    row.item_packets.some((packet) => String(packet.item_id) === String(id)),
  );
  const categoryProfile =
    configured.rows[0]?.technical_workflow_available === true
      ? await require("./technicalReviewProfiles").profileForItem(
          client,
          current,
        )
      : null;
  if (
    !review &&
    !policy?.require_for_all &&
    !categoryProfile?.settings.pre_required
  )
    return;
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
  if (packet?.awaiting_proposal)
    throw error(
      409,
      "Technical proposal preparation is required",
      "TECHNICAL_PROPOSAL_REQUIRED",
    );
  if (packet?.evidence?.quotation_fingerprint_version === 2 &&
      (!review.signed_by || !review.signed_at || !review.row_version))
    throw error(409, 'Signed technical approval evidence is required; review the current proposal', 'TECHNICAL_PROPOSAL_REVIEW_REQUIRED');
  if (packet?.evidence)
    await require("./technicalProposalSnapshot").assertCurrent(
      client,
      packet.evidence,
      context,
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
  // Approved review rows cannot be revised by the application. The link pins
  // the exact signed review/round used to create this PO, not a later review.
  if (context.purchase_order_id && packet.evidence?.quotation_fingerprint_version === 2) {
    const bound = await client.query(
      "SELECT id FROM document_flow_links WHERE request_id=$1 AND source_document_type='TECHNICAL_REVIEW' AND source_document_id=$2 AND target_document_type='PURCHASE_ORDER' AND target_document_id=$3",
      [current.request_id, String(review.id), String(context.purchase_order_id)],
    );
    if (!bound.rows.length) throw error(409, 'PO technical approval provenance cannot be verified; review the current proposal', 'TECHNICAL_PROPOSAL_REVIEW_REQUIRED');
  }
  return {
    review_id: review.id, round_version: review.row_version,
    signed_at: review.signed_at, signed_by: review.signed_by,
    item_id: id, request_fingerprint: packet.fingerprint,
    quotation_item_id: packet.evidence?.quotation_item_id || null,
    quotation_fingerprint: packet.evidence?.quotation_fingerprint || null,
    quotation_fingerprint_version: packet.evidence?.quotation_fingerprint_version || null,
  };
}
module.exports = { assertTechnicalClearance, GATED_COMMANDS };
