"use strict";
const createHttpError = require("../utils/httpError");
const {
  auditItemMaster,
  isProcurementReady,
  assertProcurementReady,
} = require("./procurementItemIdentityService");

// Only description-only demand participates in the temporary rollout allowance.
// Pending referrals, invalid modes, product restrictions and stocked lines stay governed.
const isCompatibilityCandidate = (item) =>
  Boolean(item) &&
  (item.request_mode == null || item.request_mode === "free_text") &&
  !item.generic_item_id &&
  !item.preferred_product_id &&
  !item.mandatory_product_id &&
  (item.stocking_policy == null ||
    ["non_stock", "direct_delivery", "consignment"].includes(
      item.stocking_policy,
    )) &&
  (item.catalog_status == null || item.catalog_status === "pending_mapping") &&
  String(item.approval_status || "")
    .trim()
    .toLowerCase() !== "rejected";

async function loadPolicy(client, { lock = false } = {}) {
  if (!client?.query) return { enforce_item_identity: true, configured: false };
  // A preflight keeps missing manual migrations from aborting business transactions.
  const capability = await client.query(
    "SELECT to_regclass('public.procurement_identity_policy') IS NOT NULL AS available",
  );
  if (capability.rows[0]?.available !== true)
    return { enforce_item_identity: true, configured: false };
  const result =
    await client.query(`SELECT enforce_item_identity,updated_by,updated_at,reason
    FROM public.procurement_identity_policy WHERE id=1 ${lock === "update" ? "FOR UPDATE" : lock ? "FOR SHARE" : ""}`);
  return {
    ...result.rows[0],
    enforce_item_identity: result.rows[0]?.enforce_item_identity !== false,
    configured: Boolean(result.rows[0]),
  };
}

async function assertReadyForCommand(
  client,
  item,
  actor,
  action = "procurement",
) {
  if (isProcurementReady(item)) return;
  if (!isCompatibilityCandidate(item)) return assertProcurementReady(item);
  const policy = await loadPolicy(client, { lock: true });
  if (policy.enforce_item_identity) return assertProcurementReady(item);
  await auditItemMaster(client, {
    entityType: "requested_item",
    entityId: item.id || item.item_id,
    action: "procurement.compatibility_used",
    actorId: actor?.id,
    requestedItemId: item.id || item.item_id,
    requestId: item.request_id,
    reason: policy.reason,
    context: {
      command: action,
      request_mode: item.request_mode ?? null,
      enforce_item_identity: false,
    },
  });
}

async function updatePolicy(client, input, actor) {
  if (typeof input.enforce_item_identity !== "boolean")
    throw createHttpError(400, "enforce_item_identity must be a boolean");
  const reason = String(input.reason || "").trim();
  if (!reason) throw createHttpError(400, "A policy change reason is required");
  const previous = await loadPolicy(client, { lock: "update" });
  if (!previous.configured)
    throw Object.assign(
      createHttpError(
        503,
        "Apply the manual procurement identity policy migration first",
      ),
      { code: "IDENTITY_POLICY_SCHEMA_MISSING" },
    );
  const result = await client.query(
    `UPDATE public.procurement_identity_policy SET enforce_item_identity=$1,
    reason=$2,updated_by=$3,updated_at=NOW() WHERE id=1 RETURNING *`,
    [input.enforce_item_identity, reason, actor.id],
  );
  await auditItemMaster(client, {
    entityType: "procurement_identity_policy",
    entityId: 1,
    action: "policy.updated",
    actorId: actor.id,
    reason,
    previous,
    next: result.rows[0],
  });
  return { ...result.rows[0], configured: true };
}
module.exports = {
  isCompatibilityCandidate,
  loadPolicy,
  assertReadyForCommand,
  updatePolicy,
};
