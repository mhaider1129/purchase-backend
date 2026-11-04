"use strict";
const crypto = require("node:crypto");
const pool = require("../config/db");
const auth = require("./p2pAuthorization");
const boundary = require("./contractAuthorizationService");
const scope = require("./p2pReadScope");
const finance = require("./contractFinanceIntegrationService");
const money = require("./purchaseOrderTotalsService");
const audit = require("./auditService");
const fail = (statusCode, message, code = "RECONCILIATION_INVALID") =>
  Object.assign(new Error(message), { statusCode, code });
const normalized = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
const currency = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
const same = (a, b) => a != null && b != null && String(a) === String(b);
const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const STATES = [
  "CONFIRMED_MATCH",
  "REJECTED_PROPOSAL",
  "CONFLICTING",
  "NEEDS_INVESTIGATION",
];
async function authorize(client, user) {
  const actor = await auth.loadActor(client, user, "finance.verify");
  if (
    !require("../utils/permissionService").userHasPermission(
      actor,
      "procure-to-pay.lifecycle.view",
    )
  )
    throw fail(
      403,
      "Permission required: procure-to-pay.lifecycle.view",
      "FINANCIAL_ACCESS_DENIED",
    );
  await finance.schema(client);
  const ready = (
    await client.query(
      `SELECT to_regclass('public.contract_financial_reviews') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.contract_financial_reviews') AND tgname='contract_financial_reviews_append_only' AND tgenabled IN ('O','A')) AS ready`,
    )
  ).rows[0].ready;
  if (!ready)
    throw fail(
      503,
      "Apply manual SQL 066 before financial reconciliation",
      "RECONCILIATION_SCHEMA_REQUIRED",
    );
  return actor;
}
async function transaction(
  user,
  work,
  { database = pool, write = false } = {},
) {
  const client = await database.connect();
  try {
    await client.query(
      write
        ? "BEGIN ISOLATION LEVEL READ COMMITTED"
        : "BEGIN ISOLATION LEVEL REPEATABLE READ",
    );
    const actor = await authorize(client, user);
    if (write)
      await client.query("SELECT pg_advisory_xact_lock(664001,$1::int)", [
        actor.institute_id,
      ]);
    const result = await work(client, actor);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    if (["40001", "23505", "40P01"].includes(e.code))
      throw fail(
        409,
        "Reconciliation changed concurrently; reload the worklist",
        "RECONCILIATION_VERSION_CONFLICT",
      );
    throw e;
  } finally {
    client.release();
  }
}
function bounded(rows) {
  if (rows.length > 5000)
    throw fail(
      413,
      "Reconciliation scope exceeds 5000 records; request a contract-specific worklist. No partial totals were returned.",
      "RECONCILIATION_SCOPE_TOO_LARGE",
    );
  return rows;
}
async function collect(client, actor, contractId = null) {
  if (contractId != null) contractId = auth.id(contractId);
  const roots = bounded(
    (
      await client.query(
        `SELECT c.id,c.title,c.source_request_id,c.supplier_id,c.currency,c.amount_paid::text,c.actual_consumed_value::text,c.created_by,
 ${boundary.ownerSql("c")} institute_id, s.name supplier_name,
 (SELECT COUNT(*)::int FROM contract_consumption x WHERE x.contract_id=c.id) legacy_consumption_count
 FROM contracts c LEFT JOIN suppliers s ON s.id=c.supplier_id AND (s.institute_id IS NULL OR s.institute_id=$1)
 WHERE ${boundary.predicate(actor, "c", true)} AND ${boundary.ownerSql("c")}=$1 AND ($2::int IS NULL OR c.id=$2) ORDER BY c.id LIMIT 5001`,
        [actor.institute_id, contractId],
      )
    ).rows,
  );
  if (contractId != null && !roots.length)
    throw fail(404, "Contract or reference not found", "CONTRACT_NOT_FOUND");
  const rootIds = roots.map((x) => x.id);
  const legacyInvoices = bounded(
    (
      await client.query(
        `SELECT id,contract_id,supplier_id,invoice_number,invoice_date::text,amount::text,tax_amount::text,discount_amount::text,retention_amount::text,penalty_amount::text,net_payable_amount::text,currency,status,created_by
 FROM contract_invoices WHERE contract_id=ANY($1::bigint[]) ORDER BY id LIMIT 5001`,
        [rootIds],
      )
    ).rows,
  );
  const legacyPayments = bounded(
    (
      await client.query(
        `SELECT id,contract_id,invoice_id,amount::text,currency,payment_date::text,payment_reference,status,created_by FROM contract_payments WHERE contract_id=ANY($1::bigint[]) ORDER BY id LIMIT 5001`,
        [rootIds],
      )
    ).rows,
  );
  const invoices = bounded(
    (
      await client.query(
        `SELECT i.id,i.request_id,i.purchase_order_id,i.contract_id,i.supplier_id,i.invoice_number,i.invoice_date::text,i.currency,i.total_amount::text,i.status,i.submitted_by
 FROM supplier_invoices i WHERE ${scope.predicate("invoice", "i", "$1")} AND ($2::int IS NULL OR i.contract_id=$2 OR i.request_id=ANY($3::int[]) OR lower(trim(i.invoice_number))=ANY($4::text[])) ORDER BY i.id LIMIT 5001`,
        [
          actor.institute_id,
          contractId,
          roots.map((x) => x.source_request_id).filter(Boolean),
          legacyInvoices
            .map((x) => normalized(x.invoice_number))
            .filter(Boolean),
        ],
      )
    ).rows,
  );
  const ids = invoices.map((x) => x.id);
  const payables = bounded(
    (
      await client.query(
        `SELECT a.id,a.supplier_invoice_id,a.request_id,a.supplier_id,a.ap_voucher_id,a.currency,a.invoice_total::text,a.open_balance::text,a.payable_status,
 v.supplier_invoice_id voucher_invoice_id,v.request_id voucher_request_id,v.total_amount::text voucher_total,v.voucher_status,v.currency voucher_currency,
 EXISTS(SELECT 1 FROM finance_postings f WHERE f.ap_voucher_id=v.id AND f.supplier_invoice_id=a.supplier_invoice_id AND f.request_id=a.request_id AND lower(f.posting_status)='posted' AND f.liability_recognized_amount=a.invoice_total) posted
 FROM ap_payables a LEFT JOIN ap_vouchers v ON v.id=a.ap_voucher_id WHERE a.supplier_invoice_id=ANY($1::bigint[]) AND ${scope.predicate("payable", "a", "$2")} ORDER BY a.id LIMIT 5001`,
        [ids, actor.institute_id],
      )
    ).rows,
  );
  const payments = bounded(
    (
      await client.query(
        `SELECT p.id,p.request_id,p.supplier_invoice_id,p.ap_voucher_id,p.currency,p.amount_paid::text,p.payment_reference,p.payment_status,p.reversal_of_payment_id,p.paid_by,p.paid_at::text
 FROM payment_records p WHERE p.supplier_invoice_id=ANY($1::bigint[]) AND ${scope.predicate("payment", "p", "$2")} ORDER BY p.id LIMIT 5001`,
        [ids, actor.institute_id],
      )
    ).rows,
  );
  const allocations = bounded(
    (
      await client.query(
        `SELECT a.id,a.payment_record_id,a.ap_payable_id,a.amount::text FROM payment_allocations a WHERE a.payment_record_id=ANY($1::bigint[]) AND a.ap_payable_id=ANY($2::bigint[]) ORDER BY a.id LIMIT 5001`,
        [payments.map((x) => x.id), payables.map((x) => x.id)],
      )
    ).rows,
  );
  const reviews = (
    await client.query(
      `SELECT * FROM contract_financial_reviews WHERE institute_id=$1 AND contract_id=ANY($2::int[]) ORDER BY revision DESC,id DESC`,
      [actor.institute_id, rootIds],
    )
  ).rows;
  const reviewAuditMissing = (
    await client.query(
      `SELECT COUNT(*)::int n FROM contract_financial_reviews r WHERE r.institute_id=$1 AND r.contract_id=ANY($2::int[]) AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.target_type='contract_financial_review' AND a.target_id::text=r.id::text AND a.action='CONTRACT_FINANCIAL_RECONCILIATION_REVIEWED' AND a.actor_id=r.reviewer_id)`,
      [actor.institute_id, rootIds],
    )
  ).rows[0].n;
  const excludedRoots = (
    await client.query(
      `SELECT COUNT(*)::int n FROM contracts c WHERE ${boundary.ownerSql("c")}=$1 AND NOT ${boundary.predicate(actor, "c", true)} AND ($2::int IS NULL OR c.id=$2)`,
      [actor.institute_id, contractId],
    )
  ).rows[0].n;
  const defects = [];
  if (excludedRoots)
    defects.push({
      type: "CONTRACT_SOURCE_SCOPE_CONFLICT",
      count: excludedRoots,
    });
  const hidden = (
    await client.query(
      `SELECT
 (SELECT COUNT(*)::int FROM ap_payables WHERE supplier_invoice_id=ANY($1::bigint[])) ap_count,
 (SELECT COUNT(*)::int FROM payment_records WHERE supplier_invoice_id=ANY($1::bigint[])) payment_count,
 (SELECT COUNT(*)::int FROM payment_allocations WHERE payment_record_id=ANY($2::bigint[]) OR ap_payable_id=ANY($3::bigint[])) allocation_count`,
      [ids, payments.map((x) => x.id), payables.map((x) => x.id)],
    )
  ).rows[0];
  if (
    hidden.ap_count !== payables.length ||
    hidden.payment_count !== payments.length ||
    hidden.allocation_count !== allocations.length
  )
    defects.push({ type: "CANONICAL_DESCENDANT_SCOPE_CONFLICT" });
  // Acceptance includes all attached AP and allocation rows, even when their ancestry is broken.
  const validPayments = new Set();
  for (const p of payments) {
    const i = invoices.find((i) => same(i.id, p.supplier_invoice_id));
    const ap = payables.find(
      (a) =>
        same(a.supplier_invoice_id, i?.id) &&
        same(a.ap_voucher_id, p.ap_voucher_id),
    );
    const allocated = allocations.filter((a) =>
      same(a.payment_record_id, p.id),
    );
    const valid =
      ap &&
      same(p.request_id, i.request_id) &&
      currency(p.currency) === currency(i.currency) &&
      same(ap.request_id, i.request_id) &&
      same(ap.supplier_id, i.supplier_id) &&
      currency(ap.currency) === currency(i.currency) &&
      normalized(p.payment_status) === "paid" &&
      p.reversal_of_payment_id == null &&
      allocated.length &&
      allocated.every(
        (a) =>
          same(a.ap_payable_id, ap.id) && money.compareDecimal(a.amount, 0) > 0,
      ) &&
      money.compareDecimal(
        money.addDecimal(...allocated.map((a) => a.amount)),
        p.amount_paid,
      ) === 0;
    if (valid) validPayments.add(String(p.id));
    else
      defects.push({ type: "PAYMENT_ALLOCATION_INTEGRITY", id: String(p.id) });
  }
  for (const a of payables) {
    const i = invoices.find((i) => same(i.id, a.supplier_invoice_id));
    const aa = allocations.filter((x) => same(x.ap_payable_id, a.id));
    const paid = money.addDecimal(
      ...aa
        .filter((x) => validPayments.has(String(x.payment_record_id)))
        .map((x) => x.amount),
    );
    if (
      !i ||
      !a.posted ||
      !["OPEN", "PARTIALLY_PAID", "PAID"].includes(a.payable_status) ||
      currency(a.voucher_currency) !== currency(i?.currency) ||
      normalized(a.voucher_status) !== "posted" ||
      !same(a.voucher_invoice_id, i.id) ||
      !same(a.voucher_request_id, i.request_id) ||
      !same(a.request_id, i.request_id) ||
      !same(a.supplier_id, i.supplier_id) ||
      currency(a.currency) !== currency(i.currency) ||
      money.compareDecimal(a.invoice_total, i.total_amount) !== 0 ||
      money.compareDecimal(a.voucher_total ?? 0, i.total_amount) !== 0 ||
      money.compareDecimal(
        a.open_balance,
        money.subtractDecimal(a.invoice_total, paid),
      ) !== 0 ||
      money.compareDecimal(a.open_balance, 0) < 0 ||
      aa.some((x) => !validPayments.has(String(x.payment_record_id)))
    )
      defects.push({
        type: "AP_BALANCE_OR_POSTING_INTEGRITY",
        id: String(a.id),
      });
  }
  const rawOwn = (
    await client.query(
      "SELECT COUNT(*)::int n FROM supplier_invoices i JOIN requests r ON r.id=i.request_id WHERE r.institute_id=$1 AND ($2::int IS NULL OR i.contract_id=$2 OR i.request_id=ANY($3::int[]))",
      [
        actor.institute_id,
        contractId,
        roots.map((x) => x.source_request_id).filter(Boolean),
      ],
    )
  ).rows[0].n;
  const scopedCount = invoices.filter(
    (i) =>
      contractId == null ||
      same(i.contract_id, contractId) ||
      roots.some((c) => same(c.source_request_id, i.request_id)),
  ).length;
  if (rawOwn !== scopedCount)
    defects.push({
      type: "CANONICAL_SOURCE_SCOPE_CONFLICT",
      count: rawOwn - scopedCount,
    });
  const rows = [];
  const evidenceFor = (i) => ({
    invoice: i,
    payables: payables.filter((a) => same(a.supplier_invoice_id, i.id)),
    payments: payments
      .filter((p) => same(p.supplier_invoice_id, i.id))
      .map((p) => ({
        ...p,
        allocations: allocations.filter((a) => same(a.payment_record_id, p.id)),
      })),
  });
  for (const source of [
    ...legacyInvoices.map((x) => ({ ...x, record_type: "legacy_invoice" })),
    ...legacyPayments.map((x) => ({ ...x, record_type: "legacy_payment" })),
  ]) {
    const c = roots.find((c) => same(c.id, source.contract_id));
    const li =
      source.record_type === "legacy_invoice"
        ? source
        : legacyInvoices.find(
            (i) => same(i.id, source.invoice_id) && same(i.contract_id, c.id),
          );
    const supplier = li?.supplier_id ?? c.supplier_id;
    const reasons = [];
    if (source.created_by == null || (li && li.created_by == null))
      reasons.push("MISSING_MAKER_IDENTITY");
    if (
      !li ||
      !supplier ||
      !normalized(li.invoice_number) ||
      !li.invoice_date ||
      !currency(source.currency) ||
      money.compareDecimal(source.amount, 0) <= 0
    )
      reasons.push("MISSING_SOURCE_IDENTITY_OR_POSITIVE_AMOUNT");
    if (
      (li?.supplier_id != null && !same(li.supplier_id, c.supplier_id)) ||
      (li && currency(li.currency) !== currency(source.currency))
    )
      reasons.push("LEGACY_SOURCE_CONFLICT");
    if (
      li &&
      (money.compareDecimal(li.tax_amount, 0) < 0 ||
        money.compareDecimal(li.discount_amount, 0) < 0 ||
        money.compareDecimal(li.retention_amount, 0) < 0 ||
        money.compareDecimal(li.penalty_amount, 0) < 0 ||
        money.compareDecimal(
          money.subtractDecimal(
            money.addDecimal(li.amount, li.tax_amount),
            li.discount_amount,
            li.retention_amount,
            li.penalty_amount,
          ),
          li.net_payable_amount,
        ) !== 0)
    )
      reasons.push("LEGACY_SOURCE_CONFLICT");
    const related = invoices.filter(
      (i) =>
        (normalized(li?.invoice_number) &&
          normalized(i.invoice_number) === normalized(li.invoice_number)) ||
        same(i.contract_id, c.id) ||
        same(i.request_id, c.source_request_id),
    );
    const candidates = [];
    for (const i of related) {
      const problems = [];
      if (i.submitted_by == null) problems.push("MISSING_MAKER_IDENTITY");
      if (
        li &&
        money.compareDecimal(
          money.subtractDecimal(
            money.addDecimal(li.amount, li.tax_amount),
            li.discount_amount,
          ),
          i.total_amount,
        ) !== 0
      )
        problems.push("GROSS_AMOUNT_MISMATCH");
      if (!same(i.supplier_id, supplier)) problems.push("SUPPLIER_MISMATCH");
      if (!li || normalized(i.invoice_number) !== normalized(li.invoice_number))
        problems.push("INVOICE_IDENTITY_MISMATCH");
      if (i.invoice_date !== li?.invoice_date)
        problems.push("INVOICE_DATE_MISMATCH");
      if (currency(i.currency) !== currency(source.currency))
        problems.push("CURRENCY_MISMATCH");
      if (i.contract_id != null && !same(i.contract_id, c.id))
        problems.push("CONTRACT_MISMATCH");
      if (
        c.source_request_id != null &&
        !same(i.request_id, c.source_request_id)
      )
        problems.push("REQUEST_MISMATCH");
      if (source.record_type === "legacy_invoice") {
        if (
          money.compareDecimal(source.retention_amount, 0) !== 0 ||
          money.compareDecimal(source.penalty_amount, 0) !== 0
        )
          problems.push("UNSUPPORTED_RETENTION_OR_PENALTY");
        if (
          [
            "cancelled",
            "voided",
            "declined",
            "superseded",
            "replaced",
          ].includes(normalized(i.status))
        )
          problems.push("INACTIVE_CANONICAL_INVOICE");
        candidates.push({
          id: String(i.id),
          type: "supplier_invoice",
          problems,
          evidence: evidenceFor(i),
        });
      } else {
        for (const p of payments.filter((p) =>
          same(p.supplier_invoice_id, i.id),
        ))
          for (const a of allocations.filter((a) =>
            same(a.payment_record_id, p.id),
          )) {
            const issues = [...problems];
            if (p.paid_by == null) issues.push("MISSING_MAKER_IDENTITY");
            if (
              !String(source.payment_reference ?? "").trim() ||
              String(p.payment_reference ?? "").trim() !==
                String(source.payment_reference ?? "").trim()
            )
              issues.push("PAYMENT_REFERENCE_MISMATCH");
            if (
              normalized(source.status) !== "paid" ||
              !validPayments.has(String(p.id))
            )
              issues.push("PAYMENT_NOT_SUPPORTED_PAID_EVIDENCE");
            if (
              defects.some(
                (d) =>
                  d.type === "AP_BALANCE_OR_POSTING_INTEGRITY" &&
                  same(d.id, a.ap_payable_id),
              )
            )
              issues.push("PAYABLE_INTEGRITY_CONFLICT");
            if (currency(p.currency) !== currency(source.currency))
              issues.push("CURRENCY_MISMATCH");
            candidates.push({
              id: String(a.id),
              type: "payment_allocation",
              amount: a.amount,
              payment_id: String(p.id),
              problems: issues,
              evidence: evidenceFor(i),
            });
          }
      }
    }
    const source_snapshot = {
      contract: {
        id: c.id,
        institute_id: c.institute_id,
        source_request_id: c.source_request_id,
        supplier_id: c.supplier_id,
        currency: c.currency,
      },
      source,
      legacy_invoice: source.record_type === "legacy_payment" ? li : null,
      candidates,
    };
    const fingerprint = digest(source_snapshot);
    const history = reviews.filter(
      (r) =>
        r.record_type === source.record_type && same(r.source_id, source.id),
    );
    const latest = history[0] ?? null;
    const stale = !!latest && latest.source_fingerprint !== fingerprint;
    let classification = reasons.includes("LEGACY_SOURCE_CONFLICT")
      ? "Conflicting"
      : reasons.length
        ? "Insufficient evidence"
        : !candidates.length
          ? "Unmatched"
          : candidates.every((x) => x.problems.length)
            ? "Conflicting"
            : "Possible match";
    if (latest && !stale && latest.decision === "CONFIRMED_MATCH")
      classification = "Confirmed match";
    if (latest && !stale && latest.decision === "CONFLICTING")
      classification = "Conflicting";
    if (latest && !stale && latest.decision === "NEEDS_INVESTIGATION")
      classification = "Insufficient evidence";
    rows.push({
      record_type: source.record_type,
      source_id: String(source.id),
      contract_id: String(c.id),
      contract_title: c.title,
      institute_id: c.institute_id,
      supplier_id: supplier,
      supplier_name: c.supplier_name,
      currency: currency(source.currency) || "UNKNOWN",
      amount:
        source.record_type === "legacy_invoice"
          ? money.subtractDecimal(
              money.addDecimal(source.amount, source.tax_amount),
              source.discount_amount,
            )
          : source.amount,
      classification,
      reasons,
      candidates,
      fingerprint,
      source_snapshot,
      review: latest,
      history,
      stale_review: stale,
      version: latest?.revision ?? 0,
    });
  }
  return {
    actor,
    roots,
    rows,
    defects,
    selected_contract_id: contractId,
    review_audit_missing_count: reviewAuditMissing,
    canonical: { invoices, payables, payments, allocations },
  };
}
function report(data) {
  const totals = {};
  for (const r of data.rows) {
    const key = `${r.record_type}:${r.currency}`;
    const bucket = (totals[key] ??= {
      record_type: r.record_type,
      currency: r.currency,
      total_records: 0,
      confirmed_records: 0,
      legacy_unreconciled_value: "0.00",
      confirmed_matched_value: "0.00",
      potential_duplicate_exposure: "0.00",
      conflicting_records: 0,
    });
    bucket.total_records++;
    const confirmed = r.classification === "Confirmed match";
    if (confirmed) bucket.confirmed_records++;
    const field = confirmed
      ? "confirmed_matched_value"
      : "legacy_unreconciled_value";
    bucket[field] = money.addDecimal(bucket[field], r.amount);
    if (r.classification === "Conflicting") bucket.conflicting_records++;
    const duplicateCandidates = r.candidates.filter(
      (c) =>
        !c.problems.some((p) =>
          [
            "SUPPLIER_MISMATCH",
            "INVOICE_IDENTITY_MISMATCH",
            "CURRENCY_MISMATCH",
            "PAYMENT_REFERENCE_MISMATCH",
          ].includes(p),
        ),
    );
    if (
      !confirmed &&
      money.compareDecimal(r.amount, 0) > 0 &&
      duplicateCandidates.length &&
      !(
        r.review?.decision === "REJECTED_PROPOSAL" &&
        !r.stale_review &&
        duplicateCandidates.every((c) =>
          r.review.canonical_ids.map(String).includes(c.id),
        )
      )
    )
      bucket.potential_duplicate_exposure = money.addDecimal(
        bucket.potential_duplicate_exposure,
        r.amount,
      );
  }
  return {
    institute_id: data.actor.institute_id,
    scope: data.selected_contract_id ? "CONTRACT" : "CURRENT_INSTITUTE",
    contract_id: data.selected_contract_id,
    totals: Object.values(totals),
    progress: {
      total_records: data.rows.length,
      confirmed_records: data.rows.filter(
        (r) => r.classification === "Confirmed match",
      ).length,
      unreviewed_records: data.rows.filter((r) => !r.review).length,
      stale_review_records: data.rows.filter((r) => r.stale_review).length,
    },
    contracts: data.roots.map((c) => {
      const rows = data.rows.filter((r) => same(r.contract_id, c.id));
      const confirmed = rows.filter(
        (r) => r.classification === "Confirmed match",
      ).length;
      const header =
        money.compareDecimal(c.amount_paid ?? 0, 0) !== 0 ||
        money.compareDecimal(c.actual_consumed_value ?? 0, 0) !== 0;
      return {
        contract_id: String(c.id),
        records: rows.length,
        confirmed_records: confirmed,
        legacy_consumption_count: c.legacy_consumption_count,
        historical_header_evidence: header,
        review_complete:
          confirmed === rows.length && !header && !c.legacy_consumption_count,
      };
    }),
    acceptance: {
      canonical_integrity_passed: data.defects.length === 0,
      review_audit_complete: data.review_audit_missing_count === 0,
      review_audit_missing_count: data.review_audit_missing_count,
      defects: data.defects,
      financial_execution_holds_released: false,
    },
    limitations: [
      "Invoice obligations and payment evidence are separate totals; never add them together.",
      "Potential duplicate exposure is an investigation indicator, not a confirmed loss.",
      "Reviews never authorize posting, payment, reversal or release existing reconciliation holds.",
    ],
  };
}
async function worklist(user, { contractId = null } = {}, options = {}) {
  return transaction(
    user,
    async (client, actor) => {
      const data = await collect(client, actor, contractId);
      return { rows: data.rows, report: report(data) };
    },
    options,
  );
}
async function review(user, input, options = {}) {
  const kind = input.record_type;
  if (
    !["legacy_invoice", "legacy_payment"].includes(kind) ||
    !STATES.includes(input.decision)
  )
    throw fail(400, "Supported source and review decision required");
  const sourceId = auth.id(input.source_id);
  if (
    !Number.isSafeInteger(input.expected_version) ||
    input.expected_version > 2147483646 ||
    ![
      input.notes,
      input.supporting_evidence,
      input.command_key,
      input.fingerprint,
    ].every((v) => typeof v === "string") ||
    input.expected_version < 0 ||
    !String(input.notes ?? "").trim() ||
    String(input.notes).length > 4000 ||
    !String(input.supporting_evidence ?? "").trim() ||
    String(input.supporting_evidence).length > 8000 ||
    !/^\w[\w:.-]{7,199}$/.test(String(input.command_key ?? "")) ||
    !/^[a-f0-9]{64}$/.test(String(input.fingerprint ?? ""))
  )
    throw fail(
      400,
      "Version, fingerprint, idempotency key, notes and supporting evidence are required",
    );
  if (!Array.isArray(input.canonical_ids) || input.canonical_ids.length > 100)
    throw fail(400, "Provide up to 100 canonical source IDs");
  const ids = [...new Set(input.canonical_ids.map(auth.id))].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  if (input.decision === "REJECTED_PROPOSAL" && !ids.length)
    throw fail(400, "Select the proposed canonical relationship to reject");
  const command = {
    record_type: kind,
    source_id: sourceId,
    decision: input.decision,
    canonical_ids: ids,
    expected_version: input.expected_version,
    fingerprint: input.fingerprint,
    notes: input.notes.trim(),
    supporting_evidence: input.supporting_evidence.trim(),
  };
  return transaction(
    user,
    async (client, actor) => {
      const retry = (
        await client.query(
          "SELECT * FROM contract_financial_reviews WHERE institute_id=$1 AND command_key=$2",
          [actor.institute_id, input.command_key],
        )
      ).rows[0];
      const hash = digest({ ...command, actor_id: actor.id });
      if (retry) {
        if (
          !(
            await client.query(
              `SELECT c.id FROM contracts c WHERE c.id=$1 AND ${boundary.predicate(actor, "c", true)} AND ${boundary.ownerSql("c")}=$2`,
              [retry.contract_id, actor.institute_id],
            )
          ).rowCount
        )
          throw fail(
            404,
            "Reconciliation record not found",
            "RECONCILIATION_NOT_FOUND",
          );
        if (retry.command_fingerprint !== hash)
          throw fail(
            409,
            "Idempotency key was used with another review",
            "RECONCILIATION_IDEMPOTENCY_CONFLICT",
          );
        return { review: retry, idempotent: true };
      }
      const table =
        kind === "legacy_invoice" ? "contract_invoices" : "contract_payments";
      const source = (
        await client.query(
          `SELECT l.contract_id FROM ${table} l JOIN contracts c ON c.id=l.contract_id WHERE l.id=$1 AND ${boundary.predicate(actor, "c", true)} AND ${boundary.ownerSql("c")}=$2 FOR SHARE OF c`,
          [sourceId, actor.institute_id],
        )
      ).rows[0];
      if (!source)
        throw fail(
          404,
          "Reconciliation record not found",
          "RECONCILIATION_NOT_FOUND",
        );
      await client.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
        sourceId,
      ]);
      const data = await collect(client, actor, source.contract_id);
      const row = data.rows.find(
        (r) => r.record_type === kind && same(r.source_id, sourceId),
      );
      if (
        row.version !== input.expected_version ||
        row.fingerprint !== input.fingerprint
      )
        throw fail(
          409,
          "Source or review changed; reload the worklist",
          "RECONCILIATION_VERSION_CONFLICT",
        );
      const candidates = ids.map((id) =>
        row.candidates.find((c) => same(c.id, id)),
      );
      if (candidates.some((c) => !c))
        throw fail(
          404,
          "Canonical candidate not found in authorized source evidence",
          "RECONCILIATION_NOT_FOUND",
        );
      if (command.decision === "CONFIRMED_MATCH") {
        if (
          row.reasons.length ||
          !ids.length ||
          (kind === "legacy_invoice" && ids.length !== 1) ||
          candidates.some((c) => c.problems.length)
        )
          throw fail(
            409,
            "Evidence cannot support confirmation; record a conflict or investigation",
            "RECONCILIATION_EVIDENCE_REQUIRED",
          );
        if (
          same(row.source_snapshot.source.created_by, actor.id) ||
          same(row.source_snapshot.legacy_invoice?.created_by, actor.id) ||
          candidates.some(
            (c) =>
              same(c.evidence.invoice.submitted_by, actor.id) ||
              c.evidence.payments.some((p) => same(p.paid_by, actor.id)),
          )
        )
          throw fail(
            403,
            "An independent finance reviewer must confirm maker records",
            "RECONCILIATION_SEGREGATION_REQUIRED",
          );
        if (
          kind === "legacy_payment" &&
          money.compareDecimal(
            money.addDecimal(...candidates.map((c) => c.amount)),
            row.amount,
          ) !== 0
        )
          throw fail(
            409,
            "Selected allocations do not equal this historical payment",
            "RECONCILIATION_ALLOCATION_MISMATCH",
          );
        const overlap = (
          await client.query(
            `SELECT r.id FROM contract_financial_reviews r WHERE r.institute_id=$1 AND r.record_type=$2 AND r.source_id<>$3 AND r.decision='CONFIRMED_MATCH' AND r.canonical_ids && $4::bigint[] AND NOT EXISTS(SELECT 1 FROM contract_financial_reviews newer WHERE newer.institute_id=r.institute_id AND newer.record_type=r.record_type AND newer.source_id=r.source_id AND newer.revision>r.revision) LIMIT 1`,
            [actor.institute_id, kind, sourceId, ids],
          )
        ).rowCount;
        if (overlap)
          throw fail(
            409,
            "A canonical record is already confirmed against another historical source",
            "RECONCILIATION_MAPPING_CONFLICT",
          );
      }
      const saved = (
        await client.query(
          `INSERT INTO contract_financial_reviews(institute_id,contract_id,record_type,source_id,revision,decision,canonical_ids,source_fingerprint,evidence_snapshot,supporting_evidence,notes,reviewer_id,command_key,command_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7::bigint[],$8,$9::jsonb,$10,$11,$12,$13,$14) RETURNING *`,
          [
            actor.institute_id,
            row.contract_id,
            kind,
            sourceId,
            row.version + 1,
            command.decision,
            ids,
            row.fingerprint,
            JSON.stringify(row.source_snapshot),
            command.supporting_evidence,
            command.notes,
            actor.id,
            input.command_key,
            hash,
          ],
        )
      ).rows[0];
      await (options.auditService ?? audit).writeAuditEvent({
        client,
        entityType: "contract_financial_review",
        entityId: saved.id,
        action: "CONTRACT_FINANCIAL_RECONCILIATION_REVIEWED",
        actorUserId: actor.id,
        instituteId: actor.institute_id,
        requestId: row.source_snapshot.contract.source_request_id,
        beforeData: row.review,
        afterData: saved,
        reason: command.notes,
        metadata: {
          financialWrites: false,
          source_fingerprint: row.fingerprint,
          canonical_ids: ids,
        },
      });
      return { review: saved, idempotent: false };
    },
    { ...options, write: true },
  );
}
module.exports = { worklist, review, collect, report, authorize };
