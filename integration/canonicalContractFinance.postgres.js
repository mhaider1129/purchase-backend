"use strict";
const assert = require("node:assert/strict");
const { disposableDatabaseUrl } = require("./disposableDatabase");
async function run(client, url) {
  process.env.DATABASE_URL = disposableDatabaseUrl(url);
  process.env.NODE_ENV = "test";
  process.env.PGOPTIONS = "-c statement_timeout=10000 -c lock_timeout=5000";
  const pool = require("../config/db");
  const {
    createTransactionalP2PRepository,
  } = require("../repositories/connectedP2PRepository");
  const repository = createTransactionalP2PRepository(pool);
  const poService = require("../services/purchaseOrderService");
  const invoiceService = require("../services/supplierInvoiceService");
  const apService = require("../services/accountsPayableService");
  const { postApVoucher } = require("../services/apPostingService");
  const { postPayment } = require("../services/paymentService");
  const { createGoodsReceipt } = require("../services/goodsReceiptService");
  const {
    verifyInvoiceForFinance,
  } = require("../services/financeVerificationService");
  const {
    getCanonicalContractFinancialSummary,
  } = require("../controllers/contractFinancialProjectionController");
  const actor = { id: 101 },
    approver = { id: 102 },
    financeUser = { id: 104 };
  let seq = 0,
    passed = 0;
  const key = () => `contract-integration-${++seq}`;
  const one = async (sql, params = []) =>
    (await client.query(sql, params)).rows[0];
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  };
  const projection = async (c, user = 101) => {
    const result = { status: 200 };
    await getCanonicalContractFinancialSummary(
      { params: { id: c.id }, user: { id: user } },
      {
        json(data) {
          result.data = data;
        },
      },
      (e) => {
        result.status = e.statusCode;
        result.error = e;
      },
    );
    return result;
  };
  const snapshot = async () => {
    const values = {};
    for (const table of [
      "purchase_orders",
      "supplier_invoices",
      "ap_vouchers",
      "ap_payables",
      "finance_postings",
      "payment_records",
      "payment_allocations",
      "commitment_ledger",
      "audit_logs",
      "notification_outbox",
      "inventory_transactions",
      "budget_envelopes",
      "contracts",
      "contract_invoices",
      "contract_payments",
      "contract_consumption",
      "journal_entries",
      "journal_entry_lines",
      "gl_postings",
      "gl_posting_lines",
    ])
      values[table] = await one(
        `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) digest FROM ${table} t`,
      );
    return values;
  };
  const denied = async (work, code) => {
    const before = await snapshot();
    await assert.rejects(work, code ? { code } : undefined);
    assert.deepEqual(await snapshot(), before);
  };
  const createPo = async (c, quantity = "5", options = {}) =>
    poService.createPurchaseOrderFromAwards({
      repository,
      requestId: c.request.id,
      awardIds: [c.award.id],
      quantities: { [c.award.id]: quantity },
      actor,
      input: { contract_id: c.contract.id, ...options },
    });
  const approve = async (po) => {
    await poService.submitPurchaseOrder({
      repository,
      purchaseOrderId: po.id,
      actor,
    });
    await poService.approvePurchaseOrder({
      repository,
      purchaseOrderId: po.id,
      actor: approver,
    });
  };
  const issue = async (po) => {
    await approve(po);
    return poService.releasePurchaseOrder({
      repository,
      purchaseOrderId: po.id,
      actor,
    });
  };
  const receive = async (c, po, q = "5") =>
    createGoodsReceipt({
      repository,
      requestId: c.request.id,
      purchaseOrderId: po.id,
      actor,
      idempotencyKey: key(),
      lines: [
        {
          purchase_order_item_id: po.lines[0].id,
          received_quantity: q,
          damaged_quantity: "0",
          short_quantity: "0",
          unit_of_measure: "Piece",
        },
      ],
    });
  const submit = async (c, po, q = "5", options = {}) =>
    invoiceService.submitSupplierInvoice({
      repository,
      requestId: c.request.id,
      purchaseOrderId: po.id,
      supplierId: c.supplier.id,
      invoiceNumber: key(),
      invoiceDate: new Date().toISOString().slice(0, 10),
      currency: "USD",
      actor,
      idempotencyKey: key(),
      lines: [
        {
          purchase_order_item_id: po.lines[0].id,
          quantity: q,
          unit_price: "10",
        },
      ],
      ...options,
    });
  const payable = async (inv) => {
    assert.equal(
      (
        await invoiceService.runInvoiceMatch({
          repository,
          invoiceId: inv.id,
          actor,
        })
      ).matched,
      true,
    );
    await verifyInvoiceForFinance({ repository, invoiceId: inv.id, actor });
    const r = await apService.createPayableFromVerifiedInvoice({
      repository,
      invoiceId: inv.id,
      actor,
      idempotencyKey: key(),
      accountingLines: [
        { account_code: "CF-EXPENSE", debit_amount: inv.total_amount },
        { account_code: "CF-AP", credit_amount: inv.total_amount },
      ],
    });
    await apService.verifyApVoucher({
      repository,
      voucherId: r.voucher.id,
      actor,
    });
    return (
      await postApVoucher({
        repository,
        voucherId: r.voucher.id,
        actor,
        idempotencyKey: key(),
      })
    ).payable;
  };
  const pay = (ap, amount, options = {}) =>
    postPayment({
      repository,
      payableId: ap.id,
      amount,
      currency: "USD",
      actor: financeUser,
      idempotencyKey: key(),
      ...options,
    });
  const fixture = async (overrides = {}) => {
    const supplier = await one(
      "INSERT INTO suppliers(name,status,institute_id) VALUES($1,'active',101) RETURNING *",
      [key()],
    );
    const request = await one(
      "INSERT INTO requests(request_type,requester_id,department_id,institute_id,status) VALUES('Non-Stock',101,101,101,'Approved') RETURNING *",
    );
    const item = await one(
      "INSERT INTO requested_items(request_id,item_name,quantity,unit_of_measure,approval_status,request_mode,catalog_status,restriction_justification) VALUES($1,'Contract supply',10,'Piece','Approved','approved_free_text_exception','approved_exception','Approved fixture exception') RETURNING *",
      [request.id],
    );
    const contract = await one(
      "INSERT INTO contracts(title,vendor,supplier_id,source_request_id,institute_id,end_user_department_id,created_by,contract_type,status,start_date,end_date,contract_value,currency) VALUES($1,$1,$2,$3,101,101,101,'purchasing','active','2000-01-01','2100-01-01',$4,'USD') RETURNING *",
      [key(), supplier.id, request.id, overrides.ceiling || "100"],
    );
    const event = await one(
      "INSERT INTO rfx_events(request_id,title,rfx_type,status,created_by) VALUES($1,'Contract RFQ','RFQ','open',101) RETURNING *",
      [request.id],
    );
    const response = await one(
      "INSERT INTO rfx_responses(rfx_id,request_id,supplier_id,status) VALUES($1,$2,$3,'submitted') RETURNING *",
      [event.id, request.id, supplier.id],
    );
    const quote = await one(
      "INSERT INTO rfx_response_items(rfx_response_id,requested_item_id,quoted_quantity,unit_price,currency) VALUES($1,$2,10,10,'USD') RETURNING *",
      [response.id, item.id],
    );
    const award = overrides.skipAward
      ? null
      : await require("../services/procurementAwardService").createAward({
          repository,
          requestItem: item,
          supplier,
          actor,
          input: {
            awarded_quantity: "10",
            unit_price: "10",
            currency: "USD",
            source_type: "QUOTATION",
            source_id: String(quote.id),
            selection_reason: "Contract sourcing fixture",
            idempotency_key: key(),
          },
        });
    return { supplier, request, item, contract, award, event, response };
  };
  const legacyBefore = {};
  for (const table of [
    "contract_invoices",
    "contract_payments",
    "contract_consumption",
  ])
    legacyBefore[table] = (await snapshot())[table];
  try {
    await client.query(`INSERT INTO institutes(id,name) VALUES(101,'Contract finance'),(102,'Foreign');
   INSERT INTO departments(id,name,type,institute_id) VALUES(101,'Purchasing','Operational',101),(102,'Other','Operational',102);
   INSERT INTO users(id,name,email,password,role,department_id,institute_id,is_active) VALUES
    (101,'Procurement finance','cf101@test.invalid','test','custom',101,101,true),(102,'Independent approver','cf102@test.invalid','test','custom',101,101,true),
    (103,'Contract manager','cf103@test.invalid','test','custom',101,101,true),(104,'Payment finance','cf104@test.invalid','test','custom',101,101,true),(105,'Foreign finance','cf105@test.invalid','test','custom',102,102,true);
   INSERT INTO user_permissions(user_id,permission_id) SELECT u,p.id FROM unnest(ARRAY[101,102,105]) u CROSS JOIN permissions p WHERE p.code IN ('contracts.manage','rfx.manage','procure-to-pay.lifecycle.view','procure-to-pay.purchase-orders.manage','procure-to-pay.receipts.manage','procure-to-pay.invoices.manage','procure-to-pay.match.manage','finance.verify','finance.voucher.create','finance.voucher.verify','finance.post-ledger','finance.payment.manage','requests.manage');
   INSERT INTO user_permissions(user_id,permission_id) SELECT 103,id FROM permissions WHERE code='contracts.manage';
   INSERT INTO user_permissions(user_id,permission_id) SELECT 104,id FROM permissions WHERE code IN ('finance.payment.manage','procure-to-pay.lifecycle.view');
   INSERT INTO budget_envelopes(department_id,fiscal_year,allocated_amount,currency) VALUES(101,EXTRACT(YEAR FROM CURRENT_DATE),1000000,'USD');`);
    const c = await fixture();
    let po, po2, inv, inv2, inv3, ap, ap2, ap3;
    await test("contract PO is bound at creation and has canonical award provenance", async () => {
      po = await createPo(c);
      assert.equal(po.contract_id, c.contract.id);
      assert.equal(String(po.lines[0].award_id), String(c.award.id));
      await issue(po);
    });
    await test("contract invoice inherits its immutable PO source", async () => {
      await receive(c, po);
      inv = (await submit(c, po, "2")).invoice;
      assert.equal(inv.contract_id, c.contract.id);
    });
    await test("multiple invoices share one PO without multiplying its commitment", async () => {
      inv2 = (await submit(c, po, "3")).invoice;
      ap = await payable(inv);
      ap2 = await payable(inv2);
    });
    await test("multiple POs share one contract and reserve capacity once per issued PO", async () => {
      po2 = await createPo(c);
      await issue(po2);
      await receive(c, po2);
      inv3 = (await submit(c, po2)).invoice;
      ap3 = await payable(inv3);
    });
    await test("authorized finance user without contract management records a partial payment", async () => {
      const r = await pay(ap, "5");
      assert.equal(r.open_balance, "15.00");
    });
    await test("multiple allocations settle the same invoice without a duplicate-bill key", async () => {
      await pay(ap, "15");
      assert.equal(
        (
          await one(
            "SELECT COUNT(*)::int n FROM payment_allocations WHERE ap_payable_id=$1",
            [ap.id],
          )
        ).n,
        2,
      );
    });
    await test("duplicate payment command returns the same payment and emits no duplicate events", async () => {
      const args = { idempotencyKey: key() };
      const first = await pay(ap2, "5", args);
      const before = await snapshot();
      const again = await pay(ap2, "5", args);
      assert.equal(first.payment.id, again.payment.id);
      assert.equal(again.idempotent, true);
      assert.deepEqual(await snapshot(), before);
    });
    await test("concurrent payments cannot overpay a contract-linked payable", async () => {
      const r = await Promise.allSettled([pay(ap2, "20"), pay(ap2, "20")]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(
        r.find((x) => x.status === "rejected").reason.code,
        "PAYMENT_AMOUNT_EXCEEDED",
      );
    });
    await test("foreign-institute contract finance is rejected", async () => {
      await denied(() => pay(ap3, "1", { actor: { id: 105 } }));
      assert.equal((await projection(c.contract, 105)).status, 404);
    });
    await test("a contract manager has no implicit payment or financial-view authority", async () => {
      await denied(() => pay(ap3, "1", { actor: { id: 103 } }));
      assert.equal((await projection(c.contract, 103)).status, 403);
    });
    await test("contract payments reject sub-cent amounts rather than rounding them", () =>
      denied(() => pay(ap3, "0.001"), "ACCOUNTING_AMOUNT_PRECISION"));
    await test("payment currency mismatch cannot change balances", () =>
      denied(
        () => pay(ap3, "1", { currency: "EUR" }),
        "PAYMENT_CURRENCY_MISMATCH",
      ));
    await test("contract financial projection preserves separate exact authoritative metrics", async () => {
      const r = await projection(c.contract);
      assert.equal(r.status, 200, r.error?.stack);
      const m = r.data.metrics;
      assert.equal(m.contract_ceiling, "100");
      for (const f of [
        "approved_po_commitments",
        "received_value",
        "invoiced_value",
        "posted_payable",
      ])
        assert.equal(Number(m[f]), 100);
      assert.equal(m.paid_amount, "45");
      assert.equal(m.outstanding_ap_balance, "55.00");
      assert.equal(m.remaining_contract_capacity, "0.00");
      assert.equal(r.data.documents.purchase_orders.length, 2);
      assert.equal(r.data.documents.invoices.length, 3);
    });
    await test("contract-linked payment audit failure rolls back allocation, balance, audit and outbox", () =>
      denied(() =>
        pay(ap3, "1", {
          auditService: {
            writeAuditEvent: async () => {
              throw new Error("Injected financial audit failure");
            },
          },
        }),
      ));
    await test("contract-linked payment outbox failure rolls back all financial effects", () =>
      denied(() =>
        pay(ap3, "1", {
          outbox: {
            enqueueNotification: async () => {
              throw new Error("Injected outbox failure");
            },
          },
        }),
      ));
    await test("invoice contract reference cannot be replaced by another contract", () =>
      denied(
        () => submit(c, po, "1", { contractId: 999999 }),
        "CONTRACT_PROVENANCE_MISMATCH",
      ));
    await test("contract supplier and currency mismatches reject PO creation", async () => {
      const d = await fixture();
      await client.query("UPDATE contracts SET currency='EUR' WHERE id=$1", [
        d.contract.id,
      ]);
      await denied(() => createPo(d), "CONTRACT_CURRENCY_MISMATCH");
      await client.query(
        "UPDATE contracts SET currency='USD',supplier_id=$2 WHERE id=$1",
        [d.contract.id, c.supplier.id],
      );
      await denied(() => createPo(d));
    });
    await test("contract ceiling prevents excessive issue before any budget or outbox changes", async () => {
      const d = await fixture({ ceiling: "40" });
      const p = await createPo(d);
      await approve(p);
      await denied(
        () =>
          poService.releasePurchaseOrder({
            repository,
            purchaseOrderId: p.id,
            actor,
          }),
        "CONTRACT_CEILING_EXCEEDED",
      );
    });
    await test("canonical contract and PO provenance cannot be rewritten after binding", async () => {
      await assert.rejects(
        client.query(
          "UPDATE purchase_orders SET contract_id=NULL WHERE id=$1",
          [po.id],
        ),
        { code: "23514" },
      );
      await assert.rejects(
        client.query("UPDATE contracts SET contract_value=99 WHERE id=$1", [
          c.contract.id,
        ]),
        { code: "23514" },
      );
    });
    await test("an existing contract invoice cannot be detached onto an unlinked historical PO", () =>
      denied(() => client.query(
        "UPDATE supplier_invoices SET contract_id=NULL,purchase_order_id=901,request_id=901,supplier_id=901 WHERE id=$1",
        [inv.id],
      ), "23514"));
    await test("unposted invoices cannot produce canonical payment allocation", async () => {
      const d = await fixture();
      const p = await createPo(d);
      await issue(p);
      const i = (await submit(d, p)).invoice;
      const v = await one(
        "INSERT INTO ap_vouchers(request_id,supplier_invoice_id,voucher_number,currency,total_amount,voucher_status) VALUES($1,$2,$3,'USD',50,'draft') RETURNING *",
        [d.request.id, i.id, key()],
      );
      const a = await one(
        "INSERT INTO ap_payables(request_id,supplier_id,supplier_invoice_id,ap_voucher_id,supplier_name,invoice_total,open_balance,currency,payable_status) VALUES($1,$2,$3,$4,'Fixture',50,50,'USD','OPEN') RETURNING *",
        [d.request.id, d.supplier.id, i.id, v.id],
      );
      await denied(() => pay(a, "1"), "PAYABLE_NOT_POSTED");
    });
    await test("missing accepted receipt blocks invoice financial verification", async () => {
      const d = await fixture();
      const p = await createPo(d);
      await issue(p);
      const i = (await submit(d, p)).invoice;
      assert.equal(
        (
          await invoiceService.runInvoiceMatch({
            repository,
            invoiceId: i.id,
            actor,
          })
        ).matched,
        false,
      );
      await denied(
        () => verifyInvoiceForFinance({ repository, invoiceId: i.id, actor }),
        "INVOICE_MATCH_NOT_APPROVED",
      );
    });
    await test("missing applied technical acceptance blocks payment on an already posted contract invoice", async () => {
      await client.query(
        "UPDATE goods_receipt_items SET technical_inspection_required=true,technical_accepted_quantity=0 WHERE purchase_order_item_id=$1",
        [po2.lines[0].id],
      );
      await denied(() => pay(ap3, "1"), "TECHNICAL_RECEIPT_NOT_ACCEPTED");
      await client.query(
        "UPDATE goods_receipt_items SET technical_inspection_required=false WHERE purchase_order_item_id=$1",
        [po2.lines[0].id],
      );
    });
    await test("RFx award-and-PO route carries an explicit contract source and retries safely", async () => {
      const d = await fixture({ skipAward: true });
      const call = async (contractId) => {
        const result = {};
        await require("../controllers/rfxPortalController").awardRfxResponse(
          {
            params: { id: d.event.id },
            body: { response_id: d.response.id, contract_id: contractId },
            user: actor,
          },
          {
            json(value) {
              result.data = value;
            },
          },
          (error) => {
            result.error = error;
          },
        );
        return result;
      };
      const first = await call(d.contract.id);
      assert.ifError(first.error);
      assert.equal(first.data.purchase_order.contract_id, d.contract.id);
      const before = await snapshot();
      const retry = await call(d.contract.id);
      assert.ifError(retry.error);
      assert.equal(retry.data.purchase_order.id, first.data.purchase_order.id);
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        (await call(c.contract.id)).error.code,
        "CONTRACT_PROVENANCE_MISMATCH",
      );
    });
    await test("partial or disabled migration controls fail closed before financial writes", async () => {
      await client.query(
        "ALTER TABLE purchase_orders DISABLE TRIGGER canonical_contract_po_source_immutable",
      );
      try {
        await denied(() => createPo(c), "CONTRACT_FINANCE_SCHEMA_REQUIRED");
        assert.equal((await projection(c.contract)).status, 503);
      } finally {
        await client.query(
          "ALTER TABLE purchase_orders ENABLE TRIGGER canonical_contract_po_source_immutable",
        );
      }
    });
    await test("known contract source cannot be omitted from PO creation", async () => {
      const d = await fixture();
      await denied(
        () => createPo(d, "5", { contract_id: null }),
        "CONTRACT_LINK_REQUIRED",
      );
    });
    await test("duplicate invoice identity through a second PO does not create another liability", () =>
      denied(
        () => submit(c, po2, "1", { invoiceNumber: inv.invoice_number }),
        "DUPLICATE_INVOICE",
      ));
    await test("concurrent issuance reserves a shared contract ceiling once", async () => {
      const d = await fixture({ ceiling: "75" });
      const p = await createPo(d),
        q = await createPo(d);
      await approve(p);
      await approve(q);
      const r = await Promise.allSettled(
        [p, q].map((po) =>
          poService.releasePurchaseOrder({
            repository,
            purchaseOrderId: po.id,
            actor,
          }),
        ),
      );
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(
        r.find((x) => x.status === "rejected").reason.code,
        "CONTRACT_CEILING_EXCEEDED",
      );
    });
    await test("inconsistent recorded AP balance hides totals instead of showing a false summary", async () => {
      await client.query("UPDATE ap_payables SET open_balance=49 WHERE id=$1", [
        ap3.id,
      ]);
      await denied(() => pay(ap3, "1"), "CONTRACT_RECONCILIATION_REQUIRED");
      const before = await snapshot();
      const r = await projection(c.contract);
      assert.equal(r.status, 409);
      assert.equal(r.error.code, "CONTRACT_RECONCILIATION_REQUIRED");
      assert.deepEqual(await snapshot(), before);
      await client.query("UPDATE ap_payables SET open_balance=50 WHERE id=$1", [
        ap3.id,
      ]);
    });
    await test("special advance and service acceptance sources stay blocked", async () => {
      const d = await fixture();
      await client.query(
        `UPDATE contracts SET clm_additional_payload='{"payment_advance_percentage":"10"}'::jsonb WHERE id=$1`,
        [d.contract.id],
      );
      await denied(() => createPo(d), "CONTRACT_SOURCE_UNSUPPORTED");
    });
    await test("service-line contracts require an acceptance source adapter", async () => {
      const d = await fixture();
      await client.query(
        "UPDATE requested_items SET request_mode='service',stocking_policy='service' WHERE id=$1",
        [d.item.id],
      );
      await denied(() => createPo(d), "CONTRACT_SOURCE_UNSUPPORTED");
    });
    await test("a foreign contract ID cannot be grafted onto a local PO", async () => {
      const d = await fixture();
      const foreign = await one(
        "INSERT INTO contracts(title,vendor,institute_id,end_user_department_id,contract_type,status,contract_value,currency) VALUES('Foreign','Foreign',102,102,'purchasing','active',100,'USD') RETURNING *",
      );
      await denied(
        () => createPo(d, "5", { contract_id: foreign.id }),
        "CONTRACT_NOT_FOUND",
      );
    });
    await test("canonical finance does not write legacy settlement or activate GL journals", async () => {
      for (const table of [
        "journal_entries",
        "journal_entry_lines",
        "gl_postings",
        "gl_posting_lines",
      ])
        assert.equal((await one(`SELECT COUNT(*)::int n FROM ${table}`)).n, 0);
      const after = await snapshot();
      for (const table of Object.keys(legacyBefore))
        assert.deepEqual(after[table], legacyBefore[table]);
    });
    await test("legacy payment evidence holds settlement rather than counting it as canonical paid value", async () => {
      await client.query(
        "INSERT INTO contract_invoices(contract_id,supplier_id,invoice_number,amount,currency) VALUES($1,$2,'LEGACY',10,'USD')",
        [c.contract.id, c.supplier.id],
      );
      await client.query(
        "INSERT INTO contract_payments(contract_id,amount,status,currency) VALUES($1,10,'paid','USD')",
        [c.contract.id],
      );
      await denied(() => pay(ap3, "1"), "CONTRACT_RECONCILIATION_REQUIRED");
      const r = await projection(c.contract);
      assert.equal(r.status, 200, r.error?.stack);
      assert.equal(r.data.reconciliation_required, true);
      assert.equal(r.data.metrics.paid_amount, "45");
    });
    await test("ambiguous invoice-less legacy payment blocks an unlinked canonical PO replay", async () => {
      const d = await fixture();
      await client.query(
        "UPDATE contracts SET source_request_id=NULL WHERE id=$1",
        [d.contract.id],
      );
      const p = await createPo(d, "5", { contract_id: null });
      await issue(p);
      await client.query(
        "UPDATE contracts SET source_request_id=$2 WHERE id=$1",
        [d.contract.id, d.request.id],
      );
      await client.query(
        "INSERT INTO contract_payments(contract_id,amount,status,currency) VALUES($1,10,'pending','USD')",
        [d.contract.id],
      );
      await denied(() => submit(d, p), "CONTRACT_RECONCILIATION_REQUIRED");
    });
    await test("leasing, expired and no-source contracts remain unsupported", async () => {
      const d = await fixture();
      await client.query(
        "UPDATE contracts SET contract_type='leasing' WHERE id=$1",
        [d.contract.id],
      );
      await denied(() => createPo(d), "CONTRACT_SOURCE_UNSUPPORTED");
      await client.query(
        "UPDATE contracts SET contract_type='purchasing',end_date='2001-01-01' WHERE id=$1",
        [d.contract.id],
      );
      await denied(() => createPo(d), "CONTRACT_NOT_VALID");
      await client.query(
        "UPDATE contracts SET end_date='2100-01-01',source_request_id=NULL WHERE id=$1",
        [d.contract.id],
      );
      await denied(() => createPo(d));
    });
    await test("legacy approval routing remains disabled for V2", async () =>
      assert.equal(
        require("../services/approvalPolicyEngine").LIVE_ROUTING_ENABLED,
        false,
      ));
    await test("manual migration repeat preserves populated historical and canonical records", async () => {
      const before = await snapshot();
      const sql = require("node:fs").readFileSync(
        require("node:path").join(
          __dirname,
          "../sql/manual/065_canonical_contract_finance.sql",
        ),
        "utf8",
      );
      await client.query(sql);
      await client.query(sql);
      assert.deepEqual(await snapshot(), before);
    });
    console.log(
      `Canonical contract finance PostgreSQL cases passed: ${passed}`,
    );
  } finally {
    await pool.end();
  }
}
async function prepareUpgrade(client) {
  await client.query(`INSERT INTO institutes(id,name) VALUES(901,'Historical contract fixture');
 INSERT INTO departments(id,name,type,institute_id) VALUES(901,'Historical','Operational',901);
 INSERT INTO users(id,name,email,password,role,institute_id,department_id,is_active) VALUES(901,'Historical','history901@test.invalid','test','custom',901,901,true);
 INSERT INTO suppliers(id,name,institute_id) VALUES(901,'Historical supplier',901);
 INSERT INTO requests(id,request_type,requester_id,department_id,institute_id,status) VALUES(901,'Non-Stock',901,901,901,'Approved');
 INSERT INTO contracts(id,title,vendor,supplier_id,source_request_id,institute_id,end_user_department_id,created_by,contract_type,status,contract_value,amount_paid,currency) VALUES(901,'Historical contract','Historical supplier',901,901,901,901,901,'purchasing','active',1000,7,'USD');
 INSERT INTO contract_invoices(id,contract_id,supplier_id,invoice_number,amount,net_payable_amount,currency) VALUES(901,901,901,'HIST-901',13,13,'USD');
 INSERT INTO contract_payments(id,contract_id,invoice_id,amount,currency,status) VALUES(901,901,901,7,'USD','paid');
 INSERT INTO purchase_orders(id,request_id,supplier_id,po_number,status,currency,total_amount) VALUES(901,901,901,'HIST-PO-901','PO_ISSUED','USD',23);
 INSERT INTO supplier_invoices(id,request_id,purchase_order_id,supplier_id,supplier,invoice_number,normalized_invoice_number,invoice_date,currency,subtotal_amount,total_amount,status,contract_id) VALUES(901,901,901,901,'Historical supplier','HIST-CANONICAL-901','hist-canonical-901',CURRENT_DATE,'USD',23,23,'AP_INVOICE_SUBMITTED',901);`);
  const result = {};
  for (const table of [
    "contracts",
    "contract_invoices",
    "contract_payments",
    "purchase_orders",
    "supplier_invoices",
  ])
    result[table] = (
      await client.query(`SELECT to_jsonb(t) row FROM ${table} t WHERE id=901`)
    ).rows[0].row;
  return result;
}
async function verifyUpgrade(client, before) {
  for (const [table, value] of Object.entries(before)) {
    const after = (
      await client.query(`SELECT to_jsonb(t) row FROM ${table} t WHERE id=901`)
    ).rows[0].row;
    if (table === "purchase_orders") {
      assert.equal(after.contract_id, null);
    }
    assert.deepEqual(after, table === "purchase_orders" ? { ...value, contract_id: null } : value);
  }
  console.log(
    "PASS first migration on populated legacy/canonical records preserves all values and does not infer a PO contract link",
  );
}
module.exports = { run, prepareUpgrade, verifyUpgrade };
