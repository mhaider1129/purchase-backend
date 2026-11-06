"use strict";
// Receipt provenance for the existing inventoryStatusTransferService; no stock posting here.
const authorization = require("./contractAuthorizationService");
const { authorizeInventoryMovement } = require("../policies/inventoryPolicy");
const { parseDecimal } = require("./uomConversionService");
const audit = require("./auditService");
const InventoryRepository = require("../repositories/inventoryRepository");
const outbox = require("./notificationOutboxService");
const fail = (statusCode, message, code = "RECEIPT_STATUS_SCOPE_DENIED") =>
  Object.assign(new Error(message), { statusCode, code });
function compare(left, right) {
  const a = parseDecimal(left, "quantity", { allowZero: true }),
    b = parseDecimal(right, "quantity", { allowZero: true }),
    scale = Math.max(a.scale, b.scale);
  const delta =
    a.coefficient * 10n ** BigInt(scale - a.scale) -
    b.coefficient * 10n ** BigInt(scale - b.scale);
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
function quantityForInventory(value) {
  let text = String(value ?? "")
    .trim()
    .replace(/^\+/, "");
  try {
    parseDecimal(text, "quantity");
  } catch (e) {
    throw fail(400, e.message, "INVALID_QUANTITY");
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric <= 0)
    throw fail(
      400,
      "Quantity is outside inventory posting limits",
      "INVALID_QUANTITY",
    );
  const [mantissa, exp = "0"] = String(numeric).split("e"),
    digits = mantissa.replace(".", ""),
    position =
      (mantissa.includes(".") ? mantissa.indexOf(".") : mantissa.length) +
      Number(exp);
  const roundTrip =
    position <= 0
      ? "0." + "0".repeat(-position) + digits
      : position >= digits.length
        ? digits + "0".repeat(position - digits.length)
        : digits.slice(0, position) + "." + digits.slice(position);
  if (compare(text, roundTrip) !== 0)
    throw fail(
      400,
      "Quantity cannot be represented exactly by the existing inventory posting interface",
      "RECEIPT_STATUS_PRECISION_REQUIRED",
    );
  return text;
}
async function resolve(client, input, from, to) {
  if (input.receiptMovementId == null) {
    if (input.sourceDocumentType === "goods_receipt")
      throw fail(
        409,
        "Receipt status transfer requires the original receiptMovementId",
      );
    return null;
  }
  if (
    !Number.isSafeInteger(Number(input.receiptMovementId)) ||
    Number(input.receiptMovementId) <= 0
  )
    throw fail(400, "A valid receiptMovementId is required");
  const ready = (
    await client.query(
      "SELECT to_regprocedure('public.canonical_receipt_inventory_quantity(bigint,integer,text,bigint)') IS NOT NULL AS ready",
    )
  ).rows[0]?.ready;
  if (!ready)
    throw fail(
      503,
      "Apply manual SQL 068 before receipt stock-status transfer",
      "RECEIPT_STATUS_SCHEMA_REQUIRED",
    );
  const actor = await authorization.actor(input.actor, client);
  const user = (
    await client.query("SELECT warehouse_id FROM users WHERE id=$1 FOR SHARE", [
      actor.id,
    ])
  ).rows[0];
  Object.assign(actor, user);
  const source = (
    await client.query(
      `SELECT m.*,gri.id receipt_item_id,gri.purchase_order_item_id,gri.requested_item_id,gr.id receipt_id,r.id request_id,r.institute_id request_institute_id,po.supplier_id
 FROM inventory_transactions m JOIN goods_receipt_items gri ON gri.id::text=m.source_document_line_id
 JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.id::text=m.source_document_id
 JOIN purchase_order_items pi ON pi.id=gri.purchase_order_item_id AND pi.purchase_order_id=gr.purchase_order_id AND pi.requested_item_id=gri.requested_item_id
 JOIN purchase_orders po ON po.id=pi.purchase_order_id AND po.request_id=gr.request_id
 JOIN requested_items ri ON ri.id=gri.requested_item_id AND ri.request_id=po.request_id
 JOIN requests r ON r.id=ri.request_id AND r.institute_id=m.institute_id
 JOIN departments ownership_department ON ownership_department.id=r.department_id AND ownership_department.institute_id=r.institute_id
 JOIN suppliers ownership_supplier ON ownership_supplier.id=po.supplier_id AND (to_jsonb(ownership_supplier)?'institute_id' AND ((to_jsonb(ownership_supplier)->>'institute_id') IS NULL OR (to_jsonb(ownership_supplier)->>'institute_id')::integer=r.institute_id))
 JOIN warehouses w ON w.id=m.warehouse_id AND w.id=gri.warehouse_id AND w.institute_id=r.institute_id AND w.is_active
 WHERE m.id=$1 AND m.source_document_type='goods_receipt' AND m.movement_type='GOODS_RECEIPT' AND m.quantity>0 AND m.reversal_of_movement_id IS NULL AND r.institute_id=$2
 FOR UPDATE OF m FOR SHARE OF w`,
      [Number(input.receiptMovementId), actor.institute_id],
    )
  ).rows[0];
  if (!source) throw fail(404, "Receipt inventory source not found");
  if (input.sourceDocumentType && input.sourceDocumentType !== "goods_receipt")
    throw fail(409, "Receipt source document type cannot be substituted");
  const permission =
    to === "QUARANTINE"
      ? "inventory.quarantine"
      : from === "QUARANTINE"
        ? "inventory.release-quarantine"
        : "inventory.recall";
  authorizeInventoryMovement(
    actor,
    { permission },
    { id: source.warehouse_id, institute_id: source.institute_id },
  );
  for (const [field, actual] of Object.entries({
    inventoryItemId: source.stock_item_id,
    instituteId: source.institute_id,
    warehouseId: source.warehouse_id,
    sourceDocumentId: source.receipt_id,
    sourceDocumentLineId: source.receipt_item_id,
  }))
    if (input[field] != null && String(input[field]) !== String(actual))
      throw fail(409, `Receipt ${field} cannot be substituted`);
  for (const [field, actual] of Object.entries({
    batchNumber: source.batch_number,
    lotNumber: source.lot_number,
    serialNumber: source.serial_number,
    expiryDate: source.expiry_date,
  })) {
    if (input[field] == null) continue;
    let provided = String(input[field]),
      expected = String(actual);
    if (field === "expiryDate") {
      const parsed = new Date(input[field]);
      if (Number.isNaN(parsed.getTime()))
        throw fail(400, "Invalid receipt expiry date");
      provided = parsed.toISOString().slice(0, 10);
      expected = actual ? new Date(actual).toISOString().slice(0, 10) : "null";
    }
    if (provided !== expected)
      throw fail(409, `Receipt ${field} cannot be substituted`);
  }
  const quantity = quantityForInventory(input.quantity);
  // Serialize the provenance check with the canonical posting mutex, including issues.
  await new InventoryRepository(client).lockPostingKeys({
    idempotencyKey: `${input.idempotencyKey}:debit`,
    instituteId: source.institute_id,
    warehouseId: source.warehouse_id,
    inventoryItemId: source.stock_item_id,
    stockStatus: from,
    batchNumber: source.batch_number,
    lotNumber: source.lot_number,
    serialNumber: source.serial_number,
  });
  // A generic issue can use a broader advisory key (no batch filter). Reuse the
  // posting engine's ordered balance locks before reading issue evidence as well.
  await new InventoryRepository(client).lockEligibleOutboundBalances({
    warehouseId: source.warehouse_id,
    inventoryItemId: source.stock_item_id,
    stockStatus: from,
    batchNumber: source.batch_number,
    lotNumber: source.lot_number,
    serialNumber: source.serial_number,
    expiryDate: source.expiry_date,
  });
  const prior = (
    await client.query(
      "SELECT * FROM inventory_transactions WHERE idempotency_key=$1",
      [`${input.idempotencyKey}:debit`],
    )
  ).rows[0];
  if (prior && String(prior.metadata?.receiptMovementId) !== String(source.id))
    throw fail(
      409,
      "Idempotency key belongs to another receipt movement",
      "IDEMPOTENCY_CONFLICT",
    );
  if (!prior) {
    if (from === "AVAILABLE") {
      // Receiving remains historical after issue. It is not proof that this receipt's
      // units remain in a pooled balance; do not borrow another receipt's stock.
      const consumed = (
        await client.query(
          `WITH RECURSIVE issues AS (
        SELECT id,quantity FROM inventory_transactions
        WHERE institute_id=$1 AND warehouse_id=$2 AND stock_item_id=$3 AND id>$4
        AND movement_type='ISSUE' AND reversal_of_movement_id IS NULL
        AND EXISTS(SELECT 1 FROM inventory_transaction_allocations a WHERE a.inventory_transaction_id=inventory_transactions.id
        AND a.batch_number IS NOT DISTINCT FROM $5::text AND a.lot_number IS NOT DISTINCT FROM $6::text
        AND a.serial_number IS NOT DISTINCT FROM $7::text AND a.expiry_date IS NOT DISTINCT FROM $8::date)
        UNION ALL SELECT rv.id,rv.quantity FROM inventory_transactions rv JOIN issues p ON rv.reversal_of_movement_id=p.id
        WHERE rv.institute_id=$1 AND rv.warehouse_id=$2 AND rv.stock_item_id=$3
      ) SELECT COALESCE(sum(quantity),0)<0 consumed FROM issues`,
          [
            source.institute_id,
            source.warehouse_id,
            source.stock_item_id,
            source.id,
            source.batch_number,
            source.lot_number,
            source.serial_number,
            source.expiry_date,
          ],
        )
      ).rows[0].consumed;
      if (consumed)
        throw fail(
          409,
          "Receipt-specific stock attribution requires review after pooled stock has been issued",
          "RECEIPT_STATUS_SOURCE_CONFLICT",
        );
    }
    const available = (
      await client.query(
        "SELECT public.canonical_receipt_inventory_quantity($1,$2,$3,$4)::text quantity",
        [source.receipt_item_id, source.institute_id, from, source.id],
      )
    ).rows[0].quantity;
    if (available == null)
      throw fail(
        409,
        "Receipt source requires reconciliation before stock status transfer",
        "RECEIPT_STATUS_SOURCE_CONFLICT",
      );
    if (compare(quantity, available) > 0)
      throw fail(
        409,
        "Status transfer exceeds the remaining quantity of this receipt source",
        "RECEIPT_STATUS_CAPACITY_EXCEEDED",
      );
  }
  return { source, actor, quantity };
}
async function record(client, context, result, from, to, reason) {
  if (!context) return;
  const { source, actor } = context;
  const posted = await client.query(
    `SELECT sum(quantity)::text quantity,bool_and(batch_number IS NOT DISTINCT FROM $2::text AND lot_number IS NOT DISTINCT FROM $3::text AND serial_number IS NOT DISTINCT FROM $4::text AND expiry_date IS NOT DISTINCT FROM $5::date) identity_matches FROM inventory_transactions WHERE id=ANY($1::bigint[])`,
    [
      result.credits.map((c) => c.movement.id),
      source.batch_number,
      source.lot_number,
      source.serial_number,
      source.expiry_date,
    ],
  );
  if (!posted.rows[0]?.identity_matches)
    throw fail(
      409,
      "Allocated stock does not match receipt tracking identity",
      "RECEIPT_STATUS_SOURCE_CONFLICT",
    );
  if (compare(posted.rows[0]?.quantity || "0", context.quantity) !== 0)
    throw fail(
      409,
      "Inventory allocation cannot represent this receipt status transfer exactly",
      "RECEIPT_STATUS_PRECISION_REQUIRED",
    );
  let inserted = 0;
  for (const credit of result.credits) {
    const movement = credit.movement;
    const value = await client.query(
      `INSERT INTO goods_receipt_inventory_status_links(receipt_item_id,receipt_movement_id,debit_movement_id,credit_movement_id,institute_id,warehouse_id,actor_id,from_status,to_status,quantity,reason)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(credit_movement_id) DO NOTHING RETURNING id`,
      [
        source.receipt_item_id,
        source.id,
        result.debit.movement.id,
        movement.id,
        source.institute_id,
        source.warehouse_id,
        actor.id,
        from,
        to,
        movement.quantity,
        reason,
      ],
    );
    inserted += value.rowCount;
  }
  if (inserted) {
    await audit.writeAuditEvent({
      client,
      entityType: "goods_receipt",
      entityId: source.receipt_id,
      action: "goods_receipt.stock_status.changed",
      actorUserId: actor.id,
      instituteId: source.institute_id,
      requestId: source.request_id,
      reason,
      metadata: {
        receiptItemId: source.receipt_item_id,
        receiptMovementId: source.id,
        debitMovementId: result.debit.movement.id,
        creditMovementIds: result.credits.map((c) => c.movement.id),
        fromStatus: from,
        toStatus: to,
        quantity: context.quantity,
      },
    });
  }
  await outbox.enqueueNotification(client, {
    type: "GOODS_RECEIPT_STOCK_STATUS_CHANGED",
    entityType: "receipt_stock_status",
    entityId: result.debit.movement.id,
    idempotencyKey: `receipt-stock-status:${result.debit.movement.id}`,
    payload: {
      requestedItemIds: [source.requested_item_id],
      requestId: source.request_id,
      instituteId: source.institute_id,
      actorId: actor.id,
      supplierId: source.supplier_id,
      receiptMovementId: source.id,
      fromStatus: from,
      toStatus: to,
    },
  });
}
module.exports = { resolve, record };
