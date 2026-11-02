"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { disposableDatabaseUrl } = require("./disposableDatabase");
async function run(client, url) {
  process.env.DATABASE_URL = disposableDatabaseUrl(url);
  process.env.NODE_ENV = "test";
  process.env.PGOPTIONS = "-c statement_timeout=10000 -c lock_timeout=5000";
  const pool = require("../config/db");
  const handlers = require("../controllers/contractsController");
  let passed = 0;
  const call = async (
    name,
    { user = 101, params = { id: 101 }, body = {} } = {},
  ) => {
    const result = { status: 200 };
    const res = {
      status(n) {
        result.status = n;
        return this;
      },
      set() {
        return this;
      },
      json(data) {
        result.data = data;
        return this;
      },
    };
    await handlers[name](
      {
        user: user == null ? null : { id: user },
        params,
        body,
        query: {},
        method: "POST",
      },
      res,
      (e) => {
        result.status = e.statusCode || 500;
        result.code = e.code;
        result.message = e.message;
      },
    );
    return result;
  };
  const hardDelete = async (requestId) => {
    const result = { status: 200 };
    const actor =
      await require("../services/contractAuthorizationService").actor(
        { id: 101 },
        pool,
      );
    await require("../controllers/requests/updateRequestsController").deleteRequestCompletely(
      { params: { id: requestId }, user: actor },
      {
        json(data) {
          result.data = data;
          return this;
        },
      },
      (e) => {
        result.status = e.statusCode || 500;
        result.code = e.code;
      },
    );
    return result;
  };
  const test = async (name, fn) => {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  };
  const snapshot = async () => {
    const out = {};
    for (const table of [
      "contracts",
      "contract_invoices",
      "contract_payments",
      "contract_consumption",
      "supplier_invoices",
      "invoice_items",
      "ap_payables",
      "ap_vouchers",
      "ap_voucher_lines",
      "payment_records",
      "payment_allocations",
      "finance_postings",
      "journal_entries",
      "journal_entry_lines",
      "gl_postings",
      "gl_posting_lines",
      "budget_envelopes",
      "commitment_ledger",
      "inventory_transactions",
      "warehouse_stock_levels",
      "audit_logs",
      "notification_outbox",
      "document_flow_links",
    ])
      out[table] = (
        await client.query(
          `SELECT count(*)::text count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) digest FROM ${table} t`,
        )
      ).rows[0];
    return out;
  };
  const blocked = async (name, options = {}, expected = 410) => {
    const before = await snapshot();
    const r = await call(name, options);
    assert.equal(r.status, expected, `${name}: ${r.code} ${r.message}`);
    if (expected === 410)
      assert.equal(r.code, "LEGACY_CONTRACT_FINANCIAL_MIGRATION_REQUIRED");
    assert.deepEqual(await snapshot(), before);
    return r;
  };
  try {
    await client.query(`INSERT INTO institutes(id,name) VALUES(101,'Contract A'),(102,'Contract B');
 INSERT INTO departments(id,name,type,institute_id) VALUES(101,'A','Operational',101),(102,'B','Operational',102);
 INSERT INTO users(id,name,email,password,role,institute_id,department_id,is_active) VALUES
 (101,'Manager','ca@example.invalid','test','custom manager',101,101,true),(102,'Foreign','cb@example.invalid','test','custom manager',102,102,true),
 (103,'Viewer','cv@example.invalid','test','custom viewer',101,101,true),(104,'Unrelated','cu@example.invalid','test','Admin',101,101,true),(105,'Reviewer','cr@example.invalid','test','legal',101,101,true);
 INSERT INTO suppliers(id,name,institute_id) VALUES(101,'Supplier A',101),(102,'Supplier B',102);
 INSERT INTO contracts(id,title,vendor,status,institute_id,end_user_department_id,created_by,supplier_id) VALUES
 (101,'A','Supplier A','active',101,101,103,101),(102,'B','Supplier B','active',102,102,102,102),(103,'Unresolved','A','draft',NULL,NULL,101,NULL),(104,'Legacy department','A','draft',NULL,101,103,101);
 INSERT INTO user_permissions(user_id,permission_id) SELECT u,p.id FROM unnest(ARRAY[101,102]) u CROSS JOIN permissions p WHERE p.code IN ('contracts.manage','procure-to-pay.lifecycle.view','procure-to-pay.invoices.manage','finance.payment.manage');
 INSERT INTO contract_documents(id,contract_id,title,document_type) VALUES(101,101,'A','other'),(102,102,'B','other');
 INSERT INTO contract_document_versions(id,contract_id,document_id,version_number) VALUES(101,101,101,1),(102,102,102,1);
 INSERT INTO contract_obligations(id,contract_id,title,owner_user_id,due_date,recurrence,next_due_date) VALUES(101,101,'Recurring A',103,CURRENT_DATE,'monthly',CURRENT_DATE+30),(102,102,'B',102,CURRENT_DATE,'none',NULL);
 INSERT INTO contract_renewal_events(id,contract_id,renewal_date,alert_date) VALUES(101,101,CURRENT_DATE,CURRENT_DATE),(102,102,CURRENT_DATE,CURRENT_DATE);
 INSERT INTO contract_invoices(id,contract_id,supplier_id,invoice_number,amount) VALUES(101,101,101,'IA',10),(102,102,102,'IB',10);
 INSERT INTO contract_payments(id,contract_id,invoice_id,amount) VALUES(102,102,102,1);
 INSERT INTO contract_risk_assessments(contract_id,risk_score,risk_level) VALUES(101,80,'high'),(102,90,'critical');`);
    await client.query(
      "UPDATE contract_invoices SET amount=100,net_payable_amount=100,currency='USD',status='approved' WHERE id=101;UPDATE contracts SET currency='USD',contract_value=100,amount_paid=0,actual_consumed_value=0 WHERE id=101",
    );
    if (process.argv.includes("--legacy-settlement-probe")) {
      const body = {
        invoice_id: 101,
        amount: 30,
        currency: "USD",
        payment_date: "2026-11-01",
        payment_reference: "same-logical-payment",
      };
      const retries = await Promise.all([
        call("createContractPayment", { body }),
        call("createContractPayment", { body }),
      ]);
      const rows = (
        await client.query(
          "SELECT id FROM contract_payments WHERE contract_id=101 ORDER BY id",
        )
      ).rows;
      const edits =
        rows.length >= 2
          ? await Promise.all(
              rows.slice(0, 2).map((p) =>
                call("updateContractPayment", {
                  params: { id: 101, paymentId: p.id },
                  body: { amount: 60 },
                }),
              ),
            )
          : [];
      const totals = (
        await client.query(
          "SELECT (SELECT SUM(amount) FROM contract_payments WHERE contract_id=101 AND status='paid')::text paid_total,(SELECT amount_paid::text FROM contracts WHERE id=101) header_paid,(SELECT status FROM contract_invoices WHERE id=101) invoice_status",
        )
      ).rows[0];
      const currency = rows.length
        ? await call("updateContractPayment", {
            params: { id: 101, paymentId: rows[0].id },
            body: { currency: "EUR" },
          })
        : null;
      const noInvoice = await call("createContractPayment", {
        body: { amount: 1, currency: "USD", payment_date: "2026-11-01" },
      });
      await client.query(
        "INSERT INTO user_permissions(user_id,permission_id) SELECT 101,id FROM permissions WHERE code='requests.manage' ON CONFLICT DO NOTHING;INSERT INTO requests(id,request_type,requester_id,department_id,institute_id,status) VALUES(104,'Non-Stock',101,101,101,'Submitted');UPDATE contracts SET source_request_id=104,amount_paid=5 WHERE id=104",
      );
      const deletion = await hardDelete(104);
      const source = (
        await client.query(
          "SELECT source_request_id FROM contracts WHERE id=104",
        )
      ).rows[0].source_request_id;
      const observations = {
        duplicateRetryStatuses: retries.map((r) => r.status),
        concurrentEditStatuses: edits.map((r) => r.status),
        ...totals,
        currencyEditStatus: currency?.status,
        missingInvoiceStatus: noInvoice.status,
        financialRequestHardDeleteStatus: deletion.status,
        retainedContractSourceAfterDelete: source,
      };
      fs.writeFileSync(
        "/tmp/aud001-baseline-observation.json",
        JSON.stringify(observations, null, 2) + "\n",
      );
      console.log(JSON.stringify(observations));
      return;
    }
    await test("anonymous and unauthorized legacy payment denied before containment", async () => {
      await blocked(
        "createContractPayment",
        { user: null, body: { amount: 1 } },
        401,
      );
      await blocked(
        "createContractPayment",
        { user: 103, body: { amount: 1 } },
        403,
      );
    });
    await test("foreign institute cannot use a legacy settlement route", () =>
      blocked(
        "createContractPayment",
        { params: { id: 102 }, body: { amount: 1 } },
        404,
      ));
    for (const [name, params, body] of [
      [
        "createContractInvoice",
        { id: 101 },
        { invoice_number: "NEW", invoice_date: "2026-11-01", amount: 1 },
      ],
      ["updateContractInvoice", { id: 101, invoiceId: 101 }, { amount: 200 }],
      ["matchContractInvoice", { id: 101, invoiceId: 101 }, {}],
      [
        "updateContractInvoiceStatus",
        { id: 101, invoiceId: 101 },
        { status: "paid" },
      ],
      [
        "createContractPayment",
        { id: 101 },
        { invoice_id: 101, amount: 60, currency: "USD" },
      ],
      ["updateContractPayment", { id: 102, paymentId: 102 }, { amount: 200 }],
      [
        "updateContractPaymentStatus",
        { id: 102, paymentId: 102 },
        { status: "paid" },
      ],
      [
        "createContractConsumptionEntry",
        { id: 101 },
        { amount: 100, source_type: "manual", consumption_date: "2026-11-01" },
      ],
    ])
      await test(`unsupported legacy writer is quarantined: ${name}`, () =>
        blocked(name, { user: params.id === 102 ? 102 : 101, params, body }));
    await test("duplicate and concurrent legacy payment retries create no settlement", async () => {
      const before = await snapshot();
      const body = {
        invoice_id: 101,
        amount: 60,
        currency: "USD",
        payment_reference: "duplicate",
      };
      for (const r of await Promise.all([
        call("createContractPayment", { body }),
        call("createContractPayment", { body }),
        call("createContractPayment", { body }),
      ]))
        assert.equal(r.status, 410);
      assert.deepEqual(await snapshot(), before);
    });
    await test("legacy overpayment, absent invoice and currency mismatch fail closed", async () => {
      for (const body of [
        { invoice_id: 101, amount: 101, currency: "USD" },
        { amount: 1, currency: "USD" },
        { invoice_id: 101, amount: 1, currency: "EUR" },
      ])
        await blocked("createContractPayment", { body });
    });
    await test("foreign invoice reference is rejected without mutation", () =>
      blocked(
        "createContractPayment",
        { body: { invoice_id: 102, amount: 1, currency: "USD" } },
        404,
      ));
    for (const name of ["createContract", "updateContract", "renewContract"])
      await test(`paid header cannot bypass containment: ${name}`, () =>
        blocked(name, {
          params: name === "createContract" ? {} : { id: 101 },
          body: {
            title: "New",
            vendor: "Supplier A",
            main_technical_department_id: 101,
            amount_paid: "1.00",
          },
        }));
    await test("consumed header cannot bypass containment", () =>
      blocked("updateContract", { body: { actual_consumed_value: "1" } }));
    await test("null header reset and precision differences cannot erase historical amounts", async () => {
      await client.query("UPDATE contracts SET amount_paid=10 WHERE id=101");
      await blocked("updateContract", { body: { amount_paid: null } });
      await blocked("updateContract", {
        body: { amount_paid: "10.0000000000000000001" },
      });
    });
    await test("ordinary metadata update preserves identical financial history", async () => {
      const r = await call("updateContract", {
        body: {
          description: "Metadata only",
          amount_paid: "10.000",
          actual_consumed_value: "0",
        },
      });
      assert.equal(r.status, 200, r.message);
      const c = (
        await client.query(
          "SELECT amount_paid::text,actual_consumed_value::text FROM contracts WHERE id=101",
        )
      ).rows[0];
      assert.equal(Number(c.amount_paid), 10);
      assert.equal(Number(c.actual_consumed_value), 0);
    });
    await test("historical reads and existing financial summary remain unchanged", async () => {
      const before = await snapshot();
      for (const name of [
        "listContractInvoices",
        "listContractPayments",
        "listContractConsumptionEntries",
        "getContractInvoice",
        "getContractFinancialSummary",
      ]) {
        const r = await call(name, { params: { id: 101, invoiceId: 101 } });
        assert.equal(r.status, 200, r.message);
        if (name === "getContractFinancialSummary") {
          assert.equal(r.data.total_invoiced, 100);
          assert.equal(r.data.total_paid, 0);
        }
      }
      assert.deepEqual(await snapshot(), before);
    });
    await test("metadata audit failure rolls back without changing financial, GL, budget or stock records", async () => {
      await client.query(
        "CREATE FUNCTION reject_containment_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable';END $$;CREATE TRIGGER reject_containment_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_containment_test_audit()",
      );
      const before = await snapshot();
      const r = await call("updateContract", {
        body: { description: "Must rollback" },
      });
      assert.equal(r.status, 500);
      assert.deepEqual(await snapshot(), before);
      await client.query(
        "DROP TRIGGER reject_containment_test_audit ON audit_logs;DROP FUNCTION reject_containment_test_audit()",
      );
    });
    await test("unmounted governance payment export is also contained", async () => {
      const original = handlers.createContractPayment;
      handlers.createContractPayment =
        require("../controllers/contractGovernanceController").createContractPayment;
      await blocked("createContractPayment", {
        body: { amount: 1, payment_date: "2026-11-01" },
      });
      handlers.createContractPayment = original;
    });
    await client.query(`INSERT INTO requests(id,request_type,requester_id,department_id,institute_id,status) VALUES(101,'Non-Stock',101,101,101,'Approved');
 INSERT INTO purchase_orders(id,request_id,supplier_id,po_number,status,currency,total_amount) VALUES(101,101,101,'SETTLEMENT-PO','PO_ISSUED','USD',100);
 INSERT INTO supplier_invoices(id,request_id,purchase_order_id,supplier_id,supplier,invoice_number,normalized_invoice_number,invoice_date,subtotal_amount,total_amount,currency,status,contract_id) VALUES(101,101,101,101,'Supplier A','MATCH-1','match-1','2026-11-01',100,100,'USD','AP_POSTED',101);
 INSERT INTO ap_vouchers(id,request_id,supplier_invoice_id,voucher_number,total_amount,voucher_status) VALUES(101,101,101,'SETTLEMENT-AP',100,'posted');
 INSERT INTO finance_postings(request_id,ap_voucher_id,supplier_invoice_id,posting_status,liability_recognized_amount) VALUES(101,101,101,'posted',100);
 INSERT INTO ap_payables(id,request_id,supplier_invoice_id,ap_voucher_id,supplier_id,supplier_name,invoice_total,open_balance,currency,payable_status) VALUES(101,101,101,101,101,'Supplier A',100,100,'USD','OPEN');
 INSERT INTO contract_invoices(id,contract_id,supplier_id,invoice_number,invoice_date,amount,net_payable_amount,currency) VALUES(107,101,101,'MATCH-1','2026-11-01',100,100,'USD');
 INSERT INTO contract_payments(id,contract_id,invoice_id,amount,currency,payment_date,payment_reference,status) VALUES(107,101,107,30,'USD','2026-11-01','CANDIDATE-PAYMENT','paid');`);
    const { postPayment } = require("../services/paymentService");
    const {
      createTransactionalP2PRepository,
    } = require("../repositories/connectedP2PRepository");
    const args = {
      repository: createTransactionalP2PRepository(pool),
      payableId: 101,
      actor: { id: 101 },
      amount: "30",
      currency: "USD",
      paymentReference: "CANDIDATE-PAYMENT",
      idempotencyKey: "aud001-canonical-payment",
    };
    await test("canonical payable payment remains operational and idempotent", async () => {
      const before = await snapshot();
      const result = await postPayment(args);
      assert.equal(result.open_balance, "70.00");
      const after = await snapshot();
      const retry = await postPayment(args);
      assert.equal(retry.idempotent, true);
      assert.deepEqual(await snapshot(), after);
      for (const t of [
        "contracts",
        "contract_invoices",
        "contract_payments",
        "contract_consumption",
        "journal_entries",
        "journal_entry_lines",
        "gl_postings",
        "gl_posting_lines",
        "inventory_transactions",
        "warehouse_stock_levels",
        "budget_envelopes",
        "commitment_ledger",
      ])
        assert.deepEqual(after[t], before[t]);
    });
    await test("canonical payment rejects excess value, wrong currency and unauthorized actors", async () => {
      for (const patch of [
        { amount: "71", idempotencyKey: "excess" },
        { currency: "EUR", idempotencyKey: "currency" },
        { actor: { id: 103 }, idempotencyKey: "no-authority" },
      ]) {
        const before = await snapshot();
        await assert.rejects(postPayment({ ...args, ...patch }), (e) =>
          [403, 409].includes(e.statusCode),
        );
        assert.deepEqual(await snapshot(), before);
      }
    });
    await test("canonical payment audit failure rolls back allocations, balances and outbox", async () => {
      const before = await snapshot();
      await assert.rejects(
        postPayment({
          ...args,
          amount: "1",
          idempotencyKey: "rollback-payment",
          auditService: {
            writeAuditEvent: async () => {
              throw new Error("audit unavailable");
            },
          },
        }),
        /audit unavailable/,
      );
      assert.deepEqual(await snapshot(), before);
    });
    await test("read-only reconciliation reports candidates without merging or mutating records", async () => {
      const report = require("../scripts/lib/contractSettlementReconciliation");
      const before = await snapshot();
      const r = await report.collect(client, { instituteId: 101 });
      assert.deepEqual(await snapshot(), before);
      const invoice = r.rows.find(
        (x) => x.record_type === "legacy_invoice" && x.source_id === "107",
      );
      assert.equal(invoice.classification, "Possible match");
      assert.deepEqual(invoice.candidate_ids.map(Number), [101]);
      assert(
        r.rows.some(
          (x) =>
            x.record_type === "legacy_payment" &&
            x.source_id === "107" &&
            x.classification === "Possible match",
        ),
      );
      assert(
        r.rows.some(
          (x) =>
            x.record_type === "canonical_payment_allocation" &&
            x.classification === "Confirmed match",
        ),
      );
      assert(r.rows.every((x) => x.evidence.institute_id === 101));
      const unowned = await report.collect(client, {
        instituteId: 101,
        includeUnowned: true,
      });
      assert(
        unowned.rows.some(
          (x) =>
            x.record_type === "contract_balance" &&
            x.source_id === "103" &&
            x.classification === "Insufficient evidence",
        ),
      );
      assert(!unowned.rows.some((x) => x.evidence.institute_id === 102));
    });
    await test("report preserves installments and classifies currency conflicts instead of adding duplicate keys", async () => {
      await client.query(
        "INSERT INTO contract_payments(contract_id,invoice_id,amount,currency,payment_date,payment_reference,status) VALUES(101,107,30,'USD','2026-11-02','second installment','paid'),(101,107,1,'EUR','2026-11-03','FX review','paid')",
      );
      const report =
        await require("../scripts/lib/contractSettlementReconciliation").collect(
          client,
          { instituteId: 101 },
        );
      const parts = report.rows.filter(
        (x) =>
          x.record_type === "legacy_payment" && x.evidence.invoice_id === 107,
      );
      assert.equal(parts.length, 3);
      assert(
        parts.some(
          (x) =>
            x.classification === "Conflicting" &&
            x.reasons.includes("legacy_payment_invoice_currency_conflict"),
        ),
      );
    });
    await test("request hard-delete cannot delete canonical financial history", async () => {
      await client.query(
        "INSERT INTO user_permissions(user_id,permission_id) SELECT 101,id FROM permissions WHERE code='requests.manage' ON CONFLICT DO NOTHING",
      );
      const before = await snapshot();
      const r = await hardDelete(101);
      assert.equal(r.status, 409);
      assert.equal(r.code, "FINANCIAL_HISTORY_RETAINED");
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        (await client.query("SELECT 1 FROM requests WHERE id=101")).rowCount,
        1,
      );
    });
    await test("request hard-delete cannot detach an unmatched contract settlement source", async () => {
      await client.query(
        "INSERT INTO requests(id,request_type,requester_id,department_id,institute_id,status) VALUES(104,'Non-Stock',101,101,101,'Submitted');UPDATE contracts SET source_request_id=104,amount_paid=5 WHERE id=104",
      );
      const before = await snapshot();
      const r = await hardDelete(104);
      assert.equal(r.status, 409, r.code);
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        (
          await client.query(
            "SELECT source_request_id FROM contracts WHERE id=104",
          )
        ).rows[0].source_request_id,
        104,
      );
    });
    await test("ordinary request hard-delete remains available without financial evidence", async () => {
      await client.query(
        "INSERT INTO requests(id,request_type,requester_id,department_id,institute_id,status) VALUES(105,'Non-Stock',101,101,101,'Submitted');INSERT INTO contracts(id,title,vendor,institute_id,source_request_id,status,amount_paid,actual_consumed_value) VALUES(105,'Empty draft association','Supplier A',101,105,'draft',0,0)",
      );
      const before = await snapshot();
      const r = await hardDelete(105);
      assert.equal(r.status, 200, r.code);
      assert.equal(
        (await client.query("SELECT 1 FROM requests WHERE id=105")).rowCount,
        0,
      );
      const after = await snapshot();
      for (const table of Object.keys(before))
        if (table !== "contracts")
          assert.deepEqual(after[table], before[table]);
      const draft = (
        await client.query(
          "SELECT source_request_id,amount_paid::text,actual_consumed_value::text FROM contracts WHERE id=105",
        )
      ).rows[0];
      assert.equal(draft.source_request_id, null);
      assert.equal(Number(draft.amount_paid), 0);
      assert.equal(Number(draft.actual_consumed_value), 0);
    });
    await test("reconciliation preserves credit evidence, unmatched bills and ambiguous supplier identities", async () => {
      await client.query(`INSERT INTO suppliers(id,name,institute_id) VALUES(103,'Supplier A',101);
      INSERT INTO contracts(id,title,vendor,institute_id,end_user_department_id,status) VALUES(112,'Unmapped supplier','Supplier A',101,101,'active');
      INSERT INTO contract_invoices(id,contract_id,supplier_id,invoice_number,invoice_date,amount,net_payable_amount,currency) VALUES
      (110,101,101,'UNMATCHED-1','2026-11-01',10,10,'USD'),(111,101,101,'CREDIT-1','2026-11-01',-5,-5,'USD'),(112,112,NULL,'NAME-ONLY','2026-11-01',10,10,'USD');`);
      const before = await snapshot();
      const report =
        await require("../scripts/lib/contractSettlementReconciliation").collect(
          client,
          { instituteId: 101 },
        );
      assert.deepEqual(await snapshot(), before);
      const row = (id) =>
        report.rows.find(
          (x) => x.record_type === "legacy_invoice" && x.source_id === id,
        );
      assert.equal(row("110").classification, "Unmatched");
      assert.equal(row("111").classification, "Insufficient evidence");
      assert(
        row("111").reasons.includes("credit_or_adjustment_requires_review"),
      );
      assert.equal(row("112").classification, "Insufficient evidence");
      assert(
        row("112").reasons.includes(
          "ambiguous_supplier_name_not_used_as_identity",
        ),
      );
      assert.deepEqual(row("112").candidate_ids, []);
    });
    await test("legacy routing stays disabled", async () =>
      assert.equal(
        require("../services/approvalPolicyEngine").LIVE_ROUTING_ENABLED,
        false,
      ));
    console.log(`AUD-001 Phase 5A PostgreSQL cases passed: ${passed}`);
  } finally {
    await pool.end();
  }
}
module.exports = { run };
