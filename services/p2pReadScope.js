"use strict";
const pool = require("../config/db");
const { loadActor, authorizeCommand, TABLES } = require("./p2pAuthorization");
// Only server-defined aliases/kinds reach this generator. Scope values are bound
// parameters, including counts/aggregates/export source queries.
function predicate(kind, a, parameter = "$1") {
  const root = (requestId) =>
    `EXISTS(SELECT 1 FROM requests scope_r JOIN departments scope_d ON scope_d.id=scope_r.department_id WHERE scope_r.id=${requestId} AND scope_r.institute_id=${parameter} AND scope_d.institute_id=scope_r.institute_id)`;
  const supplier = (supplierId, requestId) =>
    `EXISTS(SELECT 1 FROM suppliers scope_s JOIN requests scope_sr ON scope_sr.id=${requestId} WHERE scope_s.id=${supplierId} AND ((to_jsonb(scope_s)->>'institute_id') IS NULL OR (to_jsonb(scope_s)->>'institute_id')=scope_sr.institute_id::text))`;
  const lineReference = (line, owner) => {
    const types = {
      REQUEST: ["requests", "id"],
      PURCHASE_ORDER: ["purchase_orders", "request_id"],
      PO: ["purchase_orders", "request_id"],
      AP_INVOICE: ["supplier_invoices", "request_id"],
      SUPPLIER_INVOICE: ["supplier_invoices", "request_id"],
      INVOICE: ["supplier_invoices", "request_id"],
      AP_VOUCHER: ["ap_vouchers", "request_id"],
      ACCOUNTS_PAYABLE: ["ap_payables", "request_id"],
    };
    return (
      "COALESCE((" +
      Object.entries(types)
        .map(
          ([type, [table, column]]) =>
            `(UPPER(${line}.reference_type)='${type}' AND EXISTS(SELECT 1 FROM ${table} scope_ref WHERE scope_ref.id::text=${line}.reference_id::text AND scope_ref.${column}=${owner}))`,
        )
        .join(" OR ") +
      "),FALSE)"
    );
  };
  const po = (p) =>
    `(${root(`${p}.request_id`)} AND ${supplier(`${p}.supplier_id`, `${p}.request_id`)} AND NOT EXISTS(SELECT 1 FROM purchase_order_items scope_pi LEFT JOIN requested_items scope_i ON scope_i.id=scope_pi.requested_item_id LEFT JOIN procurement_awards scope_a ON scope_a.id=scope_pi.award_id WHERE scope_pi.purchase_order_id=${p}.id AND (scope_i.id IS NULL OR scope_i.request_id IS DISTINCT FROM ${p}.request_id OR (scope_pi.award_id IS NOT NULL AND (scope_a.id IS NULL OR scope_a.request_id IS DISTINCT FROM ${p}.request_id OR scope_a.request_item_id IS DISTINCT FROM scope_i.id OR scope_a.supplier_id IS DISTINCT FROM ${p}.supplier_id))))) AND NOT EXISTS(SELECT 1 FROM purchase_order_items scope_graft_pi JOIN goods_receipt_items scope_graft_gi ON scope_graft_gi.purchase_order_item_id=scope_graft_pi.id LEFT JOIN goods_receipts scope_graft_gr ON scope_graft_gr.id=scope_graft_gi.goods_receipt_id WHERE scope_graft_pi.purchase_order_id=${p}.id AND (scope_graft_gr.id IS NULL OR scope_graft_gr.purchase_order_id IS DISTINCT FROM ${p}.id OR scope_graft_gr.request_id IS DISTINCT FROM ${p}.request_id)) AND NOT EXISTS(SELECT 1 FROM purchase_order_items scope_graft_ipi JOIN invoice_items scope_graft_ii ON scope_graft_ii.purchase_order_item_id=scope_graft_ipi.id LEFT JOIN supplier_invoices scope_graft_si ON scope_graft_si.id=scope_graft_ii.supplier_invoice_id WHERE scope_graft_ipi.purchase_order_id=${p}.id AND (scope_graft_si.id IS NULL OR scope_graft_si.purchase_order_id IS DISTINCT FROM ${p}.id OR scope_graft_si.request_id IS DISTINCT FROM ${p}.request_id))`;
  const poSource = (p) =>
    `(${po(p)} AND (${p}.rfx_id IS NULL OR EXISTS(SELECT 1 FROM rfx_events scope_re WHERE scope_re.id=${p}.rfx_id AND scope_re.request_id=${p}.request_id)) AND (${p}.rfx_response_id IS NULL OR EXISTS(SELECT 1 FROM rfx_responses scope_rr JOIN rfx_events scope_rre ON scope_rre.id=scope_rr.rfx_id WHERE scope_rr.id=${p}.rfx_response_id AND (${p}.rfx_id IS NULL OR scope_rr.rfx_id=${p}.rfx_id) AND (scope_rr.request_id IS NULL OR scope_rr.request_id=${p}.request_id) AND scope_rre.request_id=${p}.request_id AND scope_rr.supplier_id=${p}.supplier_id)))`;
  const receipt = (g) =>
    `EXISTS(SELECT 1 FROM purchase_orders scope_gp WHERE scope_gp.id=${g}.purchase_order_id AND scope_gp.request_id=${g}.request_id AND ${poSource("scope_gp")} AND NOT EXISTS(SELECT 1 FROM goods_receipt_items scope_gi LEFT JOIN purchase_order_items scope_gpi ON scope_gpi.id=scope_gi.purchase_order_item_id LEFT JOIN warehouses scope_w ON scope_w.id=scope_gi.warehouse_id WHERE scope_gi.goods_receipt_id=${g}.id AND (scope_gpi.id IS NULL OR scope_gpi.purchase_order_id IS DISTINCT FROM scope_gp.id OR scope_gi.requested_item_id IS DISTINCT FROM scope_gpi.requested_item_id OR (scope_gi.warehouse_id IS NOT NULL AND (scope_w.id IS NULL OR scope_w.institute_id IS DISTINCT FROM ${parameter})))))`;
  const invoice = (i) =>
    `EXISTS(SELECT 1 FROM purchase_orders scope_ip WHERE scope_ip.id=${i}.purchase_order_id AND scope_ip.request_id=${i}.request_id AND scope_ip.supplier_id=${i}.supplier_id AND ${poSource("scope_ip")} AND NOT EXISTS(SELECT 1 FROM invoice_items scope_ii LEFT JOIN purchase_order_items scope_ipi ON scope_ipi.id=scope_ii.purchase_order_item_id WHERE scope_ii.supplier_invoice_id=${i}.id AND (scope_ipi.id IS NULL OR scope_ipi.purchase_order_id IS DISTINCT FROM scope_ip.id OR scope_ii.requested_item_id IS DISTINCT FROM scope_ipi.requested_item_id)) AND (${i}.receipt_id IS NULL OR EXISTS(SELECT 1 FROM goods_receipts scope_ir WHERE scope_ir.id=${i}.receipt_id AND scope_ir.purchase_order_id=scope_ip.id AND scope_ir.request_id=${i}.request_id)) AND NOT EXISTS(SELECT 1 FROM invoice_match_results scope_im WHERE scope_im.supplier_invoice_id=${i}.id AND scope_im.request_id IS DISTINCT FROM ${i}.request_id))`;
  const voucher = (v) =>
    `EXISTS(SELECT 1 FROM supplier_invoices scope_vi WHERE scope_vi.id=${v}.supplier_invoice_id AND scope_vi.request_id=${v}.request_id AND ${invoice("scope_vi")} AND NOT EXISTS(SELECT 1 FROM ap_voucher_lines scope_vl WHERE scope_vl.ap_voucher_id=${v}.id AND scope_vl.reference_id IS NOT NULL AND NOT ${lineReference("scope_vl", `${v}.request_id`)}))`;
  const payable = (p) =>
    `EXISTS(SELECT 1 FROM ap_vouchers scope_pv JOIN supplier_invoices scope_pay_i ON scope_pay_i.id=scope_pv.supplier_invoice_id WHERE scope_pv.id=${p}.ap_voucher_id AND scope_pv.supplier_invoice_id=${p}.supplier_invoice_id AND scope_pv.request_id=${p}.request_id AND scope_pay_i.supplier_id=${p}.supplier_id AND ${voucher("scope_pv")} AND NOT EXISTS(SELECT 1 FROM payment_allocations scope_bad_alloc LEFT JOIN payment_records scope_bad_payment ON scope_bad_payment.id=scope_bad_alloc.payment_record_id WHERE scope_bad_alloc.ap_payable_id=${p}.id AND (scope_bad_payment.id IS NULL OR scope_bad_payment.request_id IS DISTINCT FROM ${p}.request_id OR scope_bad_payment.supplier_invoice_id IS DISTINCT FROM ${p}.supplier_invoice_id OR scope_bad_payment.ap_voucher_id IS DISTINCT FROM ${p}.ap_voucher_id)))`;
  const payment = (p) =>
    `(${root(`${p}.request_id`)} AND EXISTS(SELECT 1 FROM payment_allocations scope_pa WHERE scope_pa.payment_record_id=${p}.id) AND NOT EXISTS(SELECT 1 FROM payment_allocations scope_bad_pa LEFT JOIN ap_payables scope_bad_ap ON scope_bad_ap.id=scope_bad_pa.ap_payable_id WHERE scope_bad_pa.payment_record_id=${p}.id AND (scope_bad_ap.id IS NULL OR scope_bad_ap.request_id IS DISTINCT FROM ${p}.request_id OR scope_bad_ap.supplier_invoice_id IS DISTINCT FROM ${p}.supplier_invoice_id OR scope_bad_ap.ap_voucher_id IS DISTINCT FROM ${p}.ap_voucher_id OR NOT ${payable("scope_bad_ap")})))`;
  const budget = (b) =>
    `EXISTS(SELECT 1 FROM departments scope_bd WHERE scope_bd.id=${b}.department_id AND scope_bd.institute_id=${parameter})`;
  const commitment = (c) =>
    `(${root(`${c}.request_id`)} AND EXISTS(SELECT 1 FROM budget_envelopes scope_cb JOIN requests scope_cr ON scope_cr.id=${c}.request_id WHERE scope_cb.id=${c}.budget_envelope_id AND scope_cb.department_id=scope_cr.department_id AND scope_cb.project_id IS NOT DISTINCT FROM scope_cr.project_id AND ${budget("scope_cb")} AND (${c}.purchase_order_id IS NULL OR EXISTS(SELECT 1 FROM purchase_orders scope_cpo WHERE scope_cpo.id=${c}.purchase_order_id AND scope_cpo.request_id=${c}.request_id)) AND (${c}.supplier_invoice_id IS NULL OR EXISTS(SELECT 1 FROM supplier_invoices scope_ci WHERE scope_ci.id=${c}.supplier_invoice_id AND scope_ci.request_id=${c}.request_id AND ${invoice("scope_ci")})) AND (${c}.ap_voucher_id IS NULL OR EXISTS(SELECT 1 FROM ap_vouchers scope_cv WHERE scope_cv.id=${c}.ap_voucher_id AND scope_cv.request_id=${c}.request_id AND ${voucher("scope_cv")}))))`;
  const award = (x) =>
    `(${root(`${x}.request_id`)} AND ${supplier(`${x}.supplier_id`, `${x}.request_id`)} AND EXISTS(SELECT 1 FROM requested_items scope_ai WHERE scope_ai.id=${x}.request_item_id AND scope_ai.request_id=${x}.request_id))`;
  const posting = (f) =>
    `EXISTS(SELECT 1 FROM ap_vouchers scope_fv WHERE scope_fv.id=${f}.ap_voucher_id AND scope_fv.request_id=${f}.request_id AND scope_fv.supplier_invoice_id=${f}.supplier_invoice_id AND ${voucher("scope_fv")})`;
  const expressions = {
    financePosting: () => posting(a),
    award: () => award(a),
    request: () => root(`${a}.id`),
    purchaseOrder: () => poSource(a),
    receipt: () => receipt(a),
    invoice: () => invoice(a),
    voucher: () => voucher(a),
    payable: () => payable(a),
    payment: () => payment(a),
    budget: () => budget(a),
    commitment: () => commitment(a),
    match: () =>
      `EXISTS(SELECT 1 FROM supplier_invoices scope_mi WHERE scope_mi.id=${a}.supplier_invoice_id AND scope_mi.request_id=${a}.request_id AND ${invoice("scope_mi")})`,
  };
  if (
    !expressions[kind] ||
    !/^[a-z_][a-z0-9_]*$/i.test(a) ||
    !/^\$\d+$/.test(parameter)
  )
    throw new TypeError("Unsupported financial scope expression");
  return `(${expressions[kind]()})`;
}
async function withRead(
  actor,
  work,
  {
    kind = null,
    value = null,
    requestId = null,
    capabilities = ["procure-to-pay.lifecycle.view"],
  } = {},
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const current = await loadActor(client, actor, capabilities);
    if (kind || requestId != null) {
      const refs = { requestId, wholeRequest: requestId != null };
      if (kind) {
        const key = {
          purchaseOrder: "purchaseOrderId",
          invoice: "invoiceId",
          receipt: "receiptId",
        }[kind];
        if (!key || !TABLES[kind])
          throw new TypeError("Unsupported financial read root");
        refs[key] = value;
      }
      await authorizeCommand({ client }, current, capabilities, refs);
    }
    const result = await work(client, current, predicate);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
// Flow rows expose typed header identities, not line/ledger contents. Validate
// those header parent chains directly rather than expanding every descendant
// predicate twice per document type (which causes pathological query planning).
function flowPredicate(a, parameter = "$1") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(a) || !/^\$\d+$/.test(parameter))
    throw new TypeError("Invalid flow scope expression");
  const types = {
    REQUEST: ["requests", "request"],
    PURCHASE_REQUEST: ["requests", "request"],
    PROCUREMENT_AWARD: ["procurement_awards", "award"],
    PURCHASE_ORDER: ["purchase_orders", "purchaseOrder"],
    GOODS_RECEIPT: ["goods_receipts", "receipt"],
    AP_INVOICE: ["supplier_invoices", "invoice"],
    AP_VOUCHER: ["ap_vouchers", "voucher"],
    ACCOUNTS_PAYABLE: ["ap_payables", "payable"],
    PAYMENT: ["payment_records", "payment"],
    BUDGET_COMMITMENT: ["commitment_ledger", "commitment"],
    FINANCE_POSTING: ["finance_postings", "financePosting"],
    THREE_WAY_MATCH: ["invoice_match_results", "match"],
  };
  const header = (kind) => {
    let joins = "",
      checks = [];
    const invoiceKinds = [
      "voucher",
      "payable",
      "payment",
      "financePosting",
      "match",
    ];
    if (["payable", "payment", "financePosting"].includes(kind)) {
      joins +=
        " JOIN ap_vouchers sf_v ON sf_v.id=sf.ap_voucher_id AND sf_v.request_id=sf.request_id AND sf_v.supplier_invoice_id=sf.supplier_invoice_id";
    }
    if (invoiceKinds.includes(kind))
      joins +=
        " JOIN supplier_invoices sf_i ON sf_i.id=sf.supplier_invoice_id AND sf_i.request_id=sf.request_id";
    if (kind === "invoice")
      joins +=
        " JOIN purchase_orders sf_po ON sf_po.id=sf.purchase_order_id AND sf_po.request_id=sf.request_id AND sf_po.supplier_id=sf.supplier_id";
    if (invoiceKinds.includes(kind))
      joins +=
        " JOIN purchase_orders sf_po ON sf_po.id=sf_i.purchase_order_id AND sf_po.request_id=sf.request_id AND sf_po.supplier_id=sf_i.supplier_id";
    if (kind === "receipt")
      joins +=
        " JOIN purchase_orders sf_po ON sf_po.id=sf.purchase_order_id AND sf_po.request_id=sf.request_id";
    if (kind === "award")
      joins +=
        " JOIN requested_items sf_item ON sf_item.id=sf.request_item_id AND sf_item.request_id=sf.request_id";
    if (kind === "commitment") {
      joins +=
        " JOIN budget_envelopes sf_b ON sf_b.id=sf.budget_envelope_id JOIN requests sf_br ON sf_br.id=sf.request_id AND sf_br.department_id=sf_b.department_id AND sf_br.project_id IS NOT DISTINCT FROM sf_b.project_id";
      checks.push(
        "(sf.purchase_order_id IS NULL OR EXISTS(SELECT 1 FROM purchase_orders sf_cp WHERE sf_cp.id=sf.purchase_order_id AND sf_cp.request_id=sf.request_id))",
      );
    }
    if (kind === "payable") checks.push("sf.supplier_id=sf_i.supplier_id");
    if (kind === "payment")
      checks.push(
        `EXISTS(SELECT 1 FROM payment_allocations sf_pa WHERE sf_pa.payment_record_id=sf.id) AND NOT EXISTS(SELECT 1 FROM payment_allocations sf_bad LEFT JOIN ap_payables sf_ap ON sf_ap.id=sf_bad.ap_payable_id WHERE sf_bad.payment_record_id=sf.id AND (sf_ap.id IS NULL OR sf_ap.request_id IS DISTINCT FROM sf.request_id OR sf_ap.supplier_invoice_id IS DISTINCT FROM sf.supplier_invoice_id OR sf_ap.ap_voucher_id IS DISTINCT FROM sf.ap_voucher_id))`,
      );
    const poAlias =
      kind === "purchaseOrder"
        ? "sf"
        : ["invoice", "receipt", ...invoiceKinds].includes(kind)
          ? "sf_po"
          : null;
    const supplierId =
      kind === "award"
        ? "sf.supplier_id"
        : poAlias
          ? `${poAlias}.supplier_id`
          : null;
    if (supplierId)
      checks.push(
        `EXISTS(SELECT 1 FROM suppliers sf_supplier WHERE sf_supplier.id=${supplierId} AND ((to_jsonb(sf_supplier)->>'institute_id') IS NULL OR (to_jsonb(sf_supplier)->>'institute_id')=sf_root.institute_id::text))`,
      );
    if (poAlias)
      checks.push(
        `(${poAlias}.rfx_id IS NULL OR EXISTS(SELECT 1 FROM rfx_events sf_re WHERE sf_re.id=${poAlias}.rfx_id AND sf_re.request_id=sf_root.id)) AND (${poAlias}.rfx_response_id IS NULL OR EXISTS(SELECT 1 FROM rfx_responses sf_rr JOIN rfx_events sf_rre ON sf_rre.id=sf_rr.rfx_id WHERE sf_rr.id=${poAlias}.rfx_response_id AND (${poAlias}.rfx_id IS NULL OR sf_rr.rfx_id=${poAlias}.rfx_id) AND (sf_rr.request_id IS NULL OR sf_rr.request_id=sf_root.id) AND sf_rre.request_id=sf_root.id AND sf_rr.supplier_id=${poAlias}.supplier_id))`,
      );
    return {
      joins,
      condition: checks.length ? " AND " + checks.join(" AND ") : "",
    };
  };
  const side = (name) =>
    Object.entries(types)
      .map(([type, [table, kind]]) => {
        const { joins, condition } = header(kind);
        return `(${a}.${name}_document_type='${type}' AND EXISTS(SELECT 1 FROM ${table} sf ${joins} WHERE sf.id::text=${a}.${name}_document_id AND ${kind === "request" ? "sf.id" : "sf.request_id"}=sf_root.id ${condition}))`;
      })
      .join(" OR ");
  return `EXISTS(SELECT 1 FROM requests sf_root JOIN departments sf_department ON sf_department.id=sf_root.department_id AND sf_department.institute_id=sf_root.institute_id WHERE sf_root.id=${a}.request_id AND sf_root.institute_id=${parameter} AND (${side("source")}) AND (${side("target")}))`;
}
// The existing legacy accrual writer identifies supplier_invoice sources.
// Unknown source types remain historical data, never guessed into another type.
function invoiceJournalPredicate(a, parameter = "$1") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(a))
    throw new TypeError("Invalid journal alias");
  return `(LOWER(${a}.source_type)='supplier_invoice' AND EXISTS(SELECT 1 FROM supplier_invoices scope_ji WHERE scope_ji.id::text=${a}.source_id AND scope_ji.request_id=${a}.request_id AND ${predicate("invoice", "scope_ji", parameter)}))`;
}
module.exports = {
  predicate,
  withRead,
  flowPredicate,
  invoiceJournalPredicate,
};
