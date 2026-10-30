"use strict";
const { error, snapshotItem, fingerprint } = require("./deviceDemoModel");
const { fulfilledItemSql } = require("./requestFulfillmentSql");
const { writeAuditEvent } = require("./auditService");
// Called only for award, PO creation and procurement registration, in their transaction.
async function assertDemoSelection(client, item, actor, command, context = {}) {
  const itemId = item.id || item.item_id;
  await client.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended('device-demo:'||$1::text,0))",
    [itemId],
  );
  const w = (
    await client.query(
      "SELECT * FROM public.device_demo_workspaces WHERE request_item_id=$1 ORDER BY id DESC LIMIT 1",
      [itemId],
    )
  ).rows[0];
  if (!w) return;
  if (w.status !== "SELECTED")
    throw error(
      409,
      "Complete the device demos and obtain COO selection approval before procurement",
      "DEVICE_DEMO_SELECTION_REQUIRED",
    );
  const current = (
    await client.query(
      `SELECT ri.*,r.department_id,r.institute_id,r.status AS request_status FROM public.requested_items ri JOIN public.requests r ON r.id=ri.request_id WHERE ri.id=$1 AND ri.request_id=$2 AND NOT ${fulfilledItemSql("ri")} AND lower(trim(COALESCE(ri.approval_status,'')))<>'rejected' AND lower(trim(COALESCE(ri.procurement_status,''))) NOT IN ('cancelled','canceled','not_procured','unable_to_procure')`,
      [itemId, w.request_id],
    )
  ).rows[0];
  if (
    !current ||
    String(current.institute_id) !== String(w.institute_id) ||
    String(current.department_id) !== String(w.requesting_department_id) ||
    fingerprint(snapshotItem(current)) !== w.item_fingerprint
  )
    throw error(
      409,
      "Device requirement changed after the demo selection; repeat the demo selection process",
      "DEVICE_DEMO_STALE",
    );
  if (
    !["approved", "partially procured", "partially_procured"].includes(
      String(current.request_status).trim().toLowerCase(),
    )
  )
    throw error(
      409,
      "The purchase request must complete its normal approval chain before procurement",
      "DEVICE_DEMO_REQUEST_NOT_APPROVED",
    );
  const selection = (
    await client.query(
      `SELECT s.*,d.supplier_id,d.approved_product_id,d.supplier_catalog_item_id FROM public.device_demo_selections s JOIN public.device_demo_candidates d ON d.id=s.demo_id AND d.workspace_id=s.workspace_id WHERE s.workspace_id=$1 ORDER BY s.id DESC LIMIT 1`,
      [w.id],
    )
  ).rows[0];
  if (
    selection?.status !== "APPROVED" ||
    !selection.decided_by ||
    !selection.signature
  )
    throw error(
      409,
      "An authenticated COO-approved selection is required",
      "DEVICE_DEMO_SELECTION_REQUIRED",
    );
  if (
    !context.supplier_id ||
    String(context.supplier_id) !== String(selection.supplier_id)
  )
    throw error(
      409,
      "Procurement must use the supplier selected and approved by the COO; use a supplier-specific procurement entry",
      "DEVICE_DEMO_SUPPLIER_MISMATCH",
    );
  if (selection.approved_product_id) {
    if (command === "register_procurement") {
      const ordered = (
        await client.query(
          `SELECT EXISTS(SELECT 1 FROM public.purchase_order_items poi JOIN public.purchase_orders po ON po.id=poi.purchase_order_id WHERE poi.requested_item_id=$1 AND po.supplier_id=$2 AND poi.approved_product_id=$3 AND poi.supplier_catalog_item_id=$4 AND po.status NOT IN ('PO_CANCELLED','CANCELLED')) AS ordered`,
          [
            itemId,
            selection.supplier_id,
            selection.approved_product_id,
            selection.supplier_catalog_item_id,
          ],
        )
      ).rows[0];
      if (!ordered?.ordered)
        throw error(
          409,
          "Create a PO for the selected catalog device before registering its procurement",
          "DEVICE_DEMO_SELECTED_PO_REQUIRED",
        );
    } else if (
      String(context.approved_product_id) !==
        String(selection.approved_product_id) ||
      String(context.supplier_catalog_item_id) !==
        String(selection.supplier_catalog_item_id)
    )
      throw error(
        409,
        "Procurement must use the exact device product and supplier catalog approved by the COO",
        "DEVICE_DEMO_PRODUCT_MISMATCH",
      );
  }
  await writeAuditEvent({
    client,
    entityType: "device_demo_workspace",
    entityId: w.id,
    requestId: w.request_id,
    instituteId: w.institute_id,
    actorUserId: actor?.id,
    action: "DEVICE_DEMO_PROCUREMENT_VALIDATED",
    metadata: {
      selection_id: selection.id,
      supplier_id: selection.supplier_id,
      request_item_id: itemId,
      command,
    },
  });
}
module.exports = { assertDemoSelection };
