"use strict";
const m = require("./surgicalConsignmentModel");
async function bound(db, po, actor) {
  if (
    !(
      await db.query(
        "SELECT to_regclass('public.surgical_consignment_billing_lines') IS NOT NULL AS surgical_consignment_available",
      )
    ).rows[0]?.surgical_consignment_available
  )
    return null;
  const c = (
    await db.query(
      "SELECT * FROM public.surgical_consignment_cases WHERE billing_po_id=$1 FOR SHARE",
      [po.id],
    )
  ).rows[0];
  if (!c) return null;
  if (
    actor?.institute_id &&
    String(actor.institute_id) !== String(c.institute_id)
  )
    throw m.error(403, "Surgical consignment is outside your institute");
  if (
    !["BILLING_LINKED", "CLOSED"].includes(c.status) ||
    String(po.supplier_id) !== String(c.supplier_id) ||
    String(po.currency).trim() !== c.currency.trim()
  )
    throw m.error(
      409,
      "A released, reconciled surgical consignment and matching supplier/currency are required",
    );
  const lines = (
    await db.query(
      "SELECT b.*,l.batch_number FROM public.surgical_consignment_billing_lines b JOIN public.surgical_consignment_receipt_lines l ON l.id=b.receipt_line_id WHERE b.case_id=$1",
      [c.id],
    )
  ).rows;
  return { c, lines };
}
async function invoice(db, po, inputs, currency, actor) {
  const data = await bound(db, po, actor);
  if (!data) return;
  if (String(currency).toUpperCase() !== data.c.currency.trim())
    throw m.error(
      409,
      "Consignment invoice currency must match the agreed currency",
    );
  const ids = inputs.map((i) => String(i.purchase_order_item_id));
  if (new Set(ids).size !== ids.length)
    throw m.error(400, "Do not duplicate consignment invoice lines");
  for (const row of inputs) {
    const line = data.lines.find(
      (l) =>
        String(l.purchase_order_item_id) === String(row.purchase_order_item_id),
    );
    if (
      !line ||
      m.compareDecimal(row.quantity, 0) <= 0 ||
      m.compareDecimal(row.unit_price, line.unit_price) !== 0
    )
      throw m.error(
        409,
        "Invoice only the confirmed used lots at their agreed unit prices",
        "SURGICAL_CONSIGNMENT_INVOICE_MISMATCH",
      );
    const prior = (
      await db.query(
        "SELECT COALESCE(sum(l.quantity),0)::text AS quantity FROM public.invoice_items l JOIN public.supplier_invoices i ON i.id=l.supplier_invoice_id WHERE l.purchase_order_item_id=$1 AND i.status NOT IN ('VOID','VOIDED','CANCELLED')",
        [row.purchase_order_item_id],
      )
    ).rows[0].quantity;
    if (
      m.compareDecimal(
        require("./purchaseOrderTotalsService").addDecimal(prior, row.quantity),
        line.used_quantity,
      ) > 0
    )
      throw m.error(
        409,
        "Cumulative invoices exceed the clinically confirmed used quantity",
        "SURGICAL_CONSIGNMENT_OVERBILLING",
      );
  }
}
async function receipt(db, po, inputs, actor) {
  const data = await bound(db, po, actor);
  if (!data) return;
  for (const row of inputs) {
    const line = data.lines.find(
      (l) =>
        String(l.purchase_order_item_id) === String(row.purchase_order_item_id),
    );
    if (
      !line ||
      row.line_type !== "NON_INVENTORY" ||
      m.compareDecimal(row.received_quantity, line.used_quantity) > 0 ||
      m.compareDecimal(row.damaged_quantity || 0, 0) !== 0 ||
      m.compareDecimal(row.short_quantity || 0, 0) !== 0 ||
      String(row.batch_number) !== String(line.batch_number)
    )
      throw m.error(
        409,
        "Only a documentary non-inventory receipt of confirmed used units and the original lot is allowed",
        "SURGICAL_CONSIGNMENT_RECEIPT_MISMATCH",
      );
  }
}
module.exports = { invoice, receipt };
