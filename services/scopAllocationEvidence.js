"use strict";
// Read-only attribution to existing P2P/warehouse evidence. No stock/inspection/finance writer.
const {
  fail,
  id,
  progress,
  scaled,
} = require("../policies/scopFoundationPolicy");
const norm = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
const same = (a, b) => a != null && b != null && String(a) === String(b);
const issuedStates = ["PO_ISSUED", "PO_PARTIAL", "PO_DELIVERED", "PO_CLOSED"];
async function po(client, profile, lineId, allocation) {
  const row = (
    await client.query(
      `SELECT pi.*,p.request_id AS parent_request_id,p.status AS po_status,p.contract_id AS po_contract_id,s.institute_id AS supplier_institute_id
    FROM purchase_order_items pi JOIN purchase_orders p ON p.id=pi.purchase_order_id JOIN suppliers s ON s.id=p.supplier_id WHERE pi.id=$1 AND ${require("./p2pReadScope").predicate("purchaseOrder", "p", "$2")} FOR SHARE OF pi,p,s`,
      [id(lineId), profile.institute_id],
    )
  ).rows[0];
  if (
    !row ||
    !same(row.requested_item_id, profile.requested_item_id) ||
    !same(row.parent_request_id, profile.request_id) ||
    (row.request_id != null && !same(row.request_id, profile.request_id)) ||
    (row.request_item_id != null &&
      !same(row.request_item_id, profile.requested_item_id)) ||
    (row.supplier_institute_id != null &&
      !same(row.supplier_institute_id, profile.institute_id))
  )
    throw fail(404, "PO evidence not found", "SCOP_REFERENCE_NOT_FOUND");
  if (!issuedStates.includes(row.po_status))
    throw fail(409, "PO evidence is not issued", "SCOP_EVIDENCE_STATE");
  // Initial foundation supports only immutable, exact base-UOM snapshots. Never guess a conversion.
  if (
    norm(row.base_uom) !== norm(profile.uom) ||
    !row.conversion_factor ||
    Number(row.conversion_factor) <= 0 ||
    row.line_type === "SERVICE"
  )
    throw fail(
      409,
      "A compatible goods/UOM snapshot is required",
      "SCOP_UOM_UNSUPPORTED",
    );
  if (
    !["LOCAL_PROCUREMENT", "CONTRACT", "CENTRAL_SUPPLY"].includes(
      allocation.source_kind,
    ) ||
    (allocation.source_kind === "CONTRACT" &&
      !same(row.po_contract_id, allocation.contract_id))
  )
    throw fail(
      409,
      "PO source does not match allocation",
      "SCOP_SOURCE_MISMATCH",
    );
  return row;
}
async function bind(client, profile, allocation, kind, value, actor) {
  const column = {
    PO_LINE: "po_line_id",
    RECEIPT_LINE: "receipt_line_id",
    SUPPLY_LINE: "supply_line_id",
  }[kind];
  if (typeof column !== "string") throw fail(400, "Unsupported evidence kind");
  if (kind === "PO_LINE") {
    const line = await po(client, profile, value, allocation);
    const other = (
      await client.query(
        `SELECT pi.line_type FROM scop_allocation_evidence e JOIN purchase_order_items pi ON pi.id=e.po_line_id WHERE e.allocation_id=$1`,
        [allocation.id],
      )
    ).rows;
    const supply = (
      await client.query(
        "SELECT id FROM scop_allocation_evidence WHERE allocation_id=$1 AND supply_line_id IS NOT NULL",
        [allocation.id],
      )
    ).rowCount;
    if (
      other.some(
        (x) =>
          (x.line_type === "INVENTORY") !== (line.line_type === "INVENTORY"),
      ) ||
      (line.line_type !== "INVENTORY" && supply)
    )
      throw fail(
        409,
        "Use separate allocations for direct delivery and warehouse issue",
        "SCOP_MIXED_DELIVERY",
      );
  }
  if (kind === "RECEIPT_LINE") {
    const r = (
      await client.query(
        `SELECT gi.*,gr.request_id,gr.purchase_order_id FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id=gi.goods_receipt_id WHERE gi.id=$1 FOR SHARE OF gi,gr`,
        [id(value)],
      )
    ).rows[0];
    if (
      !r ||
      !same(r.request_id, profile.request_id) ||
      !same(r.requested_item_id, profile.requested_item_id)
    )
      throw fail(404, "Receipt evidence not found", "SCOP_REFERENCE_NOT_FOUND");
    const line = await po(
      client,
      profile,
      r.purchase_order_item_id,
      allocation,
    );
    if (!same(line.purchase_order_id, r.purchase_order_id))
      throw fail(404, "Receipt ancestry mismatch", "SCOP_REFERENCE_NOT_FOUND");
    if (r.warehouse_id != null) {
      const w = (
        await client.query(
          "SELECT institute_id FROM warehouses WHERE id=$1 FOR SHARE",
          [r.warehouse_id],
        )
      ).rows[0];
      if (!w || !same(w.institute_id, profile.institute_id))
        throw fail(
          404,
          "Receipt warehouse not found",
          "SCOP_REFERENCE_NOT_FOUND",
        );
    }
    if (
      !(
        await client.query(
          "SELECT id FROM scop_allocation_evidence WHERE allocation_id=$1 AND po_line_id=$2",
          [allocation.id, line.id],
        )
      ).rowCount
    )
      throw fail(
        409,
        "Bind the issued PO line to this allocation first",
        "SCOP_PO_BINDING_REQUIRED",
      );
  }
  if (kind === "SUPPLY_LINE") {
    if (
      (
        await client.query(
          `SELECT e.id FROM scop_allocation_evidence e JOIN purchase_order_items pi ON pi.id=e.po_line_id WHERE e.allocation_id=$1 AND pi.line_type<>'INVENTORY'`,
          [allocation.id],
        )
      ).rowCount
    )
      throw fail(
        409,
        "Direct delivery cannot also be credited as warehouse issue",
        "SCOP_MIXED_DELIVERY",
      );
    const r = (
      await client.query(
        `SELECT w.*,r.institute_id,r.department_id AS request_department,r.supply_warehouse_id,si.supplied_quantity,si.request_id AS supplied_request_id,si.warehouse_id AS supplied_warehouse_id,si.department_id AS supplied_department_id FROM warehouse_supplied_items si JOIN warehouse_supply_items w ON w.id=si.item_id JOIN requests r ON r.id=w.request_id WHERE si.id=$1 FOR SHARE OF si,w,r`,
        [id(value)],
      )
    ).rows[0];
    const original =
      profile.requested_item_id != null
        ? same(r?.requested_item_id, profile.requested_item_id)
        : same(r?.id, profile.warehouse_supply_item_id);
    if (
      !r ||
      !original ||
      !same(r.supplied_request_id, r.request_id) ||
      (r.supplied_department_id != null &&
        !same(r.supplied_department_id, r.request_department)) ||
      (r.supplied_warehouse_id != null &&
        !same(r.supplied_warehouse_id, r.supply_warehouse_id)) ||
      !same(r.institute_id, profile.institute_id) ||
      !same(r.request_department, profile.requesting_function_id)
    )
      throw fail(404, "Supply evidence not found", "SCOP_REFERENCE_NOT_FOUND");
    if (
      scaled(r.supplied_quantity) === 0n ||
      scaled(r.supplied_quantity) > scaled(allocation.quantity)
    )
      throw fail(
        409,
        "Whole issue line exceeds allocation",
        "SCOP_EVIDENCE_CONFLICT",
      );
    if (
      allocation.warehouse_id != null &&
      !same(allocation.warehouse_id, r.supply_warehouse_id)
    )
      throw fail(
        409,
        "Supply warehouse differs from allocation",
        "SCOP_SOURCE_MISMATCH",
      );
  }
  return (
    await client.query(
      `INSERT INTO scop_allocation_evidence(allocation_id,${column},created_by) VALUES($1,$2,$3) RETURNING *`,
      [allocation.id, id(value), actor.id],
    )
  ).rows[0];
}
async function project(client, profile, allocation) {
  // Snapshot rows and reversal descendants are locked through command/closure audit commit.
  await client.query(
    `WITH RECURSIVE contributing AS (
    SELECT m.id FROM inventory_transactions m WHERE m.institute_id=$2 AND (
      (m.source_document_type='goods_receipt' AND EXISTS(SELECT 1 FROM scop_allocation_evidence e WHERE e.allocation_id=$1 AND e.receipt_line_id::text=m.source_document_line_id)) OR
      (m.source_document_type='warehouse_supply' AND EXISTS(SELECT 1 FROM scop_allocation_evidence e JOIN warehouse_supplied_items si ON si.id=e.supply_line_id WHERE e.allocation_id=$1 AND si.id::text=m.source_document_line_id AND si.request_id::text=m.source_document_id)))
    UNION SELECT rv.id FROM inventory_transactions rv JOIN contributing p ON rv.reversal_of_movement_id=p.id)
    SELECT m.id FROM inventory_transactions m JOIN contributing c ON c.id=m.id ORDER BY m.id FOR SHARE OF m`,
    [allocation.id, profile.institute_id],
  );
  const lines = (
    await client.query(
      "SELECT po_line_id FROM scop_allocation_evidence WHERE allocation_id=$1 AND po_line_id IS NOT NULL",
      [allocation.id],
    )
  ).rows;
  for (const line of lines) {
    try {
      await po(client, profile, line.po_line_id, allocation);
    } catch (e) {
      if (![404, 409].includes(e.statusCode)) throw e;
      const denied = progress(allocation.quantity, {});
      denied.evidence_conflict = true;
      denied.physical_state = "EVIDENCE_CONFLICT";
      return denied;
    }
  }
  const facts = (
    await client.query(
      `WITH bound_po AS (
    SELECT pi.*,p.status,pi.quantity*pi.conversion_factor AS demand_ordered FROM scop_allocation_evidence e JOIN purchase_order_items pi ON pi.id=e.po_line_id JOIN purchase_orders p ON p.id=pi.purchase_order_id
      WHERE e.allocation_id=$1 AND p.request_id=$2 AND pi.requested_item_id=$3 AND p.status IN ('PO_ISSUED','PO_PARTIAL','PO_DELIVERED','PO_CLOSED')
  ), receipts AS (
    SELECT gi.*,pi.conversion_factor AS factor,pi.line_type,
      GREATEST(gi.received_quantity-gi.damaged_quantity-gi.short_quantity,0) AS usable,
      CASE WHEN gi.technical_inspection_required THEN gi.technical_accepted_quantity ELSE GREATEST(gi.received_quantity-gi.damaged_quantity-gi.short_quantity,0) END AS technical,
      canonical_receipt_inventory_quantity(gi.id,$4,'AVAILABLE',NULL) AS available,
      canonical_receipt_inventory_quantity(gi.id,$4,'QUARANTINE',NULL) AS quarantine
    FROM scop_allocation_evidence e JOIN goods_receipt_items gi ON gi.id=e.receipt_line_id JOIN bound_po pi ON pi.id=gi.purchase_order_item_id
      JOIN goods_receipts gr ON gr.id=gi.goods_receipt_id AND gr.purchase_order_id=pi.purchase_order_id AND gr.request_id=$2
    WHERE e.allocation_id=$1 AND gi.requested_item_id=$3
  ) SELECT
    COALESCE((SELECT SUM(demand_ordered) FROM bound_po),0) AS ordered,
    COALESCE(bool_or(line_type='INVENTORY' AND available IS NULL),false) AS invalid_inventory_evidence,
    (SELECT count(*) FROM scop_allocation_evidence WHERE allocation_id=$1 AND receipt_line_id IS NOT NULL)<>(SELECT count(*) FROM receipts) AS invalid_ancestry,
    COALESCE(SUM(received_quantity*factor),0) AS received,
    COALESCE(SUM(CASE WHEN line_type='INVENTORY' THEN LEAST(technical*factor,GREATEST(available,0)) WHEN stock_status='AVAILABLE' THEN technical*factor ELSE 0 END),0) AS accepted,
    COALESCE(SUM(CASE WHEN line_type<>'INVENTORY' AND stock_status='AVAILABLE' THEN technical*factor ELSE 0 END),0) AS direct_accepted,
    COALESCE(SUM((damaged_quantity+technical_rejected_quantity)*factor),0) AS rejected,
    COALESCE(SUM(short_quantity*factor),0) AS short,
    COALESCE(SUM(CASE WHEN technical_inspection_required THEN GREATEST(usable-technical-technical_rejected_quantity,0)*factor ELSE 0 END),0) AS pending_inspection,
    COALESCE(SUM(CASE WHEN line_type='INVENTORY' THEN LEAST(technical*factor,GREATEST(quarantine,0)) WHEN stock_status='QUARANTINE' THEN technical*factor ELSE 0 END),0) AS quarantined,
    COALESCE((SELECT SUM(canonical_supply_line_quantity(e.supply_line_id,$4)) FROM scop_allocation_evidence e WHERE e.allocation_id=$1 AND e.supply_line_id IS NOT NULL),0) AS issued
    FROM receipts`,
      [
        allocation.id,
        profile.request_id,
        profile.requested_item_id,
        profile.institute_id,
      ],
    )
  ).rows[0];
  const result = progress(allocation.quantity, facts);
  if (facts.invalid_inventory_evidence || facts.invalid_ancestry) {
    result.evidence_conflict = true;
    result.physical_state = "EVIDENCE_CONFLICT";
  }
  // Evidence can change after binding (reversal/cancellation/UOM corruption). Revalidate every read.
  return result;
}
module.exports = { bind, project };
