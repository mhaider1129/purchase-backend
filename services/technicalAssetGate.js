"use strict";
const profiles = require("./technicalReviewProfiles"),
  q = require("./receiptInspectionQuantities");
const { error } = require("./preprocurementTechnicalReviewModel");
async function assertAsset(db, input, ctx, existingId = null) {
  if (
    !input.goodsReceiptItemId &&
    !input.requestedItemId &&
    !input.purchaseRequestId &&
    !input.purchaseOrderId &&
    !input.goodsReceiptId
  )
    return;
  if (!(await profiles.installed(db))) return;
  if (input.goodsReceiptItemId) {
    const row = (
      await db.query(
        `SELECT ${q.required()} AS required,(${q.accepted()})*gri.conversion_factor>(SELECT count(*) FROM assets a WHERE a.goods_receipt_item_id=gri.id AND ($2::bigint IS NULL OR a.id<>$2)) AS has_capacity FROM goods_receipt_items gri WHERE gri.id=$1 FOR UPDATE`,
        [input.goodsReceiptItemId, existingId],
      )
    ).rows[0];
    if (row?.required && !row.has_capacity)
      throw error(
        409,
        "Applied technical acceptance is required before registering or deploying this asset",
        "ASSET_TECHNICAL_ACCEPTANCE_REQUIRED",
      );
  } else if (
    input.requestedItemId ||
    input.purchaseRequestId ||
    input.purchaseOrderId ||
    input.goodsReceiptId
  ) {
    const blocked = (
      await db.query(
        `SELECT 1 FROM requested_items ri JOIN requests r ON r.id=ri.request_id LEFT JOIN generic_items g ON g.id=ri.generic_item_id LEFT JOIN technical_review_profiles p ON p.institute_id=r.institute_id AND p.profile_key=COALESCE(g.item_type,'unclassified') WHERE r.institute_id=$1 AND (ri.id=$2 OR r.id=$3 OR ri.id IN (SELECT requested_item_id FROM purchase_order_items WHERE purchase_order_id=$4) OR ri.id IN (SELECT requested_item_id FROM goods_receipt_items WHERE goods_receipt_id=$5)) AND (COALESCE((p.settings->>'delivery_required')::boolean,false) OR EXISTS(SELECT 1 FROM goods_receipt_items gri WHERE gri.requested_item_id=ri.id AND ${q.required()})) LIMIT 1`,
        [
          ctx.instituteId,
          input.requestedItemId || null,
          input.purchaseRequestId || null,
          input.purchaseOrderId || null,
          input.goodsReceiptId || null,
        ],
      )
    ).rows.length;
    if (blocked)
      throw error(
        409,
        "Link the specifically accepted Goods Receipt line before registering or deploying this procurement asset",
        "ASSET_TECHNICAL_ACCEPTANCE_REQUIRED",
      );
  }
}
module.exports = { assertAsset };
