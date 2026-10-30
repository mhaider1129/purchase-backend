"use strict";
const quantities = require("./receiptInspectionQuantities");
const { error } = require("./preprocurementTechnicalReviewModel");
async function assertInvoice(client, invoiceId) {
  // Use the same PO serialization boundary as canonical matching. Two overrides
  // must not independently consume the same technically accepted units.
  const po = (
    await client.query(
      "SELECT purchase_order_id FROM supplier_invoices WHERE id=$1",
      [invoiceId],
    )
  ).rows[0];
  if (po?.purchase_order_id)
    await client.query(
      "SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE",
      [po.purchase_order_id],
    );
  const rows = (
    await client.query(
      `SELECT ii.purchase_order_item_id FROM invoice_items ii WHERE ii.supplier_invoice_id=$1 GROUP BY ii.purchase_order_item_id HAVING EXISTS(SELECT 1 FROM goods_receipt_items checked WHERE checked.purchase_order_item_id=ii.purchase_order_item_id AND ${quantities.required("checked")}) AND SUM(ii.quantity)+COALESCE((SELECT SUM(prior.quantity) FROM invoice_items prior JOIN supplier_invoices si ON si.id=prior.supplier_invoice_id WHERE prior.purchase_order_item_id=ii.purchase_order_item_id AND si.id<>$1 AND si.status IN ('MATCH_VERIFIED','FINANCE_REVIEW_PENDING','FINANCE_VERIFIED','AP_VOUCHER_CREATED','AP_POSTED','PAYMENT_PENDING','PARTIALLY_PAID','PAID','CLOSED')),0)>COALESCE((SELECT SUM(${quantities.accepted()}) FROM goods_receipt_items gri WHERE gri.purchase_order_item_id=ii.purchase_order_item_id),0)`,
      [invoiceId],
    )
  ).rows;
  if (rows.length)
    throw error(
      409,
      "Cumulative invoice quantities include units without applied technical acceptance; matching overrides cannot release held/rejected deliveries",
      "TECHNICAL_RECEIPT_NOT_ACCEPTED",
    );
}
module.exports = { assertInvoice };
