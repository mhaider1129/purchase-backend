"use strict";
const fail = (items) =>
  Object.assign(
    new Error(
      "Approved request contains lines requiring item identity resolution",
    ),
    {
      code: "ITEM_IDENTITY_RESOLUTION_REQUIRED",
      status: 409,
      unresolved_item_ids: items.map((i) => i.id),
      unresolved_item_names: items.map((i) => i.item_name),
    },
  );
const { assertReadyForCommand } = require("./procurementIdentityPolicyService");
const {
  isProcurementReady: isReady,
} = require("./procurementItemIdentityService");
async function assertRequestItemsReadyForSourcing(
  db,
  requestId,
  providedItems,
  actor,
) {
  const items =
    providedItems ||
    (
      await db.query(
        `SELECT id,item_name,request_mode,catalog_status,generic_item_id,preferred_product_id,mandatory_product_id,restriction_justification,stocking_policy,approval_status,request_id FROM requested_items WHERE request_id=$1 AND LOWER(COALESCE(approval_status,'approved'))<>'rejected' ORDER BY id FOR SHARE`,
        [requestId],
      )
    ).rows;
  const unresolved = [];
  for (const item of items) {
    try {
      await assertReadyForCommand(db, item, actor, "start_sourcing");
    } catch (error) {
      if (error.code !== "ITEM_IDENTITY_RESOLUTION_REQUIRED") throw error;
      unresolved.push(item);
    }
  }
  if (unresolved.length) throw fail(unresolved);
  return items;
}
module.exports = { assertRequestItemsReadyForSourcing, isReady };
