"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const profiles = require("../services/technicalReviewProfiles");
const {
  createTechnicalReviewService,
} = require("../services/preprocurementTechnicalReviewService");
const {
  createDeliveryInspectionService,
} = require("../services/deliveryInspectionService");
const {
  createConnectedP2PRepository,
} = require("../repositories/connectedP2PRepository");
const {
  createGoodsReceipt,
  applyTechnicalDisposition,
} = require("../services/goodsReceiptService");
module.exports = async (client) => {
  assert.equal(client.connectionParameters.host, "127.0.0.1");
  assert.equal(client.connectionParameters.user, "p2p_test");
  const patch = fs.readFileSync(
    path.join(
      __dirname,
      "../sql/manual/054_technical_review_and_delivery_workflow.sql",
    ),
    "utf8",
  );
  await client.query(patch);
  await client.query(patch);
  // Reproduce the older Item Master schema in this disposable transaction.
  await client.query("BEGIN");
  try {
    const directory = require("../services/technicalProposalDirectory");
    const count = (
      await client.query("SELECT count(*) n FROM approved_products")
    ).rows[0].n;
    const suppliersBefore = (
      await client.query("SELECT id,institute_id FROM suppliers ORDER BY id")
    ).rows;
    await client.query(
      "ALTER TABLE approved_products DROP COLUMN institute_id",
    );
    await assert.rejects(
      directory.requireSchema(client),
      (e) =>
        e.code === "TECHNICAL_PROPOSAL_SCHEMA_REQUIRED" &&
        e.message.includes("public.approved_products.institute_id"),
    );
    const compatibility = fs
      .readFileSync(
        path.join(
          __dirname,
          "../sql/manual/055_technical_proposal_scope_compatibility.sql",
        ),
        "utf8",
      )
      .replace(/^BEGIN;$/m, "")
      .replace(/^COMMIT;$/m, "");
    await client.query(compatibility);
    await client.query(compatibility);
    await directory.requireSchema(client);
    assert.equal(
      (await client.query("SELECT count(*) n FROM approved_products")).rows[0]
        .n,
      count,
    );
    assert.deepEqual(
      (await client.query("SELECT id,institute_id FROM suppliers ORDER BY id"))
        .rows,
      suppliersBefore,
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*) n FROM approved_products WHERE institute_id IS NOT NULL",
        )
      ).rows[0].n,
      "0",
    );
    console.log(
      "SQL 055: missing product scope reproduced, actionable error, populated repeat application preserves catalog rows and supplier ownership PASS",
    );
  } finally {
    await client.query("ROLLBACK");
  }
  await client.query("BEGIN");
  let serial = 0,
    failNotification = false;
  const adapter = {
    query: async (sql, args) => {
      if (sql === "BEGIN")
        return client.query("SAVEPOINT workflow_" + ++serial);
      if (sql === "COMMIT")
        return client.query("RELEASE SAVEPOINT workflow_" + serial);
      if (sql === "ROLLBACK") {
        await client.query("ROLLBACK TO SAVEPOINT workflow_" + serial);
        return client.query("RELEASE SAVEPOINT workflow_" + serial);
      }
      if (failNotification && sql.startsWith("INSERT INTO notifications")) {
        failNotification = false;
        throw new Error("Injected technical notification failure");
      }
      return client.query(sql, args);
    },
    release: () => {},
  };
  const database = { query: adapter.query, connect: async () => adapter };
  const repository = {
    withTransaction: async (fn) => {
      await adapter.query("BEGIN");
      try {
        const result = await fn(createConnectedP2PRepository(adapter));
        await adapter.query("COMMIT");
        return result;
      } catch (e) {
        await adapter.query("ROLLBACK");
        throw e;
      }
    },
  };
  const one = async (sql, args) => (await client.query(sql, args)).rows[0];
  try {
    const inst = (
      await one(
        "INSERT INTO institutes(id,name) SELECT COALESCE(max(id),0)+100,'Technical integrated fixture' FROM institutes RETURNING id",
      )
    ).id;
    const foreignInst = (
      await one(
        "INSERT INTO institutes(id,name) SELECT COALESCE(max(id),0)+100,'Foreign technical fixture' FROM institutes RETURNING id",
      )
    ).id;
    const dept = async (name) =>
      (
        await one(
          "INSERT INTO departments(id,name,type,institute_id) SELECT COALESCE(max(id),0)+100,$1,'Medical',$2 FROM departments RETURNING id",
          [name, inst],
        )
      ).id;
    const requesting = await dept("Clinical fixture"),
      specialist = await dept("Technical fixture"),
      receiving = await dept("Receiving fixture");
    const user = async (name, role, department, permissions = []) => {
      const row = await one(
        "INSERT INTO users(id,name,email,password,role,department_id,institute_id,is_active) SELECT COALESCE(max(id),0)+100,$1,$2,'fixture',$3,$4,$5,true FROM users RETURNING *",
        [
          name,
          name.replaceAll(" ", "") + "@workflow.invalid",
          role,
          department,
          inst,
        ],
      );
      return {
        ...row,
        permissions,
        hasPermission: (code) => permissions.includes(code),
      };
    };
    const scm = await user("Technical SCM", "SCM", receiving, [
      "technical-inspections.manage",
    ]);
    const hod = await user("Clinical HOD", "HOD", requesting),
      expert = await user("Technical expert", "Technician", specialist),
      receiver = await user(
        "Technical receiver",
        "WarehouseKeeper",
        receiving,
        ["procure-to-pay.receipts.manage"],
      );
    const outsider = await user("Technical outsider", "Requester", requesting);
    // Persist only the real policy owner's permission for automatic generation.
    await client.query(
      "INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE code='technical-inspections.manage' ON CONFLICT DO NOTHING",
      [scm.id],
    );
    const warehouse = (
      await one(
        "INSERT INTO warehouses(id,name,institute_id) SELECT COALESCE(max(id),0)+100,'Technical receiving warehouse',$1 FROM warehouses RETURNING id",
        [inst],
      )
    ).id;
    receiver.warehouse_id = warehouse;
    await client.query("UPDATE users SET warehouse_id=$1 WHERE id=$2", [
      warehouse,
      receiver.id,
    ]);
    const supplier = (
      await one(
        "INSERT INTO suppliers(name,status,institute_id) VALUES('Technical fixture supplier','active',$1) RETURNING id",
        [inst],
      )
    ).id;
    const supplier2 = (
      await one(
        "INSERT INTO suppliers(name,status,institute_id) VALUES('Replacement technical supplier','active',$1) RETURNING id",
        [inst],
      )
    ).id;
    const uom = await one(
      "SELECT id,uom_code FROM item_uom WHERE is_active ORDER BY id LIMIT 1",
    );
    const generic = (
      await one(
        "INSERT INTO generic_items(item_code,generic_name,canonical_description,category,item_type,base_uom,inventory_uom,base_uom_id,inventory_uom_id,structured_fingerprint,lifecycle_status,is_active,institute_id) VALUES('TECHNICAL-FIXTURE','Technical device','Technical device','Test','general_item',$1,$1,$2,$2,'technical-fixture','active',true,$3) RETURNING id",
        [uom.uom_code, uom.id, inst],
      )
    ).id;
    const stock = (
      await one(
        "INSERT INTO stock_items(id,name,unit,available_quantity,generic_item_id,inventory_uom_id,mapping_status) SELECT COALESCE(max(id),0)+100,'Technical device',$1,0,$2,$3,'mapped_generic' FROM stock_items RETURNING id",
        [uom.uom_code, generic, uom.id],
      )
    ).id;
    await client.query(
      "INSERT INTO warehouse_stock_levels(id,warehouse_id,stock_item_id,item_name,quantity,stock_status) SELECT COALESCE(max(id),0)+100,$1,$2,'Technical device',0,'AVAILABLE' FROM warehouse_stock_levels",
      [warehouse, stock],
    );
    const request = await one(
      "INSERT INTO requests(request_type,status,requester_id,department_id,institute_id) VALUES('Stock','Approved',$1,$2,$3) RETURNING *",
      [hod.id, requesting, inst],
    );
    const item = await one(
      "INSERT INTO requested_items(request_id,item_name,quantity,specs,unit_of_measure,approval_status,request_mode,catalog_status,restriction_justification,generic_item_id) VALUES($1,'Technical device',10,'Specification','Piece','Approved','approved_free_text_exception','approved_exception','Fixture authorization',$2) RETURNING *",
      [request.id, generic],
    );
    const setting = {
      pre_required: true,
      delivery_required: true,
      level: 2,
      evidence_required: false,
      delivery_checks: profiles.BASE_CHECKS,
      reviewers: [
        { department_id: requesting, reviewer_id: hod.id },
        { department_id: specialist, reviewer_id: expert.id },
      ],
    };
    await profiles.save(adapter, scm, {
      profile_key: "general_item",
      settings: setting,
      row_version: 0,
      reason: "Technical workflow fixture",
    });
    await assert.rejects(
      profiles.save(adapter, scm, {
        profile_key: "general_item",
        settings: setting,
        row_version: 0,
        reason: "Stale fixture",
      }),
      { statusCode: 409 },
    );
    await assert.rejects(profiles.directory(adapter, outsider), {
      statusCode: 403,
    });
    const reviewService = createTechnicalReviewService(database);
    let review =
      await require("../services/technicalReviewAutomation").ensureRequiredReview(
        adapter,
        request.id,
      );
    assert(review.item_packets.every((p) => p.awaiting_proposal));
    assert.equal(
      await require("../services/technicalReviewAutomation").ensureRequiredReview(
        adapter,
        request.id,
      ),
      null,
    );
    const report = (decision = "APPROVED") => [
      {
        item_id: String(item.id),
        assessment_version: 2,
        decision,
        assessment: {
          specifications: "compliant",
          compatibility: "compatible",
          suitability: "suitable",
        },
        findings: decision === "APPROVED" ? "" : "Clarify accessories",
      },
    ];
    await assert.rejects(
      reviewService.opinion(hod, review.id, {
        row_version: review.row_version,
        reports: report(),
      }),
      { statusCode: 409 },
    );
    const revision = (supplier_id) => [
      {
        item_id: item.id,
        evidence: {
          ...review.item_packets[0].evidence,
          no_sample_reason:
            "Supplier provided written technical details; no physical sample is available",
          supplier_id,
          model_number: "Fixture model",
        },
      },
    ];
    review = await reviewService.revise(scm, review.id, {
      row_version: review.row_version,
      notes: "Supplier proposal is ready",
      items: revision(supplier),
    });
    review = await reviewService.start(hod, review.id, {
      row_version: review.row_version,
    });
    review = await reviewService.opinion(hod, review.id, {
      row_version: review.row_version,
      reports: report("CONDITIONAL"),
    });
    assert.equal(
      review.assignments.find((a) => a.reviewer_id === hod.id).status,
      "CONDITIONAL",
    );
    await assert.rejects(
      reviewService.sign(scm, review.id, {
        row_version: review.row_version,
        decision: "APPROVED",
        notes: "Cannot bypass conditions",
      }),
      { statusCode: 409 },
    );
    assert.equal(
      (
        await require("../services/technicalWorklistService").createTechnicalWorklistService(
          database,
        )(hod, { status: "ON_HOLD" })
      ).total,
      1,
    );
    review = await reviewService.revise(scm, review.id, {
      row_version: review.row_version,
      notes: "Accessories confirmed",
    });
    assert(
      review.history.some(
        (h) => h.payload.assignment?.reports?.[0].decision === "CONDITIONAL",
      ),
    );
    review = await reviewService.opinion(hod, review.id, {
      row_version: review.row_version,
      reports: report("CLARIFICATION"),
    });
    review = await reviewService.revise(scm, review.id, {
      row_version: review.row_version,
      notes: "Clarification supplied",
    });
    review = await reviewService.opinion(hod, review.id, {
      row_version: review.row_version,
      reports: report(),
    });
    review = await reviewService.opinion(expert, review.id, {
      row_version: review.row_version,
      reports: report(),
    });
    review = await reviewService.sign(scm, review.id, {
      row_version: review.row_version,
      decision: "APPROVED",
      notes: "Technical clearance only",
    });
    const gate =
      require("../services/preprocurementTechnicalReviewGate").assertTechnicalClearance;
    await gate(adapter, item, scm, "register_procurement", {
      supplier_id: supplier,
    });
    await assert.rejects(
      gate(adapter, item, scm, "register_procurement", {
        supplier_id: supplier2,
      }),
      { code: "TECHNICAL_PROPOSAL_CHANGED" },
    );
    const po = await one(
      "INSERT INTO purchase_orders(request_id,po_number,supplier_id,currency,status,created_by) VALUES($1,'TECHNICAL-PO',$2,'IQD','PO_ISSUED',$3) RETURNING *",
      [request.id, supplier, scm.id],
    );
    const poLine = await one(
      "INSERT INTO purchase_order_items(purchase_order_id,requested_item_id,request_item_id,request_id,item_name,quantity,unit_price,line_type,source_uom,base_uom,source_uom_id,base_uom_id,conversion_factor,generic_item_id) VALUES($1,$2,$2,$3,'Technical device',10,10,'INVENTORY',$4,$4,$5,$5,1,$6) RETURNING *",
      [po.id, item.id, request.id, uom.uom_code, uom.id, generic],
    );
    const receive = (key, quantity) =>
      createGoodsReceipt({
        repository,
        purchaseOrderId: po.id,
        idempotencyKey: key,
        lines: [
          {
            purchase_order_item_id: poLine.id,
            received_quantity: quantity,
            warehouse_id: warehouse,
          },
        ],
        actor: receiver,
      });
    failNotification = true;
    await assert.rejects(
      receive("technical-rollback", 10),
      /Injected technical notification failure/,
    );
    assert.equal(
      Number(
        (
          await one(
            "SELECT count(*) n FROM goods_receipts WHERE purchase_order_id=$1",
            [po.id],
          )
        ).n,
      ),
      0,
    );
    const original = await receive("technical-first", 10);
    assert(original.receipt.items[0].technical_inspection_required);
    const balance = async () =>
      Number(
        (
          await one(
            "SELECT COALESCE(sum(quantity),0) quantity FROM warehouse_stock_levels WHERE warehouse_id=$1 AND stock_item_id=$2 AND stock_status='AVAILABLE'",
            [warehouse, stock],
          )
        ).quantity,
      );
    assert.equal(await balance(), 0);
    assert.equal(
      Number(
        (
          await one(
            "SELECT received_quantity FROM purchase_order_items WHERE id=$1",
            [poLine.id],
          )
        ).received_quantity,
      ),
      0,
    );
    await assert.rejects(receive("technical-duplicate", 1), {
      code: "OVER_RECEIPT",
    });
    assert.equal((await receive("technical-first", 10)).idempotent, true);
    const assetService =
      new (require("../services/fixedAssetService").FixedAssetService)({
        transaction: async (work) =>
          work({ query: adapter.query, db: adapter }),
      });
    await assert.rejects(
      assetService.create(
        {
          description: "Unaccepted device",
          assetClass: "CONTROLLED",
          acquisitionMethod: "PURCHASE",
          ownershipType: "INSTITUTE_OWNED",
          condition: "NEW",
          operationalStatus: "IN_STORAGE",
          reconciliationStatus: "UNVERIFIED",
          creationSource: "PROCUREMENT",
          goodsReceiptItemId: original.receipt.items[0].id,
        },
        { instituteId: inst, userId: receiver.id },
      ),
      { code: "ASSET_TECHNICAL_ACCEPTANCE_REQUIRED" },
    );
    const pendingCompletion =
      await require("../utils/technicalInspectionStatus").getInspectionSummaryForRequest(
        adapter,
        request.id,
      );
    assert.equal(pendingCompletion.pendingCount, 1);
    const taskRow = await one(
      "SELECT id FROM delivery_inspection_tasks WHERE receipt_item_id=$1",
      [original.receipt.items[0].id],
    );
    const deliveries = createDeliveryInspectionService(database);
    let task = await deliveries.get(hod, taskRow.id);
    await assert.rejects(
      deliveries.get({ ...scm, institute_id: foreignInst }, task.id),
      { statusCode: 404 },
    );
    await assert.rejects(deliveries.get(outsider, task.id), {
      statusCode: 404,
    });
    const opinion = (a, r, decision = "PARTIAL") => ({
      decision,
      accepted_quantity: String(a),
      rejected_quantity: String(r),
      notes: "Accept the conforming units; reject/hold the balance",
      assessment: {
        specifications: "yes",
        physical_condition: "yes",
        documents: "yes",
        functional_test: "pass",
      },
      attachment_ids: [],
    });
    task = await deliveries.opinion(hod, task.id, {
      row_version: task.row_version,
      ...opinion(8, 1),
    });
    const stale = task.row_version;
    task = await deliveries.opinion(expert, task.id, {
      row_version: task.row_version,
      ...opinion(8, 1),
    });
    await assert.rejects(
      deliveries.decide(scm, task.id, { row_version: stale, notes: "Stale" }),
      { statusCode: 409 },
    );
    task = await deliveries.decide(scm, task.id, {
      row_version: task.row_version,
      notes: "Authorize eight, reject one, hold one",
    });
    await assert.rejects(
      applyTechnicalDisposition({
        repository,
        taskId: task.id,
        input: {
          row_version: task.row_version,
          disposition_id: task.pending_disposition.history_id,
        },
        actor: hod,
      }),
      { statusCode: 403 },
    );
    const applyInput = {
      row_version: task.row_version,
      disposition_id: task.pending_disposition.history_id,
    };
    await assert.rejects(
      applyTechnicalDisposition({
        repository,
        taskId: task.id,
        input: applyInput,
        actor: { ...receiver, warehouse_id: null },
      }),
      { code: "WAREHOUSE_SCOPE_DENIED" },
    );
    assert.equal((await deliveries.get(hod, task.id)).status, "DECIDED");
    assert.equal(await balance(), 0);
    task = (
      await applyTechnicalDisposition({
        repository,
        taskId: task.id,
        input: applyInput,
        actor: receiver,
      })
    ).task;
    assert.equal(task.status, "ON_HOLD");
    assert.equal(task.remaining_quantity, "1");
    assert.equal(await balance(), 8);
    assert.equal(
      (
        await applyTechnicalDisposition({
          repository,
          taskId: task.id,
          input: applyInput,
          actor: receiver,
        })
      ).idempotent,
      true,
    );
    assert.equal(await balance(), 8);
    const totals = await createConnectedP2PRepository(
      adapter,
    ).loadAcceptedReceiptQuantitiesByPoLine(po.id);
    assert.equal(Number(totals[0].accepted_quantity), 8);
    const invoice = await one(
      "INSERT INTO supplier_invoices(request_id,supplier_id,purchase_order_id,supplier,invoice_number,normalized_invoice_number,invoice_date,subtotal_amount,total_amount,currency,status) VALUES($1,$2,$3,'Technical fixture supplier','TECHNICAL-INVOICE','technical-invoice',CURRENT_DATE,90,90,'IQD','AP_INVOICE_SUBMITTED') RETURNING id",
      [request.id, supplier, po.id],
    );
    await client.query(
      "INSERT INTO invoice_items(supplier_invoice_id,purchase_order_item_id,requested_item_id,description,quantity,unit_price,line_total) VALUES($1,$2,$3,'Technical device',9,10,90)",
      [invoice.id, poLine.id, item.id],
    );
    await assert.rejects(
      require("../services/technicalFinancialGate").assertInvoice(
        adapter,
        invoice.id,
      ),
      { code: "TECHNICAL_RECEIPT_NOT_ACCEPTED" },
    );
    const invoiceService = require("../services/supplierInvoiceService");
    const match = await invoiceService.runInvoiceMatch({
      repository,
      invoiceId: invoice.id,
      actor: scm,
    });
    assert.equal(match.status, "MATCH_EXCEPTION");
    await assert.rejects(
      invoiceService.decideMatchOverride({
        repository,
        requestId: request.id,
        matchResultId: match.match_result.id,
        decision: "APPROVED",
        reason: "Cannot override technical holds",
        actor: scm,
      }),
      { code: "TECHNICAL_RECEIPT_NOT_ACCEPTED" },
    );
    await client.query(
      "UPDATE invoice_items SET quantity=8,line_total=80 WHERE supplier_invoice_id=$1",
      [invoice.id],
    );
    await require("../services/technicalFinancialGate").assertInvoice(
      adapter,
      invoice.id,
    );
    const verified = await invoiceService.runInvoiceMatch({
      repository,
      invoiceId: invoice.id,
      actor: scm,
    });
    assert.equal(verified.status, "MATCH_VERIFIED");
    const secondInvoice = await one(
      "INSERT INTO supplier_invoices(request_id,supplier_id,purchase_order_id,supplier,invoice_number,normalized_invoice_number,invoice_date,subtotal_amount,total_amount,currency,status) VALUES($1,$2,$3,'Technical fixture supplier','TECHNICAL-SECOND','technical-second',CURRENT_DATE,10,10,'IQD','AP_INVOICE_SUBMITTED') RETURNING id",
      [request.id, supplier, po.id],
    );
    await client.query(
      "INSERT INTO invoice_items(supplier_invoice_id,purchase_order_item_id,requested_item_id,description,quantity,unit_price,line_total) VALUES($1,$2,$3,'Technical device',1,10,10)",
      [secondInvoice.id, poLine.id, item.id],
    );
    await assert.rejects(
      require("../services/technicalFinancialGate").assertInvoice(
        adapter,
        secondInvoice.id,
      ),
      { code: "TECHNICAL_RECEIPT_NOT_ACCEPTED" },
    );
    await client.query(
      "UPDATE supplier_invoices SET status='VOIDED' WHERE id=$1",
      [secondInvoice.id],
    );

    task = await deliveries.reopen(scm, task.id, {
      row_version: task.row_version,
      notes: "Test the held unit after corrective action",
    });
    task = await deliveries.opinion(hod, task.id, {
      row_version: task.row_version,
      ...opinion(1, 0, "ACCEPTED"),
    });
    task = await deliveries.opinion(expert, task.id, {
      row_version: task.row_version,
      ...opinion(1, 0, "ACCEPTED"),
    });
    task = await deliveries.decide(scm, task.id, {
      row_version: task.row_version,
      notes: "Held unit now meets requirements",
    });
    task = (
      await applyTechnicalDisposition({
        repository,
        taskId: task.id,
        input: {
          row_version: task.row_version,
          disposition_id: task.pending_disposition.history_id,
        },
        actor: receiver,
      })
    ).task;
    assert.equal(task.status, "CLOSED");
    assert.equal(await balance(), 9);
    const currentProfile = await one(
      "SELECT * FROM technical_review_profiles WHERE institute_id=$1 AND profile_key='general_item'",
      [inst],
    );
    await profiles.save(adapter, scm, {
      profile_key: "general_item",
      row_version: currentProfile.row_version,
      reason: "Formal acceptance for new tasks",
      settings: {
        ...setting,
        level: 3,
        pre_checks: ["calibration"],
        delivery_checks: [...profiles.BASE_CHECKS, "calibration"],
      },
    });
    const replacement = await receive("technical-replacement", 1);
    assert(replacement.receipt.items[0].technical_inspection_required);
    assert.equal(await balance(), 9);
    assert.equal(task.profile_snapshot.level, 2); // Existing snapshots are preserved.
    const replacementId = (
      await one(
        "SELECT id FROM delivery_inspection_tasks WHERE receipt_item_id=$1",
        [replacement.receipt.items[0].id],
      )
    ).id;
    let formal = await deliveries.get(hod, replacementId);
    assert(formal.profile_snapshot.evidence_required);
    await assert.rejects(
      deliveries.opinion(hod, formal.id, {
        row_version: formal.row_version,
        ...opinion(1, 0, "ACCEPTED"),
        assessment: { ...opinion(1, 0).assessment, calibration: "pass" },
      }),
      { statusCode: 400 },
    );
    const evidence = await one(
      "INSERT INTO attachments(request_id,file_name,file_path,uploaded_by) VALUES($1,'Calibration acceptance.pdf','fixture-only.pdf',$2) RETURNING id",
      [request.id, expert.id],
    );
    const evidenceOpinion = (a, r, d = "ACCEPTED") => ({
      ...opinion(a, r, d),
      attachment_ids: [evidence.id],
      assessment: { ...opinion(a, r, d).assessment, calibration: "pass" },
    });
    await assert.rejects(
      deliveries.opinion(hod, formal.id, {
        row_version: formal.row_version,
        ...evidenceOpinion(1, 0),
        assessment: {
          ...evidenceOpinion(1, 0).assessment,
          calibration: "fail",
        },
      }),
      { statusCode: 400 },
    );
    formal = await deliveries.opinion(hod, formal.id, {
      row_version: formal.row_version,
      ...evidenceOpinion(1, 0),
    });
    formal = await deliveries.opinion(expert, formal.id, {
      row_version: formal.row_version,
      ...evidenceOpinion(0, 0, "HOLD"),
    });
    await assert.rejects(
      deliveries.decide(scm, formal.id, {
        row_version: formal.row_version,
        notes: "Disagreement cannot release",
      }),
      { statusCode: 409 },
    );
    formal = await deliveries.reopen(scm, formal.id, {
      row_version: formal.row_version,
      notes: "Resolve differing inspector findings",
    });
    formal = await deliveries.opinion(hod, formal.id, {
      row_version: formal.row_version,
      ...evidenceOpinion(1, 0),
    });
    formal = await deliveries.opinion(expert, formal.id, {
      row_version: formal.row_version,
      ...evidenceOpinion(1, 0),
    });
    formal = await deliveries.decide(scm, formal.id, {
      row_version: formal.row_version,
      notes: "Formal testing complete",
    });
    formal = (
      await applyTechnicalDisposition({
        repository,
        taskId: formal.id,
        input: {
          row_version: formal.row_version,
          disposition_id: formal.pending_disposition.history_id,
        },
        actor: receiver,
      })
    ).task;
    await client.query("SAVEPOINT retained_technical_file");
    await assert.rejects(
      client.query("DELETE FROM attachments WHERE id=$1", [evidence.id]),
      (e) => e.code === "23503",
    );
    await client.query("ROLLBACK TO SAVEPOINT retained_technical_file");
    assert.equal(formal.status, "CLOSED");
    assert.equal(await balance(), 10);
    assert.equal(
      (await one("SELECT status FROM purchase_orders WHERE id=$1", [po.id]))
        .status,
      "PO_DELIVERED",
    );
    const completion =
      await require("../utils/technicalInspectionStatus").getInspectionSummaryForRequest(
        adapter,
        request.id,
      );
    assert.equal(completion.pendingCount, 0);
    const structural = await user(
      "Structural technical head",
      "Requester",
      receiving,
    );
    const org = await one(
      "INSERT INTO organization_units(institute_id,name,unit_type,department_id) VALUES($1,'Technical structural head','DEPARTMENT',$2) RETURNING id",
      [inst, requesting],
    );
    await client.query(
      "INSERT INTO organization_positions(organization_unit_id,position_type,position_name,user_id) VALUES($1,'DEPARTMENT_HEAD','Clinical responsibility',$2)",
      [org.id, structural.id],
    );
    const latestProfile = await one(
      "SELECT * FROM technical_review_profiles WHERE institute_id=$1 AND profile_key='general_item'",
      [inst],
    );
    await profiles.save(adapter, scm, {
      profile_key: "general_item",
      row_version: latestProfile.row_version,
      reason: "Use the current organizational head",
      settings: {
        ...latestProfile.settings,
        reviewers: [
          { department_id: "REQUESTING", reviewer_id: null },
          { department_id: specialist, reviewer_id: expert.id },
        ],
      },
    });
    const newRequest = await one(
      "INSERT INTO requests(request_type,status,requester_id,department_id,institute_id) VALUES('Stock','Approved',$1,$2,$3) RETURNING id",
      [structural.id, requesting, inst],
    );
    await client.query(
      "INSERT INTO requested_items(request_id,item_name,quantity,specs,unit_of_measure,approval_status,generic_item_id) VALUES($1,'New technical device',1,'Specification','Piece','Approved',$2)",
      [newRequest.id, generic],
    );
    const structuralReview =
      await require("../services/technicalReviewAutomation").ensureRequiredReview(
        adapter,
        newRequest.id,
      );
    assert(
      structuralReview.assignments.some(
        (a) =>
          a.reviewer_id === structural.id && a.department_id === requesting,
      ),
    );
    assert.equal(
      (await reviewService.get(structural, structuralReview.id)).id,
      structuralReview.id,
    );
    await assert.rejects(reviewService.get(hod, structuralReview.id), {
      statusCode: 404,
    });
    const snapshot = await one(
      "SELECT to_jsonb(t) data FROM delivery_inspection_tasks t WHERE id=$1",
      [task.id],
    );
    const historyCount = Number(
      (await one("SELECT count(*) n FROM technical_workflow_history")).n,
    );
    await client.query(
      patch.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""),
    );
    assert.deepEqual(
      (
        await one(
          "SELECT to_jsonb(t) data FROM delivery_inspection_tasks t WHERE id=$1",
          [task.id],
        )
      ).data,
      snapshot.data,
    );
    assert.equal(
      Number(
        (await one("SELECT count(*) n FROM technical_workflow_history")).n,
      ),
      historyCount,
    );
    await client.query("SAVEPOINT immutable_technical");
    await assert.rejects(
      client.query(
        "DELETE FROM technical_workflow_history WHERE delivery_task_id=$1",
        [task.id],
      ),
      /immutable/,
    );
    await client.query("ROLLBACK TO SAVEPOINT immutable_technical");
    assert(
      (await deliveries.get(hod, task.id)).history.filter(
        (h) => h.action === "DELIVERY_OPINION_ATTESTED",
      ).length === 4,
    );
    console.log(
      "SQL 054 technical workflow: automatic task generation, conditional/clarification rounds, supplier binding, scoped GR tasks, held capacity, partial canonical inventory release, replacement receipts, matching gate, exact-once application and immutable populated history PASS",
    );
  } finally {
    await client.query("ROLLBACK");
  }
};
