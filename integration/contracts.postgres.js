"use strict";
const assert = require("node:assert/strict");
const { disposableDatabaseUrl } = require("./disposableDatabase");
async function run(client, url) {
  process.env.DATABASE_URL = disposableDatabaseUrl(url);
  process.env.NODE_ENV = "test";
  process.env.PGOPTIONS = "-c statement_timeout=10000 -c lock_timeout=5000";
  const pool = require("../config/db");
  const handlers = {
    ...require("../controllers/contractsController"),
    ...require("../controllers/contractEvaluationsController"),
  };
  let passed = 0;
  const call = async (
    name,
    user = 101,
    params = { id: 101 },
    body = {},
    query = {},
  ) => {
    const result = { status: 200 };
    const req = {
      user: user == null ? null : { id: user },
      params,
      body,
      query,
      method: "POST",
    };
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
    await handlers[name](req, res, (e) => {
      result.error = e;
      result.status = e.statusCode || 500;
    });
    return result;
  };
  const check = async (name, user, params, body, status = 200) => {
    const r = await call(name, user, params, body);
    assert.equal(
      r.status,
      status,
      `${name}: ${r.error?.stack || JSON.stringify(r.data)}`,
    );
    return r;
  };
  const test = async (name, fn) => {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  };
  try {
    await client.query(`INSERT INTO institutes(id,name) VALUES(101,'Contract A'),(102,'Contract B');
 INSERT INTO departments(id,name,type,institute_id) VALUES(101,'A','Operational',101),(102,'B','Operational',102);
 INSERT INTO users(id,name,email,password,role,institute_id,department_id,is_active) VALUES
 (101,'Manager','ca@example.invalid','test','custom manager',101,101,true),(102,'Foreign','cb@example.invalid','test','custom manager',102,102,true),
 (103,'Viewer','cv@example.invalid','test','custom viewer',101,101,true),(104,'Unrelated','cu@example.invalid','test','Admin',101,101,true),(105,'Reviewer','cr@example.invalid','test','legal',101,101,true);
 INSERT INTO suppliers(id,name,institute_id) VALUES(101,'Supplier A',101),(102,'Supplier B',102);
 INSERT INTO contracts(id,title,vendor,status,institute_id,end_user_department_id,created_by,supplier_id) VALUES
 (101,'A','Supplier A','draft',101,101,103,101),(102,'B','Supplier B','draft',102,102,102,102),(103,'Unresolved','A','draft',NULL,NULL,101,NULL),(104,'Legacy department','A','draft',NULL,101,103,101);
 INSERT INTO user_permissions(user_id,permission_id) SELECT u,p.id FROM unnest(ARRAY[101,102]) u CROSS JOIN permissions p WHERE p.code IN ('contracts.manage','procure-to-pay.lifecycle.view','procure-to-pay.invoices.manage','finance.payment.manage');
 INSERT INTO contract_documents(id,contract_id,title,document_type) VALUES(101,101,'A','other'),(102,102,'B','other');
 INSERT INTO contract_document_versions(id,contract_id,document_id,version_number) VALUES(101,101,101,1),(102,102,102,1);
 INSERT INTO contract_obligations(id,contract_id,title,owner_user_id,due_date,recurrence,next_due_date) VALUES(101,101,'Recurring A',103,CURRENT_DATE,'monthly',CURRENT_DATE+30),(102,102,'B',102,CURRENT_DATE,'none',NULL);
 INSERT INTO contract_renewal_events(id,contract_id,renewal_date,alert_date) VALUES(101,101,CURRENT_DATE,CURRENT_DATE),(102,102,CURRENT_DATE,CURRENT_DATE);
 INSERT INTO contract_invoices(id,contract_id,supplier_id,invoice_number,amount) VALUES(101,101,101,'IA',10),(102,102,102,'IB',10);
 INSERT INTO contract_payments(id,contract_id,invoice_id,amount) VALUES(102,102,102,1);
 INSERT INTO contract_risk_assessments(contract_id,risk_score,risk_level) VALUES(101,80,'high'),(102,90,'critical');`);
    for (const [label, name, user, params, body, status] of [
      ["anonymous denied", "getContractById", null, { id: 101 }, {}, 401],
      ["authorized viewer", "getContractById", 103, { id: 101 }, {}, 200],
      [
        "Admin name is not authorization",
        "getContractById",
        104,
        { id: 101 },
        {},
        404,
      ],
      ["foreign root", "getContractById", 101, { id: 102 }, {}, 404],
      [
        "creator placement is not provenance",
        "getContractById",
        101,
        { id: 103 },
        {},
        404,
      ],
      [
        "legacy department provenance",
        "getContractById",
        103,
        { id: 104 },
        {},
        200,
      ],
      [
        "forged institute",
        "updateContract",
        101,
        { id: 101 },
        { institute_id: 102 },
        400,
      ],
      [
        "unauthorized amendment",
        "createContractAmendment",
        103,
        { id: 101 },
        {},
        403,
      ],
      [
        "unauthorized lifecycle",
        "updateContract",
        103,
        { id: 101 },
        { status: "active" },
        403,
      ],
      [
        "foreign document",
        "getContractDocument",
        101,
        { id: 101, documentId: 102 },
        {},
        404,
      ],
      [
        "unauthorized document deletion",
        "deleteContractDocument",
        103,
        { id: 101, documentId: 101 },
        {},
        403,
      ],
      [
        "foreign version",
        "markContractDocumentVersionCurrent",
        101,
        { id: 101, documentId: 101, versionId: 102 },
        {},
        404,
      ],
      [
        "foreign obligation",
        "completeContractObligation",
        101,
        { id: 101, obligationId: 102 },
        {},
        404,
      ],
      [
        "foreign renewal",
        "decideContractRenewalEvent",
        101,
        { id: 101, renewalEventId: 102 },
        { decision: "renew" },
        404,
      ],
      [
        "financial read capability",
        "getContractInvoice",
        103,
        { id: 101, invoiceId: 101 },
        {},
        403,
      ],
      [
        "foreign payment",
        "updateContractPayment",
        101,
        { id: 101, paymentId: 102 },
        { amount: 2 },
        404,
      ],
      [
        "authorized financial manager",
        "getContractFinancialSummary",
        101,
        { id: 101 },
        {},
        200,
      ],
      [
        "AI foreign proposal",
        "requestContractAiExtraction",
        101,
        { id: 101 },
        { document_id: 101, document_version_id: 102 },
        404,
      ],
      [
        "unauthorized AI",
        "requestContractAiExtraction",
        103,
        { id: 101 },
        { document_id: 101 },
        403,
      ],
      ["retain signed evidence", "deleteContract", 101, { id: 101 }, {}, 409],
      [
        "foreign supplier",
        "updateContract",
        101,
        { id: 101 },
        { supplier_id: 102 },
        404,
      ],
    ])
      await test(label, () => check(name, user, params, body, status));
    await test("concurrent recurring retries create one successor", async () => {
      for (const r of await Promise.all([
        call("completeContractObligation", 103, { id: 101, obligationId: 101 }),
        call("completeContractObligation", 103, { id: 101, obligationId: 101 }),
      ]))
        assert.equal(r.status, 200, r.error?.stack);
      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM contract_obligations WHERE generated_from_obligation_id=101",
          )
        ).rows[0].count,
        "1",
      );
    });
    await test("risk isolation", async () => {
      const r = await check("listHighRiskContracts", 101, {}, {});
      assert.deepEqual(
        r.data.map((x) => Number(x.contract_id)),
        [101],
      );
    });
    await test("due soon worklist isolation", async () => {
      for (const n of [
        "listDueSoonContractObligations",
        "listDueSoonContractRenewals",
      ]) {
        const r = await check(n, 101, {}, {});
        assert(r.data.every((x) => Number(x.contract_id) === 101));
      }
    });
    await test("canonical attachment denies foreign institute", async () => {
      const f =
        require("../services/attachmentAuthorizationService").createAttachmentAuthorization(
          pool,
        );
      await assert.rejects(
        f.contract(await f.actor({ id: 101 }), 102),
        (e) => e.statusCode === 404,
      );
    });
    await test("concurrent changes retain both fields", async () => {
      for (const r of await Promise.all([
        call(
          "patchContractObligation",
          101,
          { id: 101, obligationId: 101 },
          { title: "Changed title" },
        ),
        call(
          "patchContractObligation",
          101,
          { id: 101, obligationId: 101 },
          { description: "Changed description" },
        ),
      ]))
        assert.equal(r.status, 200, r.error?.stack);
      assert.deepEqual(
        (
          await client.query(
            "SELECT title,description FROM contract_obligations WHERE id=101",
          )
        ).rows[0],
        { title: "Changed title", description: "Changed description" },
      );
    });
    await test("audit failure rolls back business write", async () => {
      await client.query(
        `CREATE FUNCTION deny_contract_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_type='contract' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$;CREATE TRIGGER deny_contract_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION deny_contract_audit();`,
      );
      await check(
        "patchContractObligation",
        101,
        { id: 101, obligationId: 101 },
        { title: "Must rollback" },
        500,
      );
      assert.equal(
        (
          await client.query(
            "SELECT title FROM contract_obligations WHERE id=101",
          )
        ).rows[0].title,
        "Changed title",
      );
      await client.query(
        "DROP TRIGGER deny_contract_audit ON audit_logs;DROP FUNCTION deny_contract_audit()",
      );
    });
    await test("new standalone contract stores actor institute and preserves create flow", async () => {
      const r = await check(
        "createContract",
        101,
        {},
        {
          title: "New standalone",
          vendor: "Supplier A",
          supplier_id: 101,
          main_technical_department_id: 101,
        },
        201,
      );
      assert.equal(
        (
          await client.query("SELECT institute_id FROM contracts WHERE id=$1", [
            r.data.id,
          ])
        ).rows[0].institute_id,
        101,
      );
    });
    await test("manager can update an owned contract", () =>
      check(
        "updateContract",
        101,
        { id: 104 },
        { title: "Updated legacy title" },
      ));
    await test("normal risk recalculation commits before response", () =>
      check("recalculateContractRisk", 101, { id: 101 }, {}));
    await test("authorized AI placeholder retains scoped evidence", () =>
      check(
        "requestContractAiExtraction",
        101,
        { id: 101 },
        { document_id: 101, document_version_id: 101 },
        501,
      ));
    await test("current version legitimate workflow", () =>
      check(
        "markContractDocumentVersionCurrent",
        101,
        { id: 101, documentId: 101, versionId: 101 },
        {},
      ));
    await test("corrupt current version fails closed", async () => {
      await client.query(
        "UPDATE contract_documents SET current_version_id=102 WHERE id=101",
      );
      await check(
        "getContractDocument",
        101,
        { id: 101, documentId: 101 },
        {},
        404,
      );
      await client.query(
        "UPDATE contract_documents SET current_version_id=101 WHERE id=101",
      );
    });
    await test("assigned active reviewer preserves legacy decision authority", async () => {
      await client.query(
        "UPDATE contracts SET status='legal_review' WHERE id=101;INSERT INTO contract_approvals(id,contract_id,approval_level,stage,reviewer_role,reviewer_id,reviewer_department_id,status,is_active) VALUES(101,101,1,'Legal','legal',105,101,'Pending',true)",
      );
      await check(
        "decideContractApproval",
        105,
        { id: 101, approvalId: 101 },
        { decision: "Approved" },
      );
    });
    await test("foreign PO reference is rejected through the canonical financial graph", async () => {
      await client.query(`INSERT INTO requests(id,request_type,requester_id,department_id,institute_id,status) VALUES(101,'Non-Stock',101,101,101,'Approved'),(102,'Non-Stock',102,102,102,'Approved');
      UPDATE contracts SET source_request_id=id WHERE id IN (101,102);
      INSERT INTO purchase_orders(id,request_id,supplier_id,po_number) VALUES(101,101,101,'C-PO-A'),(102,102,102,'C-PO-B');`);
      await check(
        "createContractConsumptionEntry",
        101,
        { id: 101 },
        {
          source_type: "purchase_order",
          source_id: 102,
          amount: 1,
          consumption_date: "2026-11-01",
        },
        404,
      );
    });
    await test("valid same-request PO consumption keeps existing settlement behavior", () =>
      check(
        "createContractConsumptionEntry",
        101,
        { id: 101 },
        {
          source_type: "purchase_order",
          source_id: 101,
          amount: 1,
          consumption_date: "2026-11-01",
        },
        201,
      ));
    await test("payment cannot reference another contract invoice", () =>
      check(
        "createContractPayment",
        101,
        { id: 101 },
        { invoice_id: 102, amount: 1 },
        404,
      ));
    await test("legitimate invoice creation keeps legacy matching behavior", () =>
      check(
        "createContractInvoice",
        101,
        { id: 101 },
        { invoice_number: "IA-NEW", invoice_date: "2026-11-01", amount: 2 },
        201,
      ));
    await test("contract viewer is not an automatic approver", () =>
      check(
        "decideContractApproval",
        103,
        { id: 101, approvalId: 101 },
        { decision: "Approved" },
        403,
      ));
    await test("explicit cross grant needs a bounded target and excludes financial access", async () => {
      await client.query(
        "INSERT INTO user_permissions(user_id,permission_id) SELECT 101,id FROM permissions WHERE code='requests.cross-institute'",
      );
      await check("getContractById", 101, { id: 102 }, {}, 404);
      await client.query(
        "INSERT INTO data_scopes(code,name) VALUES('institute_ids','Institutes') ON CONFLICT(code) DO NOTHING;INSERT INTO user_data_scopes(user_id,data_scope_id,scope_value) SELECT 101,id,'102' FROM data_scopes WHERE code='institute_ids'",
      );
      await check("getContractById", 101, { id: 102 }, {});
      await check("getContractFinancialSummary", 101, { id: 102 }, {}, 404);
      const risks = await check("listHighRiskContracts", 101, {}, {});
      assert(risks.data.every((r) => Number(r.contract_id) !== 102));
    });
    await test("supplier and AI summaries cannot inherit contract access from supplier access", async () => {
      const tools = require("../modules/ai-intelligence/tools").createTools(
        pool,
      );
      await client.query(
        `INSERT INTO requested_items(id,request_id,item_name,quantity) VALUES(101,101,'A item',1);INSERT INTO procurement_cases(id,request_id,requested_item_id,institute_id,case_status) VALUES(101,101,101,101,'SOURCING');INSERT INTO procurement_case_activities(procurement_case_id,activity_type,supplier_id,activity_at,source) VALUES(101,'RFQ',101,NOW(),'SYSTEM')`,
      );
      const result = await tools.get_supplier_summary.execute(
        { supplierId: 101 },
        { userId: 104, instituteIds: [101] },
      );
      assert.deepEqual(result.data.contracts, []);
    });
    await test("conflicting historical provenance fails closed without rewriting the row", async () => {
      await client.query(
        "UPDATE contracts SET end_user_department_id=102 WHERE id=104",
      );
      await check("getContractById", 101, { id: 104 }, {}, 404);
      assert.equal(
        (
          await client.query(
            "SELECT end_user_department_id FROM contracts WHERE id=104",
          )
        ).rows[0].end_user_department_id,
        102,
      );
      await client.query(
        "UPDATE contracts SET end_user_department_id=101 WHERE id=104",
      );
    });
    await test("authorized request creators retain the scoped active-item catalog", async () => {
      await client.query(
        "INSERT INTO user_permissions(user_id,permission_id) SELECT 103,id FROM permissions WHERE code='stock-requests.create';UPDATE contracts SET status='active' WHERE id IN (104,102);INSERT INTO contract_items(id,contract_id,item_name,is_active) VALUES(104,104,'Catalog A',true),(102,102,'Catalog B',true)",
      );
      const r = await check("listActiveContractItems", 103, {}, {});
      assert(r.data.some((row) => Number(row.contract_id) === 104));
      assert(r.data.every((row) => Number(row.contract_id) !== 102));
    });
    await test("contract management alone cannot authorize payment writes", async () => {
      await client.query(
        "DELETE FROM user_permissions WHERE user_id=101 AND permission_id=(SELECT id FROM permissions WHERE code='finance.payment.manage')",
      );
      await check(
        "createContractPayment",
        101,
        { id: 101 },
        { invoice_id: 101, amount: 1 },
        403,
      );
    });
    await test("header balance edits cannot bypass payment authorization", () =>
      check("updateContract", 101, { id: 101 }, { amount_paid: 123 }, 403));
    await test("empty draft deletion preserves legacy log evidence in canonical audit", async () => {
      const draft = (
        await client.query(
          "SELECT id FROM contracts WHERE title='New standalone'",
        )
      ).rows[0];
      await check("deleteContract", 101, { id: draft.id }, {});
      const record = (
        await client.query(
          "SELECT details FROM audit_logs WHERE target_type='contract' AND target_id=$1 AND action='CONTRACT_deleteContract'",
          [String(draft.id)],
        )
      ).rows[0];
      const details =
        typeof record.details === "string"
          ? JSON.parse(record.details)
          : record.details;
      assert(
        details.beforeData.contract_logs.some(
          (row) => row.action === "contract_created",
        ),
      );
      assert.equal(details.afterData.contract, null);
    });
    await test("an obligation delegation permits only its own row, not the whole contract", async () => {
      await client.query(
        "INSERT INTO users(id,name,email,password,role,institute_id,department_id,is_active) VALUES(106,'Obligation owner','co@example.invalid','test','custom owner',101,101,true);INSERT INTO contract_obligations(id,contract_id,title,owner_user_id,due_date) VALUES(106,101,'Delegated task',106,CURRENT_DATE)",
      );
      await check("getContractById", 106, { id: 101 }, {}, 404);
      await check(
        "getContractObligation",
        106,
        { id: 101, obligationId: 106 },
        {},
      );
      await check(
        "getContractObligation",
        106,
        { id: 101, obligationId: 101 },
        {},
        404,
      );
      const rows = await check("listContractObligations", 106, { id: 101 }, {});
      assert(rows.data.every((r) => Number(r.owner_user_id) === 106));
      const due = await check("listDueSoonContractObligations", 106, {}, {});
      assert(due.data.every((r) => Number(r.owner_user_id) === 106));
      await check(
        "completeContractObligation",
        106,
        { id: 101, obligationId: 106 },
        {},
      );
    });
    await test("an evaluator delegation permits its own evaluation, not unrelated contract content", async () => {
      await client.query(
        "INSERT INTO users(id,name,email,password,role,institute_id,department_id,is_active) VALUES(107,'Evaluator','ce@example.invalid','test','custom evaluator',101,101,true);INSERT INTO contract_evaluations(id,contract_id,evaluator_id) VALUES(107,101,107)",
      );
      await check("getContractById", 107, { id: 101 }, {}, 404);
      await check("getContractEvaluationById", 107, { id: 107 }, {});
      const r = await call(
        "getContractEvaluations",
        107,
        {},
        {},
        { contract_id: 101 },
      );
      assert.equal(r.status, 200, r.error?.stack);
      assert(r.data.every((row) => Number(row.evaluator_id) === 107));
    });
    await test("canonical financial consumption reads compose with the contract transaction", () =>
      check("getContractConsumption", 101, { id: 101 }, {}));
    await test("authorized department edits remain compatible inside the institute", async () => {
      await client.query(
        "INSERT INTO departments(id,name,type,institute_id) VALUES(103,'Another A department','Operational',101)",
      );
      await check(
        "updateContract",
        101,
        { id: 104 },
        { end_user_department_id: 103 },
      );
      await check(
        "updateContract",
        101,
        { id: 104 },
        { end_user_department_id: 102 },
        404,
      );
    });
    await test("legacy approval routing remains authoritative", async () => {
      assert.equal(
        require("../services/approvalPolicyEngine").LIVE_ROUTING_ENABLED,
        false,
      );
    });
    console.log(`AUD-005 PostgreSQL regression cases passed: ${passed}`);
  } finally {
    await pool.end();
  }
}
module.exports = { run };
