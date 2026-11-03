"use strict";
const boundary = require("./contractAuthorizationService");
const { userHasPermission } = require("../utils/permissionService");
const { compareDecimal, addDecimal } = require("./purchaseOrderTotalsService");
const fail = (
  message,
  code = "CONTRACT_FINANCE_SOURCE_INVALID",
  statusCode = 409,
) => Object.assign(new Error(message), { code, statusCode });
const equal = (a, b) => a != null && b != null && String(a) === String(b);
const RESERVED = "('PO_ISSUED','PO_PARTIAL','PO_DELIVERED','PO_CLOSED')";
async function schema(client) {
  const ready = (
    await client.query(`SELECT
    (SELECT COUNT(*)=3 FROM information_schema.columns WHERE table_schema='public' AND
      ((table_name='purchase_orders' AND column_name='contract_id') OR (table_name='contracts' AND column_name='institute_id') OR (table_name='contract_obligations' AND column_name='generated_from_obligation_id')))
    AND EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.purchase_orders') AND c.confrelid=to_regclass('public.contracts') AND c.conname='purchase_orders_contract_source_fkey' AND c.contype='f')
    AND NOT EXISTS(SELECT 1 FROM (VALUES
      ('public.purchase_orders','canonical_contract_po_source_immutable','public.guard_canonical_contract_po_source()'),
      ('public.contracts','contract_canonical_commitment_guard','public.guard_contract_canonical_commitment()'),
      ('public.supplier_invoices','canonical_invoice_contract_source_guard','public.guard_canonical_invoice_contract_source()')
    ) wanted(relation,trigger_name,function_name) WHERE NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(wanted.relation) AND t.tgname=wanted.trigger_name AND t.tgfoid=to_regprocedure(wanted.function_name) AND NOT t.tgisinternal AND t.tgenabled IN ('O','A'))) AS ready`)
  ).rows[0]?.ready;
  if (!ready)
    throw fail(
      "Apply manual SQL 064 and 065 before using canonical contract finance",
      "CONTRACT_FINANCE_SCHEMA_REQUIRED",
      503,
    );
}
function ceiling(c) {
  // The existing canonical accounting model supports exact two-decimal money.
  const text = String(c.contract_value ?? "")
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text) || compareDecimal(text, 0) <= 0)
    throw fail(
      "A positive contract ceiling representable in canonical money precision is required",
      "CONTRACT_CEILING_REQUIRED",
    );
  return text;
}
async function reference(
  client,
  actor,
  contractId,
  facts,
  { manage = false, active = false, at = null } = {},
) {
  if (contractId == null) return null;
  await schema(client);
  if (manage && !userHasPermission(actor, "contracts.manage"))
    throw fail(
      "Permission required: contracts.manage",
      "CONTRACT_ACCESS_DENIED",
      403,
    );
  const c = (
    await client.query(
      `SELECT c.*,${boundary.ownerSql("c")} resolved_institute_id,
    (c.start_date IS NULL OR c.start_date<=COALESCE($2::date,CURRENT_DATE)) AND (c.end_date IS NULL OR c.end_date>=COALESCE($2::date,CURRENT_DATE)) valid_date
    FROM contracts c WHERE c.id=$1 AND ${boundary.predicate(actor, "c", !manage)} AND ${boundary.ownerSql("c")}=$3 FOR SHARE OF c`,
      [contractId, at, actor.institute_id],
    )
  ).rows[0];
  if (!c)
    throw fail("Contract or reference not found", "CONTRACT_NOT_FOUND", 404);
  if (
    !equal(c.source_request_id, facts.request_id) ||
    !equal(c.supplier_id, facts.supplier_id)
  )
    throw fail(
      "Contract must have the same authoritative request and supplier as its PO",
    );
  if (
    !c.currency ||
    c.currency.trim().toUpperCase() !==
      String(facts.currency).trim().toUpperCase()
  )
    throw fail(
      "Contract and canonical document currencies must agree",
      "CONTRACT_CURRENCY_MISMATCH",
    );
  if (active) {
    if (c.contract_type !== "purchasing")
      throw fail(
        "Only PO-backed purchasing contracts are supported; leasing, advances and other sources require an approved source adapter",
        "CONTRACT_SOURCE_UNSUPPORTED",
      );
    if (
      !["active", "expiring_soon", "renewed"].includes(c.status) ||
      !c.valid_date
    )
      throw fail(
        "Contract is not valid for new obligations on this date",
        "CONTRACT_NOT_VALID",
      );
    if (
      (
        await client.query(
          "SELECT 1 FROM contract_approvals WHERE contract_id=$1 AND status<>'Approved' LIMIT 1",
          [c.id],
        )
      ).rowCount
    )
      throw fail(
        "Complete the existing contract approval workflow before new obligations",
        "CONTRACT_NOT_VALID",
      );
    ceiling(c);
    let terms = c.clm_additional_payload || {};
    if (typeof terms === "string") {
      try {
        terms = JSON.parse(terms);
      } catch {
        throw fail(
          "Contract financial terms require review",
          "CONTRACT_SOURCE_UNSUPPORTED",
        );
      }
    }
    terms = { ...c, ...terms };
    const nonzero = (value) =>
      value != null &&
      String(value).trim() !== "" &&
      !/^0+(\.0+)?$/.test(String(value).trim());
    if (
      nonzero(terms.payment_advance_percentage) ||
      nonzero(terms.payment_retention) ||
      nonzero(terms.payment_penalty_rate_percent) ||
      String(terms.payment_milestone_details || "").trim()
    )
      throw fail(
        "Advance, retention, penalty and milestone terms require an approved source adapter",
        "CONTRACT_SOURCE_UNSUPPORTED",
      );
    if (
      facts.id &&
      (
        await client.query(
          "SELECT 1 FROM purchase_order_items WHERE purchase_order_id=$1 AND line_type='SERVICE' LIMIT 1",
          [facts.id],
        )
      ).rowCount
    )
      throw fail(
        "Service and milestone acceptance require an approved contract source adapter",
        "CONTRACT_SOURCE_UNSUPPORTED",
      );
  }
  return c;
}
async function reconciliation(client, facts) {
  // No table means no installed legacy ledger. Partial installed modules fail closed.
  if (
    !(await client.query("SELECT to_regclass('public.contracts') AS present"))
      .rows[0]?.present
  )
    return;
  const held = (
    await client.query(
      `SELECT 1 FROM contracts c WHERE
    ((c.id=$1 OR (c.source_request_id=$2 AND (c.supplier_id=$3 OR c.supplier_id IS NULL))) AND
      (COALESCE(c.amount_paid,0)<>0 OR COALESCE(c.actual_consumed_value,0)<>0 OR
       EXISTS(SELECT 1 FROM contract_invoices i WHERE i.contract_id=c.id) OR
       EXISTS(SELECT 1 FROM contract_payments p WHERE p.contract_id=c.id) OR
       EXISTS(SELECT 1 FROM contract_consumption x WHERE x.contract_id=c.id))) OR
    EXISTS(SELECT 1 FROM contract_invoices i WHERE i.contract_id=c.id AND COALESCE(i.supplier_id,c.supplier_id)=$3
      AND (NULLIF(lower(trim(i.invoice_number)),'')=NULLIF(lower(trim($4::text)),'') OR
        EXISTS(SELECT 1 FROM contract_payments p WHERE p.contract_id=c.id AND (p.invoice_id IS NULL OR p.invoice_id=i.id) AND NULLIF(trim(i.invoice_number),'') IS NULL))) OR
    (c.supplier_id=$3 AND EXISTS(SELECT 1 FROM contract_payments p LEFT JOIN contract_invoices i ON i.id=p.invoice_id AND i.contract_id=c.id
      WHERE p.contract_id=c.id AND (i.id IS NULL OR NULLIF(trim(i.invoice_number),'') IS NULL))) LIMIT 1`,
      [
        facts.contract_id || null,
        facts.request_id,
        facts.supplier_id,
        facts.invoice_number || null,
      ],
    )
  ).rowCount;
  if (held)
    throw fail(
      "Historical contract evidence requires finance reconciliation before creating or settling this obligation. No legacy amount is treated as a canonical payment.",
      "CONTRACT_RECONCILIATION_REQUIRED",
    );
}
async function requireLink(client, facts) {
  if (facts.contract_id != null) return;
  if (
    !(await client.query("SELECT to_regclass('public.contracts') AS present"))
      .rows[0]?.present
  )
    return;
  if (
    (
      await client.query(
        "SELECT 1 FROM contracts WHERE source_request_id=$1 AND supplier_id=$2 LIMIT 1",
        [facts.request_id, facts.supplier_id],
      )
    ).rowCount
  )
    throw fail(
      "This request and supplier have a contract source. An explicit PO contract link is required; existing unlinked documents require reviewed source mapping.",
      "CONTRACT_LINK_REQUIRED",
    );
}
async function issue(client, actor, po, amount) {
  if (po.contract_id == null) return;
  const c = await reference(client, actor, po.contract_id, po, {
    active: true,
  });
  await reconciliation(client, po);
  const used = (
    await client.query(
      `SELECT COALESCE(SUM(total_amount),0)::text amount FROM purchase_orders WHERE contract_id=$1 AND id<>$2 AND status IN ${RESERVED}`,
      [c.id, po.id],
    )
  ).rows[0].amount;
  if (compareDecimal(addDecimal(used, amount), ceiling(c)) > 0)
    throw fail(
      "Issued PO commitments exceed the contract ceiling",
      "CONTRACT_CEILING_EXCEEDED",
    );
}
async function command(tx, actor, invoice) {
  const po = await tx.lockPurchaseOrder(invoice.purchase_order_id);
  if (!po) throw fail("Invoice PO source is missing");
  if (
    !equal(invoice.contract_id, po.contract_id) &&
    (invoice.contract_id != null || po.contract_id != null)
  )
    throw fail(
      "Invoice contract must be inherited from its immutable PO",
      "CONTRACT_PROVENANCE_MISMATCH",
    );
  await reference(tx.client, actor, po.contract_id, po);
  await reconciliation(tx.client, { ...invoice, contract_id: po.contract_id });
  await requireLink(tx.client, po);
  if (po.contract_id != null) {
    const inconsistent = (
      await tx.client.query(
        `SELECT 1 FROM ap_payables a JOIN ap_vouchers v ON v.id=a.ap_voucher_id WHERE a.supplier_invoice_id=$1 AND
      (a.open_balance IS DISTINCT FROM a.invoice_total-COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payment_records p ON p.id=pa.payment_record_id WHERE pa.ap_payable_id=a.id AND lower(p.payment_status)='paid'),0) OR a.invoice_total IS DISTINCT FROM $2::numeric OR v.total_amount IS DISTINCT FROM $2::numeric OR UPPER(a.currency) IS DISTINCT FROM UPPER($3::text) OR
       EXISTS(SELECT 1 FROM finance_postings f WHERE f.ap_voucher_id=v.id AND lower(f.posting_status)='posted' AND f.liability_recognized_amount IS DISTINCT FROM a.invoice_total) OR
       EXISTS(SELECT 1 FROM payment_records p WHERE p.supplier_invoice_id=$1 AND (p.reversal_of_payment_id IS NOT NULL OR UPPER(p.currency) IS DISTINCT FROM UPPER($3::text) OR (lower(p.payment_status)='paid' AND p.amount_paid IS DISTINCT FROM (SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.payment_record_id=p.id))))) LIMIT 1`,
        [invoice.id, invoice.total_amount, invoice.currency],
      )
    ).rowCount;
    if (inconsistent)
      throw fail(
        "Inconsistent AP authority or reversal evidence requires finance reconciliation",
        "CONTRACT_RECONCILIATION_REQUIRED",
      );
  }
}
async function validateGraph(client, actor, documents) {
  const checked = new Set();
  for (const [key, doc] of documents) {
    if (
      key.startsWith("purchaseOrder:") &&
      doc.contract_id != null &&
      !checked.has(String(doc.contract_id))
    ) {
      await reference(client, actor, doc.contract_id, doc);
      checked.add(String(doc.contract_id));
    }
    if (key.startsWith("invoice:")) {
      const po = documents.get(`purchaseOrder:${doc.purchase_order_id}`);
      if (
        po &&
        !equal(doc.contract_id, po.contract_id) &&
        (doc.contract_id != null || po.contract_id != null)
      )
        throw fail(
          "Invoice and PO contract provenance disagree",
          "CONTRACT_PROVENANCE_MISMATCH",
        );
    }
    if (
      key.startsWith("voucher:") &&
      doc.contract_id != null &&
      !equal(
        doc.contract_id,
        documents.get(`invoice:${doc.supplier_invoice_id}`)?.contract_id,
      )
    )
      throw fail(
        "Voucher contract provenance disagrees with its invoice",
        "CONTRACT_PROVENANCE_MISMATCH",
      );
  }
}
async function edit(client, c, body) {
  const facts = (
    await client.query(
      `SELECT COUNT(*)::int count,COALESCE(SUM(total_amount) FILTER(WHERE status IN ${RESERVED}),0)::text used FROM purchase_orders WHERE (to_jsonb(purchase_orders)->>'contract_id')=$1::text`,
      [c.id],
    )
  ).rows[0];
  if (!facts.count) return;
  for (const field of ["source_request_id", "supplier_id", "currency"])
    if (
      Object.hasOwn(body, field) &&
      String(body[field] ?? "") !== String(c[field] ?? "")
    )
      throw fail(
        "Linked canonical source identity cannot be changed",
        "CONTRACT_PROVENANCE_IMMUTABLE",
      );
  if (
    Object.hasOwn(body, "contract_value") &&
    compareDecimal(
      ceiling({ ...c, contract_value: body.contract_value }),
      facts.used,
    ) < 0
  )
    throw fail(
      "Contract ceiling cannot be reduced below issued PO commitments",
      "CONTRACT_CEILING_EXCEEDED",
    );
}
module.exports = {
  schema,
  reference,
  reconciliation,
  requireLink,
  issue,
  command,
  validateGraph,
  edit,
  RESERVED,
  ceiling,
  fail,
};
