"use strict";
const scope = require("./p2pReadScope");
const receipt = require("./receiptInspectionQuantities");
const finance = require("./contractFinanceIntegrationService");
async function project(client, contract, actor) {
  await finance.schema(client);
  const row = (
    await client.query(
      `WITH
    pos AS MATERIALIZED (SELECT p.* FROM purchase_orders p WHERE p.contract_id=$1 AND ${scope.predicate("purchaseOrder", "p", "$2")}),
    invoices AS MATERIALIZED (SELECT i.* FROM supplier_invoices i JOIN pos p ON p.id=i.purchase_order_id
      WHERE i.contract_id=$1 AND ${scope.predicate("invoice", "i", "$2")}),
    active_invoices AS (SELECT * FROM invoices WHERE UPPER(status) NOT IN ('CANCELLED','VOIDED','DECLINED','SUPERSEDED','REPLACED')),
    payables AS MATERIALIZED (SELECT a.* FROM ap_payables a JOIN active_invoices i ON i.id=a.supplier_invoice_id
      JOIN ap_vouchers v ON v.id=a.ap_voucher_id AND v.supplier_invoice_id=i.id AND lower(v.voucher_status)='posted'
      WHERE a.request_id=i.request_id AND a.supplier_id=i.supplier_id AND UPPER(a.currency)=UPPER(i.currency)
      AND EXISTS(SELECT 1 FROM finance_postings f WHERE f.ap_voucher_id=v.id AND f.supplier_invoice_id=i.id AND f.request_id=i.request_id AND lower(f.posting_status)='posted')),
    allocations AS MATERIALIZED (SELECT a.*,p.id payment_id,p.payment_reference,p.payment_status,p.currency,p.paid_at,p.amount_paid FROM payment_allocations a
      JOIN payables ap ON ap.id=a.ap_payable_id JOIN payment_records p ON p.id=a.payment_record_id
      WHERE p.supplier_invoice_id=ap.supplier_invoice_id AND p.ap_voucher_id=ap.ap_voucher_id AND p.request_id=ap.request_id
        AND UPPER(p.currency)=UPPER(ap.currency) AND lower(p.payment_status)='paid' AND p.reversal_of_payment_id IS NULL)
    SELECT
      (SELECT COUNT(*) FROM purchase_orders WHERE contract_id=$1)<>(SELECT COUNT(*) FROM pos) OR
      (SELECT COUNT(*) FROM supplier_invoices WHERE contract_id=$1)<>(SELECT COUNT(*) FROM invoices) AS source_conflict,
      EXISTS(SELECT 1 FROM payment_records p JOIN invoices i ON i.id=p.supplier_invoice_id WHERE p.reversal_of_payment_id IS NOT NULL OR
        (lower(p.payment_status)='paid' AND (UPPER(p.currency) IS DISTINCT FROM UPPER(i.currency) OR p.amount_paid IS DISTINCT FROM (SELECT SUM(a.amount) FROM allocations a WHERE a.payment_id=p.id)))) OR
      EXISTS(SELECT 1 FROM payables ap WHERE ap.payable_status NOT IN ('OPEN','PARTIALLY_PAID','PAID')) OR
      EXISTS(SELECT 1 FROM allocations a WHERE a.amount<=0) OR
      (SELECT COUNT(*) FROM ap_payables a JOIN invoices i ON i.id=a.supplier_invoice_id)<>(SELECT COUNT(*) FROM payables) AS unsupported_reversal,
      EXISTS(SELECT 1 FROM payables ap JOIN invoices i ON i.id=ap.supplier_invoice_id JOIN ap_vouchers v ON v.id=ap.ap_voucher_id WHERE
        ap.invoice_total IS DISTINCT FROM i.total_amount OR v.total_amount IS DISTINCT FROM i.total_amount OR
        ap.open_balance IS DISTINCT FROM ap.invoice_total-COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.ap_payable_id=ap.id),0) OR
        EXISTS(SELECT 1 FROM finance_postings f WHERE f.ap_voucher_id=v.id AND lower(f.posting_status)='posted' AND f.liability_recognized_amount IS DISTINCT FROM ap.invoice_total)) AS balance_conflict,

      (SELECT COALESCE(SUM(total_amount),0)::text FROM pos WHERE status IN ${finance.RESERVED}) approved_po_commitments,
      (SELECT COALESCE(SUM((${receipt.accepted("gri")})*pi.unit_price),0)::text FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id JOIN pos p ON p.id=gr.purchase_order_id JOIN purchase_order_items pi ON pi.id=gri.purchase_order_item_id AND pi.purchase_order_id=p.id) received_value,
      (SELECT COALESCE(SUM(total_amount),0)::text FROM active_invoices) invoiced_value,
      (SELECT COALESCE(SUM(invoice_total),0)::text FROM payables) posted_payable,
      (SELECT COALESCE(SUM(amount),0)::text FROM allocations) paid_amount,
      (SELECT COALESCE(SUM(ap.invoice_total-COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.ap_payable_id=ap.id),0)),0)::text FROM payables ap) outstanding_ap_balance,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id::text,'number',po_number,'status',status,'amount',total_amount::text) ORDER BY id),'[]') FROM pos) purchase_orders,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id::text,'number',invoice_number,'status',status,'amount',total_amount::text) ORDER BY id),'[]') FROM invoices) invoices,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id::text,'invoice_id',supplier_invoice_id::text,'status',payable_status,'amount',invoice_total::text) ORDER BY id),'[]') FROM payables) payables,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('allocation_id',id::text,'payment_id',payment_id::text,'payable_id',ap_payable_id::text,'amount',amount::text,'reference',payment_reference) ORDER BY id),'[]') FROM allocations) allocations`,
      [contract.id, actor.institute_id],
    )
  ).rows[0];
  if (row.source_conflict || row.unsupported_reversal || row.balance_conflict)
    throw finance.fail(
      "Canonical source conflicts or unsupported reversals require finance reconciliation; totals are unavailable",
      "CONTRACT_RECONCILIATION_REQUIRED",
    );
  let reconciliationRequired = false;
  try {
    await finance.reconciliation(client, {
      contract_id: contract.id,
      request_id: contract.source_request_id,
      supplier_id: contract.supplier_id,
    });
  } catch (error) {
    if (error.code !== "CONTRACT_RECONCILIATION_REQUIRED") throw error;
    reconciliationRequired = true;
  }
  const { subtractDecimal } = require("./purchaseOrderTotalsService");
  return {
    contract_id: String(contract.id),
    request_id:
      contract.source_request_id == null
        ? null
        : String(contract.source_request_id),
    currency: contract.currency,
    source_model:
      contract.contract_type === "purchasing" && contract.source_request_id
        ? "PO_BACKED_PURCHASING"
        : "UNSUPPORTED_CONTRACT_SOURCE",
    reconciliation_required: reconciliationRequired,
    metrics: {
      contract_ceiling: String(contract.contract_value ?? "0"),
      approved_po_commitments: row.approved_po_commitments,
      received_value: row.received_value,
      invoiced_value: row.invoiced_value,
      posted_payable: row.posted_payable,
      paid_amount: row.paid_amount,
      outstanding_ap_balance: row.outstanding_ap_balance,
      remaining_contract_capacity: subtractDecimal(
        finance.ceiling(contract),
        row.approved_po_commitments,
      ),
    },
    documents: {
      purchase_orders: row.purchase_orders,
      invoices: row.invoices,
      payables: row.payables,
      allocations: row.allocations,
    },
  };
}
module.exports = { project };
