"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
async function run({ client, c, inv, inv2, ap, ap3 }) {
  const service = require("../services/contractFinancialReconciliationService");
  const one = async (sql, params = []) =>
    (await client.query(sql, params)).rows[0];
  let count = 0,
    seq = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS ${name}`);
    count++;
  };
  const key = () => `reconcile-native-${++seq}`;
  const snapshot = async () => {
    const out = {};
    for (const table of [
      "contracts",
      "contract_invoices",
      "contract_payments",
      "contract_consumption",
      "supplier_invoices",
      "purchase_orders",
      "goods_receipts",
      "goods_receipt_items",
      "ap_vouchers",
      "ap_payables",
      "finance_postings",
      "payment_records",
      "payment_allocations",
      "commitment_ledger",
      "journal_entries",
      "journal_entry_lines",
      "gl_postings",
      "gl_posting_lines",
      "notification_outbox",
    ])
      out[table] = (
        await one(
          `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) hash FROM ${table} t`,
        )
      ).hash;
    return out;
  };
  await client.query(`INSERT INTO users(id,name,email,password,role,institute_id,department_id,is_active) VALUES(106,'Reconciliation finance','review106@test.invalid','test','custom',101,101,true),(107,'Other reviewer','review107@test.invalid','test','custom',101,101,true);
 INSERT INTO user_permissions(user_id,permission_id) SELECT u,p.id FROM unnest(ARRAY[106,107,105]) u CROSS JOIN permissions p WHERE p.code IN ('finance.verify','procure-to-pay.lifecycle.view') ON CONFLICT DO NOTHING;`);
  // Every review command, including retries, denials and injected audit failures,
  // must preserve all historical/canonical monetary rows and the outbox exactly.
  const review = async (...args) => {
    const before = await snapshot();
    try {
      return await service.review(...args);
    } finally {
      assert.deepEqual(await snapshot(), before);
    }
  };
  const addInvoice = async (options = {}) =>
    one(
      `INSERT INTO contract_invoices(contract_id,supplier_id,invoice_number,invoice_date,amount,net_payable_amount,currency,created_by) VALUES($1,$2,$3,$4,$5,$5,$6,$7) RETURNING *`,
      [
        options.contract_id ?? c.contract.id,
        options.supplier_id ?? c.supplier.id,
        options.number ?? inv.invoice_number,
        options.date ?? inv.invoice_date,
        options.amount ?? inv.total_amount,
        options.currency ?? "USD",
        options.created_by ?? 101,
      ],
    );
  // Supply archival payment-reference evidence in the fixture; never a migration or review side effect.
  await client.query(
    "UPDATE payment_records SET payment_reference='ARCHIVE-PAY-'||id WHERE request_id=$1",
    [c.request.id],
  );
  const a = await addInvoice();
  const partial = await one(
    `INSERT INTO contract_payments(contract_id,invoice_id,amount,currency,payment_reference,status,created_by) SELECT $1,$2,pa.amount,'USD',p.payment_reference,'paid',101 FROM payment_allocations pa JOIN payment_records p ON p.id=pa.payment_record_id WHERE pa.ap_payable_id=$3 ORDER BY pa.id LIMIT 1 RETURNING *`,
    [c.contract.id, a.id, ap.id],
  );
  const load = () =>
    service.worklist({ id: 106 }, { contractId: c.contract.id });
  const find = async (id, type = "legacy_invoice") =>
    (await load()).rows.find(
      (r) => r.source_id === String(id) && r.record_type === type,
    );
  const input = (
    row,
    decision = "CONFIRMED_MATCH",
    ids = [row.candidates.find((c) => !c.problems.length)?.id].filter(Boolean),
  ) => ({
    record_type: row.record_type,
    source_id: row.source_id,
    expected_version: row.version,
    fingerprint: row.fingerprint,
    decision,
    canonical_ids: ids,
    notes: "Reviewed original invoice and source references",
    supporting_evidence:
      "Archive receipt HIST-42; inspected by independent finance",
    command_key: key(),
  });
  let confirmed, command;
  await test("exact historical invoice remains possible until independent review", async () => {
    const r = await find(a.id);
    assert.equal(r.classification, "Possible match");
    command = input(r);
    confirmed = await review({ id: 106 }, command);
    assert.equal((await find(a.id)).classification, "Confirmed match");
    assert.equal(confirmed.review.reviewer_id, 106);
  });
  await test("duplicate reconciliation returns its original review without another audit", async () => {
    const before = await one("SELECT COUNT(*)::int n FROM audit_logs");
    const r = await review({ id: 106 }, command);
    assert.equal(r.review.id, confirmed.review.id);
    assert.equal(r.idempotent, true);
    assert.deepEqual(
      await one("SELECT COUNT(*)::int n FROM audit_logs"),
      before,
    );
  });
  await test("partial payment maps only to its exact canonical allocation", async () => {
    const row = await find(partial.id, "legacy_payment");
    const selected = row.candidates.find(
      (x) =>
        !x.problems.length &&
        require("../services/purchaseOrderTotalsService").compareDecimal(
          x.amount,
          partial.amount,
        ) === 0,
    );
    assert.ok(selected, JSON.stringify(row.candidates));
    await review({ id: 106 }, input(row, "CONFIRMED_MATCH", [selected.id]));
    assert.equal(
      (await find(partial.id, "legacy_payment")).classification,
      "Confirmed match",
    );
  });
  await test("same amount with different supplier cannot confirm", async () => {
    const i = await addInvoice({ supplier_id: 901 });
    const r = await find(i.id);
    assert.notEqual(r.classification, "Possible match");
    await assert.rejects(
      () => review({ id: 106 }, input(r, "CONFIRMED_MATCH", [String(inv.id)])),
      { code: "RECONCILIATION_EVIDENCE_REQUIRED" },
    );
  });
  await test("same supplier but different invoice is not an exact relationship", async () => {
    const i = await addInvoice({ number: "DIFFERENT-BILL" });
    const r = await find(i.id);
    assert.ok(
      r.candidates.every((c) =>
        c.problems.includes("INVOICE_IDENTITY_MISMATCH"),
      ),
    );
    await assert.rejects(
      () => review({ id: 106 }, input(r, "CONFIRMED_MATCH", [String(inv.id)])),
      { code: "RECONCILIATION_EVIDENCE_REQUIRED" },
    );
  });
  await test("different currency remains a conflict without conversion", async () => {
    const i = await addInvoice({ currency: "EUR" });
    const r = await find(i.id);
    assert.equal(r.classification, "Conflicting");
    await assert.rejects(
      () => review({ id: 106 }, input(r, "CONFIRMED_MATCH", [String(inv.id)])),
      { code: "RECONCILIATION_EVIDENCE_REQUIRED" },
    );
  });
  await test("unmatched historical payment and missing source require investigation", async () => {
    const row = (await load()).rows.find(
      (x) =>
        x.record_type === "legacy_payment" &&
        !x.source_snapshot.source.invoice_id,
    );
    assert.equal(row.classification, "Insufficient evidence");
    await review({ id: 106 }, input(row, "NEEDS_INVESTIGATION", []));
    assert.equal(
      (await find(row.source_id, "legacy_payment")).review.decision,
      "NEEDS_INVESTIGATION",
    );
  });
  await test("foreign institute excluded from listing and direct IDs", async () => {
    await assert.rejects(
      () => service.worklist({ id: 105 }, { contractId: c.contract.id }),
      { statusCode: 404 },
    );
    await assert.rejects(() => review({ id: 105 }, command), {
      statusCode: 404,
    });
    assert.ok(
      (await service.worklist({ id: 105 })).rows.every(
        (r) => r.institute_id === 102,
      ),
    );
  });
  await test("contract manager has no finance review authority", async () => {
    await assert.rejects(() => service.worklist({ id: 103 }), {
      statusCode: 403,
    });
    await assert.rejects(() => review({ id: 103 }, command), {
      statusCode: 403,
    });
  });
  await test("maker cannot confirm own historical or canonical records", async () => {
    const i = await addInvoice({
      number: inv2.invoice_number,
      amount: inv2.total_amount,
      created_by: 106,
    });
    const r = await find(i.id);
    await assert.rejects(
      () => review({ id: 106 }, input(r, "CONFIRMED_MATCH", [String(inv2.id)])),
      { code: "RECONCILIATION_SEGREGATION_REQUIRED" },
    );
  });
  await test("possible duplicate cannot claim an already mapped obligation", async () => {
    const i = await addInvoice();
    const r = await find(i.id);
    await assert.rejects(
      () => review({ id: 107 }, input(r, "CONFIRMED_MATCH", [String(inv.id)])),
      { code: "RECONCILIATION_MAPPING_CONFLICT" },
    );
  });
  await test("concurrent review retains one winning revision and audit", async () => {
    const r = await find(a.id);
    const result = await Promise.allSettled(
      [106, 107].map((id) =>
        review({ id }, input(r, "NEEDS_INVESTIGATION", [])),
      ),
    );
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      result.find((r) => r.status === "rejected").reason.code,
      "RECONCILIATION_VERSION_CONFLICT",
    );
    assert.equal((await find(a.id)).version, 2);
  });
  await test("audit failure rolls back review ledger", async () => {
    const r = await find(a.id);
    const before = await one(
      "SELECT COUNT(*)::int n FROM contract_financial_reviews",
    );
    await assert.rejects(
      () =>
        review({ id: 106 }, input(r, "CONFLICTING", []), {
          auditService: {
            writeAuditEvent: async () => {
              throw new Error("Injected audit failure");
            },
          },
        }),
      /Injected audit/,
    );
    assert.deepEqual(
      await one("SELECT COUNT(*)::int n FROM contract_financial_reviews"),
      before,
    );
  });
  await test("rejection and conflict preserve complete decision history", async () => {
    let r = await find(a.id);
    await review({ id: 106 }, input(r, "REJECTED_PROPOSAL", [String(inv.id)]));
    r = await find(a.id);
    await review({ id: 106 }, input(r, "CONFLICTING", []));
    r = await find(a.id);
    assert.equal(r.history.length, 4);
    assert.equal(r.classification, "Conflicting");
  });
  await test("multiple allocations are separate evidence, never an amount-only match", async () => {
    const p = await one(
      `INSERT INTO contract_payments(contract_id,invoice_id,amount,currency,payment_reference,status,created_by) VALUES($1,$2,20,'USD','PARTIAL-UNKNOWN','paid',101) RETURNING *`,
      [c.contract.id, a.id],
    );
    const r = await find(p.id, "legacy_payment");
    assert.ok(r.candidates.length >= 2);
    await assert.rejects(
      () =>
        review({ id: 106 }, input(r, "CONFIRMED_MATCH", [r.candidates[0].id])),
      { code: "RECONCILIATION_EVIDENCE_REQUIRED" },
    );
  });
  await test("multiple supported allocations must sum exactly to the reviewed historical payment", async () => {
    await client.query(
      "UPDATE payment_records SET payment_reference='ARCHIVE-BATCH-25' WHERE supplier_invoice_id=$1",
      [inv2.id],
    );
    const li = await addInvoice({
      number: inv2.invoice_number,
      amount: inv2.total_amount,
    });
    const lp = await one(
      "INSERT INTO contract_payments(contract_id,invoice_id,amount,currency,payment_reference,status,created_by) VALUES($1,$2,25,'USD','ARCHIVE-BATCH-25','paid',101) RETURNING *",
      [c.contract.id, li.id],
    );
    const row = await find(lp.id, "legacy_payment");
    const ids = row.candidates
      .filter((c) => !c.problems.length)
      .map((c) => c.id);
    assert.equal(ids.length, 2);
    await assert.rejects(
      () => review({ id: 106 }, input(row, "CONFIRMED_MATCH", [ids[0]])),
      { code: "RECONCILIATION_ALLOCATION_MISMATCH" },
    );
    await review({ id: 106 }, input(row, "CONFIRMED_MATCH", ids));
    assert.equal(
      (await find(lp.id, "legacy_payment")).classification,
      "Confirmed match",
    );
  });
  await test("changed source makes reviews stale and blocks stale submissions", async () => {
    const r = await find(a.id);
    await client.query(
      "UPDATE contract_invoices SET invoice_number=$2 WHERE id=$1",
      [a.id, "CORRECTED-BILL"],
    );
    assert.equal((await find(a.id)).stale_review, true);
    await assert.rejects(
      () => review({ id: 106 }, input(r, "NEEDS_INVESTIGATION", [])),
      { code: "RECONCILIATION_VERSION_CONFLICT" },
    );
    await client.query(
      "UPDATE contract_invoices SET invoice_number=$2 WHERE id=$1",
      [a.id, inv.invoice_number],
    );
  });
  await test("authorized totals retain currency and stage separation", async () => {
    const data = await load();
    assert.ok(data.report.totals.some((t) => t.currency === "EUR"));
    assert.ok(
      data.report.totals.some((t) => t.record_type === "legacy_payment"),
    );
    assert.equal(
      data.report.acceptance.financial_execution_holds_released,
      false,
    );
    for (const t of data.report.totals) {
      const sum = require("../services/purchaseOrderTotalsService").addDecimal(
        ...data.rows
          .filter(
            (r) =>
              r.currency === t.currency &&
              r.record_type === t.record_type &&
              r.classification !== "Confirmed match",
          )
          .map((r) => r.amount),
      );
      assert.equal(t.legacy_unreconciled_value, sum);
    }
  });
  await test("AP corruption fails acceptance", async () => {
    await client.query(
      "UPDATE ap_payables SET open_balance=open_balance+1 WHERE id=$1",
      [ap3.id],
    );
    assert.equal(
      (await load()).report.acceptance.canonical_integrity_passed,
      false,
    );
    await client.query(
      "UPDATE ap_payables SET open_balance=open_balance-1 WHERE id=$1",
      [ap3.id],
    );
  });
  await test("review rows are append-only", async () => {
    await assert.rejects(
      () => client.query("DELETE FROM contract_financial_reviews"),
      { code: "23514" },
    );
    await assert.rejects(
      () =>
        client.query("UPDATE contract_financial_reviews SET notes='rewrite'"),
      { code: "23514" },
    );
  });
  await test("concurrent different historical sources cannot confirm the same canonical invoice", async () => {
    const x = await addInvoice({
      number: inv2.invoice_number,
      amount: inv2.total_amount,
    });
    const y = await addInvoice({
      number: inv2.invoice_number,
      amount: inv2.total_amount,
    });
    const rows = await Promise.all([find(x.id), find(y.id)]);
    const result = await Promise.allSettled(
      rows.map((row, n) =>
        review(
          { id: n ? 107 : 106 },
          input(row, "CONFIRMED_MATCH", [String(inv2.id)]),
        ),
      ),
    );
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      result.find((r) => r.status === "rejected").reason.code,
      "RECONCILIATION_MAPPING_CONFLICT",
    );
  });
  await test("an identified historical invoice without a canonical source is unmatched", async () => {
    const contract = await one(
      "INSERT INTO contracts(title,vendor,institute_id,supplier_id,currency,status,contract_value,created_by) VALUES('Unmatched review','Supplier',101,$1,'USD','active',100,101) RETURNING id",
      [c.supplier.id],
    );
    const legacy = await addInvoice({
      contract_id: contract.id,
      number: "UNMATCHED-ARCHIVE-42",
    });
    const data = await service.worklist(
      { id: 106 },
      { contractId: contract.id },
    );
    assert.equal(
      data.rows.find((r) => r.source_id === String(legacy.id)).classification,
      "Unmatched",
    );
    const payment = await one(
      "INSERT INTO contract_payments(contract_id,invoice_id,amount,currency,payment_reference,status,created_by) VALUES($1,$2,5,'USD','UNMATCHED-PAY-42','paid',101) RETURNING *",
      [contract.id, legacy.id],
    );
    const refreshed = await service.worklist(
      { id: 106 },
      { contractId: contract.id },
    );
    assert.equal(
      refreshed.rows.find(
        (r) =>
          r.record_type === "legacy_payment" &&
          r.source_id === String(payment.id),
      ).classification,
      "Unmatched",
    );
    assert.equal(data.report.totals[0].potential_duplicate_exposure, "0.00");
  });
  await test("malformed review evidence and reused commands fail explicitly", async () => {
    const row = await find(a.id);
    await assert.rejects(
      () =>
        review(
          { id: 106 },
          { ...input(row, "NEEDS_INVESTIGATION", []), notes: {} },
        ),
      { statusCode: 400 },
    );
    await assert.rejects(
      () => review({ id: 106 }, { ...command, notes: "Different payload" }),
      { code: "RECONCILIATION_IDEMPOTENCY_CONFLICT" },
    );
  });
  await test("manual patch denies public client access and limits service-role writes to append", async () => {
    const grants = await one(
      "SELECT has_table_privilege('anon','public.contract_financial_reviews','SELECT') anonymous_read,has_table_privilege('authenticated','public.contract_financial_reviews','INSERT') client_write,has_table_privilege('service_role','public.contract_financial_reviews','INSERT') service_insert,has_table_privilege('service_role','public.contract_financial_reviews','UPDATE') service_update,has_table_privilege('service_role','public.contract_financial_reviews','TRUNCATE') service_truncate",
    );
    assert.deepEqual(grants, {
      anonymous_read: false,
      client_write: false,
      service_insert: true,
      service_update: false,
      service_truncate: false,
    });
    await assert.rejects(
      () => client.query("TRUNCATE contract_financial_reviews"),
      { code: "23514" },
    );
    assert.equal((await load()).report.acceptance.review_audit_complete, true);
  });
  await test("missing historical maker identity requires investigation rather than assumed independence", async () => {
    const li = await addInvoice();
    await client.query(
      "UPDATE contract_invoices SET created_by=NULL WHERE id=$1",
      [li.id],
    );
    const row = await find(li.id);
    assert.equal(row.classification, "Insufficient evidence");
    await assert.rejects(
      () =>
        review({ id: 106 }, input(row, "CONFIRMED_MATCH", [String(inv.id)])),
      { code: "RECONCILIATION_EVIDENCE_REQUIRED" },
    );
  });
  await test("payment review snapshots include the linked historical invoice and detect its revision", async () => {
    const before = await find(partial.id, "legacy_payment");
    assert.equal(
      String(before.source_snapshot.legacy_invoice.id),
      String(a.id),
    );
    await client.query(
      "UPDATE contract_invoices SET invoice_date=invoice_date+1 WHERE id=$1",
      [a.id],
    );
    const after = await find(partial.id, "legacy_payment");
    assert.notEqual(before.fingerprint, after.fingerprint);
    assert.equal(after.stale_review, true);
    await client.query(
      "UPDATE contract_invoices SET invoice_date=invoice_date-1 WHERE id=$1",
      [a.id],
    );
  });
  await test("posted voucher currency mismatch fails acceptance without changing financial values", async () => {
    await client.query("UPDATE ap_vouchers SET currency='EUR' WHERE id=$1", [
      ap.ap_voucher_id,
    ]);
    assert.equal(
      (await load()).report.acceptance.canonical_integrity_passed,
      false,
    );
    await client.query("UPDATE ap_vouchers SET currency='USD' WHERE id=$1", [
      ap.ap_voucher_id,
    ]);
  });
  const finalHistory = await snapshot();
  await test("reviews and reports create no financial, historical or outbox changes", async () => {
    await review(
      { id: 106 },
      input(await find(a.id), "NEEDS_INVESTIGATION", []),
    );
    await load();
    assert.deepEqual(await snapshot(), finalHistory);
  });
  await test("repeat patch preserves populated financial and review evidence", async () => {
    const before = await one(
      "SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) h FROM contract_financial_reviews r",
    );
    const sql = fs.readFileSync(
      require("node:path").join(
        __dirname,
        "../sql/manual/066_contract_financial_reconciliation.sql",
      ),
      "utf8",
    );
    await client.query(sql);
    await client.query(sql);
    assert.deepEqual(await snapshot(), finalHistory);
    assert.deepEqual(
      await one(
        "SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) h FROM contract_financial_reviews r",
      ),
      before,
    );
  });
  await test("projection retains exact canonical paid totals and every revision is audited", async () => {
    const actor =
      await require("../services/contractAuthorizationService").actor(
        { id: 101 },
        client,
      );
    const contract =
      await require("../services/contractAuthorizationService").root(
        client,
        actor,
        c.contract.id,
        "manage",
        false,
      );
    const p =
      await require("../services/contractFinancialProjectionService").project(
        client,
        contract,
        actor,
      );
    assert.equal(p.metrics.paid_amount, "45");
    assert.equal(p.reconciliation_required, true);
    const r = await one(
      "SELECT (SELECT COUNT(*)::int FROM contract_financial_reviews) reviews,(SELECT COUNT(*)::int FROM audit_logs WHERE action='CONTRACT_FINANCIAL_RECONCILIATION_REVIEWED') audits",
    );
    assert.equal(r.reviews, r.audits);
  });
  console.log(
    `Historical contract reconciliation PostgreSQL cases passed: ${count}`,
  );
}
module.exports = { run };
