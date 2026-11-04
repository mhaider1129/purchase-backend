"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { disposableDatabaseUrl } = require("./disposableDatabase");
async function run(client, url) {
  process.env.DATABASE_URL = disposableDatabaseUrl(url);
  process.env.NODE_ENV = "test";
  const pool = require("../config/db");
  const repository =
    require("../repositories/connectedP2PRepository").createTransactionalP2PRepository(
      pool,
    );
  const receiving = require("../services/goodsReceiptService");
  const profiles = require("../services/technicalReviewProfiles");
  const inspection =
    require("../services/deliveryInspectionService").createDeliveryInspectionService(
      pool,
    );
  const completion = require("../services/procurementCompletionService");
  const status = require("../services/inventoryStatusTransferService");
  const { deliverInApp } = require("../services/notificationOutboxProcessor");
  const one = async (q, p = []) => (await client.query(q, p)).rows[0];
  let serial = 0,
    passed = 0;
  const key = () => `aud018-${++serial}`;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  };
  const project = async (c) =>
    (
      await one(
        "SELECT public.canonical_procurement_completion($1,801,NULL) c",
        [c.request.id],
      )
    ).c;
  const line = (c) => c.items[0];
  const snapshot = async () => {
    const result = {};
    for (const table of [
      "requests",
      "requested_items",
      "approvals",
      "purchase_orders",
      "purchase_order_items",
      "goods_receipts",
      "goods_receipt_items",
      "delivery_inspection_tasks",
      "delivery_inspection_assignments",
      "technical_workflow_history",
      "inventory_transactions",
      "inventory_transaction_allocations",
      "warehouse_stock_levels",
      "goods_receipt_inventory_status_links",
      "audit_logs",
      "notification_outbox",
      "notifications",
      "procurement_cases",
      "procurement_case_activities",
    ])
      result[table] = (
        await one(
          `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) h FROM ${table} t`,
        )
      ).h;
    return result;
  };
  let receiver, hod, expert, scm, outsider, foreign, stockOperator;
  const receive = (c, q, options = {}) =>
    receiving.createGoodsReceipt({
      repository,
      purchaseOrderId: options.po?.id || c.po.id,
      idempotencyKey: options.key || key(),
      actor: options.actor || receiver,
      lines: [
        {
          purchase_order_item_id: options.po?.line.id || c.po.line.id,
          received_quantity: q,
          ...(c.inventory ? { warehouse_id: options.warehouse || 811 } : {}),
          stock_status: options.quarantine ? "QUARANTINE" : "AVAILABLE",
          ...(options.batch ? { batch_number: options.batch } : {}),
        },
      ],
    });
  const receiptTask = async (receipt) =>
    inspection.get(
      receiver,
      (
        await one(
          "SELECT id FROM delivery_inspection_tasks WHERE receipt_item_id=$1",
          [receipt.receipt.items[0].id],
        )
      ).id,
    );
  const authorize = async (task, a, r) => {
    const remaining = task.remaining_quantity;
    const decision =
      String(a) === String(remaining) && String(r) === "0"
        ? "ACCEPTED"
        : String(r) === String(remaining) && String(a) === "0"
          ? "REJECTED"
          : String(a) === "0" && String(r) === "0"
            ? "HOLD"
            : "PARTIAL";
    const opinion = {
      decision,
      accepted_quantity: a,
      rejected_quantity: r,
      notes: "Independent receiving evidence reviewed",
      assessment: {
        specifications: "yes",
        physical_condition: "yes",
        documents: "yes",
        functional_test: "pass",
      },
      attachment_ids: [],
    };
    if (task.status === "ON_HOLD")
      task = await inspection.reopen(scm, task.id, {
        row_version: task.row_version,
        notes: "Review held balance",
      });
    task = await inspection.opinion(hod, task.id, {
      row_version: task.row_version,
      ...opinion,
    });
    task = await inspection.opinion(expert, task.id, {
      row_version: task.row_version,
      ...opinion,
    });
    return inspection.decide(scm, task.id, {
      row_version: task.row_version,
      notes: "Authorize the independently signed quantities",
    });
  };
  const apply = (task, options = {}) =>
    receiving.applyTechnicalDisposition({
      repository: options.repository || repository,
      taskId: task.id,
      input: {
        row_version: task.row_version,
        disposition_id: task.pending_disposition.history_id,
      },
      actor: options.actor || receiver,
    });
  const consume = async (c) => {
    const events = (
      await client.query(
        "SELECT * FROM notification_outbox WHERE event_type IN ('GOODS_RECEIPT_POSTED','GOODS_RECEIPT_ACCEPTANCE_APPLIED','GOODS_RECEIPT_STOCK_STATUS_CHANGED') AND payload->>'requestId'=$1 ORDER BY id",
        [String(c.request.id)],
      )
    ).rows;
    for (const event of events) await deliverInApp(client, event);
    return events;
  };
  const caseStatus = async (c) =>
    (
      await one("SELECT case_status FROM procurement_cases WHERE id=$1", [
        c.case.id,
      ])
    ).case_status;
  const balance = async (c, state = "AVAILABLE") =>
    String(
      (
        await one(
          "SELECT COALESCE(sum(quantity),0)::text q FROM warehouse_stock_levels WHERE stock_item_id=$1 AND warehouse_id=811 AND stock_status=$2",
          [c.stock.id, state],
        )
      ).q,
    );
  const issue = async (c, q) => {
    const wr = await one(
      "INSERT INTO requests(request_type,requester_id,department_id,institute_id,status,supply_warehouse_id) VALUES('Warehouse Supply',802,801,801,'Approved',811) RETURNING *",
    );
    const wsi = await one(
      "INSERT INTO warehouse_supply_items(request_id,requested_item_id,item_name,quantity,approval_status) VALUES($1,$2,$3,$4,'Approved') RETURNING *",
      [wr.id, c.item.id, c.item.item_name, q],
    );
    const supplied = await one(
      "INSERT INTO warehouse_supplied_items(request_id,item_id,supplied_quantity,supplied_by) VALUES($1,$2,$3,807) RETURNING *",
      [wr.id, wsi.id, q],
    );
    return require("../services/inventoryPostingService").postMovement({
      movementType: "ISSUE",
      inventoryItemId: c.stock.id,
      warehouseId: 811,
      instituteId: 801,
      departmentId: 801,
      quantity: q,
      baseUom: "EA",
      stockStatus: "AVAILABLE",
      sourceDocumentType: "warehouse_supply",
      sourceDocumentId: wr.id,
      sourceDocumentLineId: supplied.id,
      actor: stockOperator,
      idempotencyKey: key(),
    });
  };
  const makePo = async (c, quantity = "10", supplierId = 801) => {
    const po = await one(
      "INSERT INTO purchase_orders(request_id,supplier_id,po_number,status,currency,total_amount) VALUES($1,$3,$2,'PO_ISSUED','USD',10) RETURNING *",
      [c.request.id, key(), supplierId],
    );
    po.line = await one(
      "INSERT INTO purchase_order_items(purchase_order_id,request_id,request_item_id,requested_item_id,item_name,quantity,unit_price,line_type,source_uom,base_uom,source_uom_id,base_uom_id,conversion_factor,generic_item_id) VALUES($1,$2,$3,$3,$4,$5,1,$6,'EA','EA',801,801,1,$7) RETURNING *",
      [
        po.id,
        c.request.id,
        c.item.id,
        c.item.item_name,
        quantity,
        c.inventory ? "INVENTORY" : "NON_INVENTORY",
        c.generic?.id || null,
      ],
    );
    return po;
  };
  const make = async ({
    quantity = "10",
    inventory = true,
    required = true,
    poQuantity = quantity,
  } = {}) => {
    const generic = inventory
      ? await one(
          "INSERT INTO generic_items(item_code,generic_name,canonical_description,item_type,category,base_uom,inventory_uom,structured_fingerprint,base_uom_id,inventory_uom_id,is_active,lifecycle_status) VALUES($1,$1,$1,$2,'General','EA','EA',$1,801,801,true,'active') RETURNING *",
          [key(), required ? "medical_device" : "general_item"],
        )
      : null;
    const stock = inventory
      ? await one(
          "INSERT INTO stock_items(name,unit,generic_item_id,inventory_uom_id,mapping_status) VALUES($1,'EA',$2,801,'mapped_generic') RETURNING *",
          [key(), generic.id],
        )
      : null;
    if (stock)
      await client.query(
        "INSERT INTO warehouse_stock_levels(warehouse_id,stock_item_id,item_name,quantity,stock_status) VALUES(811,$1,$2,0,'AVAILABLE')",
        [stock.id, stock.name],
      );
    const request = await one(
      "INSERT INTO requests(request_type,requester_id,department_id,institute_id,status,assigned_to) VALUES($1,802,801,801,'Approved',804) RETURNING *",
      [inventory ? "Medical Device" : "Non-Stock"],
    );
    const item = await one(
      "INSERT INTO requested_items(request_id,item_name,quantity,unit_of_measure,approval_status,request_mode,catalog_status,stocking_policy,generic_item_id) VALUES($1,$2,$3,'EA','Approved',$4,$5,'non_stock',$6) RETURNING *",
      [
        request.id,
        stock?.name || key(),
        quantity,
        inventory ? "generic_item" : "approved_free_text_exception",
        inventory ? "catalogued" : "approved_exception",
        generic?.id || null,
      ],
    );
    const c = { generic, stock, request, item, inventory };
    c.po = await makePo(c, poQuantity);
    c.case = await one(
      "INSERT INTO procurement_cases(request_id,requested_item_id,institute_id,department_id,case_status) VALUES($1,$2,801,801,'SUPPLIER_FULFILLMENT') RETURNING *",
      [request.id, item.id],
    );
    return c;
  };
  const originalMovement = async (receipt) =>
    one(
      "SELECT * FROM inventory_transactions WHERE source_document_type='goods_receipt' AND source_document_id=$1 AND source_document_line_id=$2 AND movement_type='GOODS_RECEIPT' ORDER BY id LIMIT 1",
      [String(receipt.receipt.id), String(receipt.receipt.items[0].id)],
    );
  const transfer = (movement, quantity, options = {}) =>
    status.transferStatus({
      receiptMovementId: movement.id,
      quantity,
      fromStatus: options.from || "QUARANTINE",
      toStatus: options.to || "AVAILABLE",
      reason: "Authorized receipt stock disposition",
      actor: options.actor || stockOperator,
      idempotencyKey: options.key || key(),
      ...options.input,
    });
  try {
    await client.query(`INSERT INTO institutes(id,name) OVERRIDING SYSTEM VALUE VALUES(801,'AUD018 hospital'),(802,'Foreign hospital');
 INSERT INTO departments(id,name,type,institute_id) OVERRIDING SYSTEM VALUE VALUES(801,'Clinical department','Medical',801),(802,'Technical department','Medical',801),(803,'Receiving department','Operational',801),(804,'Foreign department','Operational',802);
 INSERT INTO warehouses(id,name,institute_id,is_active) OVERRIDING SYSTEM VALUE VALUES(811,'AUD018 receiving',801,true),(812,'Foreign receiving',802,true);
 INSERT INTO users(id,name,email,password,role,institute_id,department_id,warehouse_id,is_active) OVERRIDING SYSTEM VALUE VALUES
 (801,'Receiver','receiver801@test.invalid','fixture','WarehouseKeeper',801,803,811,true),
 (802,'Independent clinical reviewer','review802@test.invalid','fixture','HOD',801,801,NULL,true),
 (803,'Independent specialist','review803@test.invalid','fixture','Technician',801,802,NULL,true),
 (804,'SCM signatory','scm804@test.invalid','fixture','SCM',801,803,811,true),
 (805,'Unassigned reviewer','review805@test.invalid','fixture','HOD',801,801,NULL,true),
 (806,'Foreign receiver','foreign806@test.invalid','fixture','WarehouseKeeper',802,804,812,true),
 (807,'Stock disposition operator','stock807@test.invalid','fixture','WarehouseKeeper',801,803,811,true);
 INSERT INTO user_permissions(user_id,permission_id) SELECT 801,id FROM permissions WHERE code='procure-to-pay.receipts.manage';
 INSERT INTO user_permissions(user_id,permission_id) SELECT 806,id FROM permissions WHERE code IN ('procure-to-pay.receipts.manage','inventory.release-quarantine');
 INSERT INTO user_permissions(user_id,permission_id) SELECT 804,id FROM permissions WHERE code IN ('technical-inspections.manage','requests.manage','requests.cross-department','requests.cross-section','procure-to-pay.lifecycle.view');
 INSERT INTO user_permissions(user_id,permission_id) SELECT 807,id FROM permissions WHERE code IN ('warehouse.manage-supply','inventory.release-quarantine','inventory.quarantine','inventory.recall','inventory.reverse','inventory.receive','inventory.adjust');
 INSERT INTO item_uom(id,uom_code,uom_name,normalized_uom_code,is_active) OVERRIDING SYSTEM VALUE VALUES(801,'EA','Each','ea',true);
 INSERT INTO suppliers(id,name,institute_id) OVERRIDING SYSTEM VALUE VALUES(801,'AUD018 supplier',801),(802,'Second owned supplier',801);`);
    receiver = await completion.actor(client, { id: 801 });
    hod = await completion.actor(client, { id: 802 });
    expert = await completion.actor(client, { id: 803 });
    scm = await completion.actor(client, { id: 804 });
    outsider = await completion.actor(client, { id: 805 });
    foreign = await completion.actor(client, { id: 806 });
    stockOperator = await completion.actor(client, { id: 807 });
    await client.query("BEGIN");
    await profiles.save(client, scm, {
      profile_key: "medical_device",
      row_version: 0,
      reason: "Independent clinical receiving policy",
      settings: {
        pre_required: false,
        delivery_required: true,
        level: 2,
        evidence_required: false,
        delivery_checks: profiles.BASE_CHECKS,
        reviewers: [
          { department_id: 801, reviewer_id: 802 },
          { department_id: 802, reviewer_id: 803 },
        ],
      },
    });
    await client.query("COMMIT");
    let full, partial, pending, rejected, quarantine, quarantineReceipt, multi;
    await test("inventory receipt must identify its warehouse even while required inspection holds acceptance", async () => {
      const c = await make(),
        before = await snapshot();
      await assert.rejects(
        () =>
          receiving.createGoodsReceipt({
            repository,
            purchaseOrderId: c.po.id,
            idempotencyKey: key(),
            actor: receiver,
            lines: [
              { purchase_order_item_id: c.po.line.id, received_quantity: "10" },
            ],
          }),
        { statusCode: 400, code: "RECEIPT_WAREHOUSE_REQUIRED" },
      );
      assert.deepEqual(await snapshot(), before);
    });
    await test("full inventory receipt is accepted after independent decision and canonical application", async () => {
      full = await make();
      const g = await receive(full, "10");
      const task = await authorize(await receiptTask(g), "10", "0");
      await apply(task);
      const c = await project(full);
      assert.equal(line(c).accepted_quantity, "10");
      assert.equal(c.receipt_complete, true);
      assert.equal(c.fulfillment_complete, false);
      assert.equal(await balance(full), "10");
    });
    await test("partial receipt acceptance reports partial receiving rather than department fulfillment", async () => {
      partial = await make();
      const g = await receive(partial, "4");
      await apply(await authorize(await receiptTask(g), "4", "0"));
      const c = await project(partial);
      assert.equal(c.partially_received, true);
      assert.equal(line(c).accepted_quantity, "4");
      assert.equal(c.fulfillment_complete, false);
    });
    await test("receipt header and pending opinions never create accepted stock", async () => {
      pending = await make();
      const g = await receive(pending, "10");
      const c = await project(pending);
      assert.equal(line(c).pending_inspection_quantity, "10");
      assert.equal(line(c).accepted_quantity, "0");
      assert.equal(await balance(pending), "0");
      assert.equal(await caseStatus(pending), "SUPPLIER_FULFILLMENT");
      await consume(pending);
      assert.equal(await caseStatus(pending), "SUPPLIER_FULFILLMENT");
    });
    await test("entire rejected delivery frees replacement capacity without accepted stock", async () => {
      rejected = await make();
      const g = await receive(rejected, "10");
      await apply(await authorize(await receiptTask(g), "0", "10"));
      const c = await project(rejected);
      assert.equal(line(c).rejected_quantity, "10");
      assert.equal(line(c).accepted_quantity, "0");
      assert.equal(await balance(rejected), "0");
    });
    await test("partial rejection and held quantities remain distinct and conserved", async () => {
      const c = await make();
      const g = await receive(c, "10");
      await apply(await authorize(await receiptTask(g), "6", "2"));
      const p = await project(c);
      assert.equal(line(p).accepted_quantity, "6");
      assert.equal(line(p).pending_inspection_quantity, "2");
      assert.equal(line(p).rejected_quantity, "2");
      assert.equal(line(p).quarantined_quantity, "0");
      assert.equal(p.receipt_complete, false);
    });
    await test("accepted quarantined material remains unavailable and cannot be issued", async () => {
      quarantine = await make();
      quarantineReceipt = await receive(quarantine, "10", { quarantine: true });
      await apply(
        await authorize(await receiptTask(quarantineReceipt), "10", "0"),
      );
      const c = await project(quarantine);
      assert.equal(line(c).technically_accepted_quantity, "10");
      assert.equal(line(c).accepted_quantity, "0");
      assert.equal(line(c).accepted_pending_release_quantity, "10");
      assert.equal(line(c).quarantined_quantity, "10");
      assert.equal(await balance(quarantine), "0");
      assert.equal(await balance(quarantine, "QUARANTINE"), "10");
      await assert.rejects(() => issue(quarantine, "1"), {
        code: "INSUFFICIENT_STOCK",
      });
    });
    await test("authorized receipt-aware release uses the existing status transfer and updates case delivery", async () => {
      const movement = await originalMovement(quarantineReceipt);
      await transfer(movement, "10");
      const c = await project(quarantine);
      assert.equal(line(c).accepted_quantity, "10");
      assert.equal(line(c).quarantined_quantity, "0");
      assert.equal(line(c).accepted_pending_release_quantity, "0");
      assert.equal(c.receipt_complete, true);
      assert.equal(c.fulfillment_complete, false);
      assert.equal(await balance(quarantine), "10");
      await consume(quarantine);
      assert.equal(await caseStatus(quarantine), "DELIVERED");
    });
    await test("current-master 067 misses authorized release while 068 resolves it without data changes", async () => {
      const before = await snapshot();
      await client.query("BEGIN");
      try {
        const baseline = fs
          .readFileSync(
            path.join(
              __dirname,
              "../sql/manual/067_canonical_procurement_completion.sql",
            ),
            "utf8",
          )
          .replace(/^BEGIN;$/m, "")
          .replace(/^COMMIT;$/m, "");
        await client.query(baseline);
        const old = await project(quarantine);
        assert.equal(line(old).accepted_quantity, "0");
        assert.equal(old.receipt_complete, false);
      } finally {
        await client.query("ROLLBACK");
      }
      assert.equal(line(await project(quarantine)).accepted_quantity, "10");
      assert.deepEqual(await snapshot(), before);
    });
    await test("multiple receipts accumulate only their applied accepted quantities", async () => {
      multi = await make();
      for (const q of ["4", "6"]) {
        const g = await receive(multi, q);
        await apply(await authorize(await receiptTask(g), q, "0"));
      }
      assert.equal(line(await project(multi)).accepted_quantity, "10");
    });
    await test("one accepted PO cannot finish larger multi-PO demand", async () => {
      const c = await make({ poQuantity: "4" });
      const second = await makePo(c, "6", 802);
      const g = await receive(c, "4");
      await apply(await authorize(await receiptTask(g), "4", "0"));
      await consume(c);
      assert.equal((await project(c)).receipt_complete, false);
      assert.equal(await caseStatus(c), "SUPPLIER_FULFILLMENT");
      const b = await receive(c, "6", { po: second });
      await apply(await authorize(await receiptTask(b), "6", "0"));
      await consume(c);
      assert.equal((await project(c)).receipt_complete, true);
      assert.equal(await caseStatus(c), "DELIVERED");
    });
    await test("replacement rejected material contributes only after its own technical acceptance", async () => {
      const g = await receive(rejected, "10");
      assert.equal((await project(rejected)).receipt_complete, false);
      await apply(await authorize(await receiptTask(g), "10", "0"));
      assert.equal(line(await project(rejected)).accepted_quantity, "10");
      assert.equal(line(await project(rejected)).rejected_quantity, "10");
    });
    await test("duplicate acceptance attempt is idempotent across quantities, audit and events", async () => {
      const c = await make(),
        g = await receive(c, "10"),
        task = await authorize(await receiptTask(g), "10", "0");
      await apply(task);
      const before = await snapshot();
      assert.equal((await apply(task)).idempotent, true);
      assert.deepEqual(await snapshot(), before);
    });
    await test("concurrent acceptance attempts post exactly once in PostgreSQL", async () => {
      const c = await make(),
        g = await receive(c, "10"),
        task = await authorize(await receiptTask(g), "10", "0");
      const results = await Promise.all([apply(task), apply(task)]);
      assert.equal(results.filter((x) => !x.idempotent).length, 1);
      assert.equal(await balance(c), "10");
      assert.equal(line(await project(c)).accepted_quantity, "10");
    });
    await test("foreign institute receipt cannot be applied or returned on a retry", async () => {
      const c = await make(),
        g = await receive(c, "10"),
        task = await authorize(await receiptTask(g), "10", "0");
      const before = await snapshot();
      await assert.rejects(() => apply(task, { actor: foreign }), {
        statusCode: 404,
      });
      assert.deepEqual(await snapshot(), before);
    });
    await test("foreign warehouse cannot be substituted during receiving", async () => {
      const c = await make();
      const before = await snapshot();
      await assert.rejects(() => receive(c, "10", { warehouse: 812 }), {
        statusCode: 404,
      });
      assert.deepEqual(await snapshot(), before);
    });
    await test("unassigned reviewer cannot attest another inspectors delivery", async () => {
      const c = await make(),
        g = await receive(c, "10"),
        task = await receiptTask(g);
      const before = await snapshot();
      await assert.rejects(
        () =>
          inspection.opinion(outsider, task.id, {
            row_version: task.row_version,
            decision: "ACCEPTED",
            accepted_quantity: "10",
            rejected_quantity: "0",
          }),
        { statusCode: 404 },
      );
      assert.deepEqual(await snapshot(), before);
    });
    await test("legacy passed inspection remains evidence-only and cannot release canonical hold", async () => {
      await client.query(
        "INSERT INTO technical_inspections(request_id,item_name,acceptance_status) VALUES($1,'Legacy evidence','passed')",
        [pending.request.id],
      );
      const before = await snapshot();
      const result =
        await require("../utils/technicalInspectionStatus").applyRequestStatusFromInspections(
          client,
          { requestId: pending.request.id },
        );
      assert.equal(result.statusUpdated, false);
      assert.equal(line(await project(pending)).accepted_quantity, "0");
      assert.deepEqual(await snapshot(), before);
    });
    await test("partial accepted intake followed by partial issue advances department demand separately", async () => {
      await issue(partial, "3");
      const c = await project(partial);
      assert.equal(line(c).accepted_quantity, "4");
      assert.equal(line(c).warehouse_issued_quantity, "3");
      assert.equal(line(c).fulfilled_quantity, "3");
      assert.equal(c.fulfillment_complete, false);
    });
    await test("no stock issue is possible before required acceptance", async () => {
      const before = await one(
        "SELECT count(*)::int n FROM inventory_transactions WHERE stock_item_id=$1",
        [pending.stock.id],
      );
      await assert.rejects(() => issue(pending, "1"), {
        code: "INSUFFICIENT_STOCK",
      });
      assert.deepEqual(
        await one(
          "SELECT count(*)::int n FROM inventory_transactions WHERE stock_item_id=$1",
          [pending.stock.id],
        ),
        before,
      );
    });
    await test("acceptance outbox advances case once but never mutates PR approval state", async () => {
      const before = await one(
        "SELECT status,completed_at FROM requests WHERE id=$1",
        [full.request.id],
      );
      assert.equal(before.status, full.request.status);
      assert.equal(
        (
          await one("SELECT approval_status FROM requested_items WHERE id=$1", [
            full.item.id,
          ])
        ).approval_status,
        full.item.approval_status,
      );
      const events = await consume(full);
      assert.ok(
        events.some((e) => e.event_type === "GOODS_RECEIPT_ACCEPTANCE_APPLIED"),
      );
      assert.equal(await caseStatus(full), "DELIVERED");
      const count = await one(
        "SELECT count(*)::int n FROM procurement_case_activities WHERE procurement_case_id=$1",
        [full.case.id],
      );
      await consume(full);
      assert.deepEqual(
        await one(
          "SELECT count(*)::int n FROM procurement_case_activities WHERE procurement_case_id=$1",
          [full.case.id],
        ),
        count,
      );
      assert.deepEqual(
        await one("SELECT status,completed_at FROM requests WHERE id=$1", [
          full.request.id,
        ]),
        before,
      );
    });
    await test("accepted warehouse intake requires actual full issue for request fulfillment", async () => {
      await issue(full, "10");
      const c = await project(full);
      assert.equal(c.receipt_complete, true);
      assert.equal(c.fulfillment_complete, true);
      assert.equal(c.can_complete, true);
    });
    await test("acceptance audit failure rolls back receiving inventory task and publication", async () => {
      const c = await make(),
        g = await receive(c, "10"),
        task = await authorize(await receiptTask(g), "10", "0");
      const before = await snapshot();
      const failing = {
        withTransaction: (work) =>
          repository.withTransaction((tx) =>
            work({
              ...tx,
              client: {
                query: async (q, p) => {
                  if (
                    q.includes("INSERT INTO audit_logs") &&
                    p?.[0] === "DELIVERY_DISPOSITION_APPLIED"
                  )
                    throw Error("Injected acceptance audit failure");
                  return tx.client.query(q, p);
                },
              },
            }),
          ),
      };
      await assert.rejects(
        () => apply(task, { repository: failing }),
        /Injected acceptance audit failure/,
      );
      assert.deepEqual(await snapshot(), before);
    });
    await test("direct noninventory routine receipt preserves accepted direct fulfillment", async () => {
      const c = await make({ inventory: false, required: false });
      await receive(c, "10");
      const p = await project(c);
      assert.equal(p.receipt_complete, true);
      assert.equal(p.fulfillment_complete, true);
      assert.equal(line(p).pending_inspection_quantity, "0");
    });
    await test("a release cannot borrow another delivery source capacity from a pooled stock balance", async () => {
      const c = await make();
      const a = await receive(c, "4", { quarantine: true }),
        b = await receive(c, "6", { quarantine: true });
      await apply(await authorize(await receiptTask(a), "4", "0"));
      await apply(await authorize(await receiptTask(b), "6", "0"));
      const m = await originalMovement(a),
        before = await snapshot();
      await assert.rejects(() => transfer(m, "5"), {
        code: "RECEIPT_STATUS_CAPACITY_EXCEEDED",
      });
      assert.deepEqual(await snapshot(), before);
      const k = key();
      await transfer(m, "4", { key: " " + k + " " });
      const saved = await snapshot();
      await transfer(m, "4", { key: k });
      assert.deepEqual(await snapshot(), saved);
      const other = await originalMovement(b);
      await assert.rejects(() => transfer(other, "4", { key: k }), {
        code: "IDEMPOTENCY_CONFLICT",
      });
      assert.deepEqual(await snapshot(), saved);
    });
    await test("concurrent releases serialize the original receipt and never over-release it", async () => {
      const c = await make(),
        g = await receive(c, "10", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "10", "0"));
      const m = await originalMovement(g);
      const results = await Promise.allSettled([
        transfer(m, "6"),
        transfer(m, "6"),
      ]);
      assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(
        results.find((x) => x.status === "rejected").reason.code,
        "RECEIPT_STATUS_CAPACITY_EXCEEDED",
      );
      assert.equal(await balance(c), "6");
      assert.equal(await balance(c, "QUARANTINE"), "4");
      assert.equal(line(await project(c)).accepted_quantity, "6");
    });
    await test("source, warehouse and release authority cannot be forged", async () => {
      const c = await make(),
        g = await receive(c, "10", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "10", "0"));
      const m = await originalMovement(g),
        before = await snapshot();
      await assert.rejects(() => transfer(m, "1", { actor: receiver }), {
        code: "INVENTORY_PERMISSION_DENIED",
      });
      await assert.rejects(() => transfer(m, "1", { actor: foreign }), {
        statusCode: 404,
      });
      await assert.rejects(
        () => transfer(m, "1", { input: { warehouseId: 812 } }),
        { statusCode: 409 },
      );
      await assert.rejects(
        () => transfer(m, "1", { input: { sourceDocumentLineId: 99999 } }),
        { statusCode: 409 },
      );
      await assert.rejects(
        () =>
          status.releaseQuarantine({
            quantity: "1",
            actor: stockOperator,
            reason: "Forged source",
            sourceDocumentType: "goods_receipt",
            sourceDocumentId: g.receipt.id,
            idempotencyKey: key(),
          }),
        { code: "RECEIPT_STATUS_SCOPE_DENIED" },
      );
      assert.deepEqual(await snapshot(), before);
    });
    await test("generic unlinked stock release is not silently attributed to a receipt", async () => {
      const c = await make(),
        g = await receive(c, "10", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "10", "0"));
      await status.releaseQuarantine({
        inventoryItemId: c.stock.id,
        instituteId: 801,
        warehouseId: 811,
        quantity: "10",
        sourceDocumentType: "inventory_status_transfer",
        sourceDocumentId: key(),
        reason: "General inventory operation without receipt provenance",
        actor: stockOperator,
        idempotencyKey: key(),
      });
      assert.equal(await balance(c), "10");
      assert.equal(line(await project(c)).accepted_quantity, "0");
      assert.equal((await project(c)).receipt_complete, false);
    });
    await test("unlinked quarantine cannot leave receipt availability falsely complete", async () => {
      const c = await make(),
        g = await receive(c, "10");
      await apply(await authorize(await receiptTask(g), "10", "0"));
      await status.quarantine({
        inventoryItemId: c.stock.id,
        instituteId: 801,
        warehouseId: 811,
        quantity: "10",
        sourceDocumentType: "inventory_status_transfer",
        sourceDocumentId: key(),
        reason: "Generic quarantine without source attribution",
        actor: stockOperator,
        idempotencyKey: key(),
      });
      const p = await project(c);
      assert.equal(await balance(c), "0");
      assert.equal(await balance(c, "QUARANTINE"), "10");
      assert.equal(line(p).technically_accepted_quantity, "10");
      assert.equal(line(p).accepted_quantity, "0");
      assert.equal(p.receipt_complete, false);
      assert.equal(p.evidence_gap, true);
    });
    await test("generic quarantine uses actual allocation tracking when its command has no batch filter", async () => {
      const c = await make(),
        g = await receive(c, "10", { batch: "AUD018-TRACKED" });
      await apply(await authorize(await receiptTask(g), "10", "0"));
      await status.quarantine({
        inventoryItemId: c.stock.id,
        instituteId: 801,
        warehouseId: 811,
        quantity: "10",
        sourceDocumentType: "inventory_status_transfer",
        sourceDocumentId: key(),
        reason: "Quarantine tracked stock through generic allocator",
        actor: stockOperator,
        idempotencyKey: key(),
      });
      const p = await project(c);
      assert.equal(await balance(c), "0");
      assert.equal(await balance(c, "QUARANTINE"), "10");
      assert.equal(line(p).accepted_quantity, "0");
      assert.equal(p.evidence_gap, true);
      assert.equal(p.receipt_complete, false);
    });
    await test("issued pooled stock cannot be reassigned to a receipt status transfer", async () => {
      const c = await make(),
        g = await receive(c, "10");
      await apply(await authorize(await receiptTask(g), "10", "0"));
      await issue(c, "4");
      const awaitMovement = await originalMovement(g);
      const before = await snapshot();
      await assert.rejects(
        () =>
          transfer(awaitMovement, "1", { from: "AVAILABLE", to: "QUARANTINE" }),
        { code: "RECEIPT_STATUS_SOURCE_CONFLICT" },
      );
      assert.deepEqual(await snapshot(), before);
      assert.equal(line(await project(c)).accepted_quantity, "10");
    });
    await test("re-quarantine removes current accepted availability without rewriting technical approval", async () => {
      const c = await make(),
        g = await receive(c, "10");
      await apply(await authorize(await receiptTask(g), "10", "0"));
      const m = await originalMovement(g);
      await transfer(m, "4", { from: "AVAILABLE", to: "QUARANTINE" });
      const p = await project(c);
      assert.equal(line(p).accepted_quantity, "6");
      assert.equal(line(p).technically_accepted_quantity, "10");
      assert.equal(line(p).quarantined_quantity, "4");
      assert.equal(p.receipt_complete, false);
    });
    await test("receipt and reversal-of-reversal quantities follow canonical ledger lineage", async () => {
      const c = await make({ required: false }),
        g = await receive(c, "10"),
        m = await originalMovement(g);
      const reverse =
        require("../services/inventoryReversalService").reverseMovement;
      const a = await reverse({
        movementId: m.id,
        actor: stockOperator,
        reason: "Received source correction",
        idempotencyKey: key(),
      });
      assert.equal(line(await project(c)).accepted_quantity, "0");
      await reverse({
        movementId: a.movement.id,
        actor: stockOperator,
        reason: "Restore exact correction",
        idempotencyKey: key(),
      });
      assert.equal(line(await project(c)).accepted_quantity, "10");
    });
    await test("release audit and event failures roll back stock provenance and receiving projections", async () => {
      const c = await make(),
        g = await receive(c, "10", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "10", "0"));
      const m = await originalMovement(g);
      for (const point of ["audit", "outbox"]) {
        const before = await snapshot(),
          a = require("../services/auditService"),
          o = require("../services/notificationOutboxService"),
          oldAudit = a.writeAuditEvent,
          oldEvent = o.enqueueNotification;
        if (point === "audit")
          a.writeAuditEvent = (event) =>
            event.action === "goods_receipt.stock_status.changed"
              ? Promise.reject(Error("Injected release audit failure"))
              : oldAudit(event);
        else
          o.enqueueNotification = (db, event) =>
            event.type === "GOODS_RECEIPT_STOCK_STATUS_CHANGED"
              ? Promise.reject(Error("Injected release outbox failure"))
              : oldEvent(db, event);
        try {
          await assert.rejects(() => transfer(m, "10"), /Injected release/);
        } finally {
          a.writeAuditEvent = oldAudit;
          o.enqueueNotification = oldEvent;
        }
        assert.deepEqual(await snapshot(), before);
      }
    });
    await test("release revalidates current permissions even when the caller retains old claims", async () => {
      const c = await make(),
        g = await receive(c, "10", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "10", "0"));
      const m = await originalMovement(g),
        before = await snapshot();
      await client.query(
        "DELETE FROM user_permissions WHERE user_id=807 AND permission_id=(SELECT id FROM permissions WHERE code='inventory.release-quarantine')",
      );
      try {
        await assert.rejects(() => transfer(m, "10"), {
          code: "INVENTORY_PERMISSION_DENIED",
        });
      } finally {
        await client.query(
          "INSERT INTO user_permissions(user_id,permission_id) SELECT 807,id FROM permissions WHERE code='inventory.release-quarantine'",
        );
      }
      assert.deepEqual(await snapshot(), before);
    });
    await test("receipt status provenance and projection are unavailable to browser database roles", async () => {
      for (const role of ["anon", "authenticated"]) {
        const privilege = await one(
          "SELECT has_function_privilege($1,'public.canonical_receipt_inventory_quantity(bigint,integer,text,bigint)','EXECUTE') allowed,has_table_privilege($1,'public.goods_receipt_inventory_status_links','SELECT') can_read",
          [role],
        );
        assert.equal(privilege.allowed, false);
        assert.equal(privilege.can_read, false);
      }
    });
    await test("fractional acceptance and release retain exact decimal quantity conservation", async () => {
      const c = await make(),
        g = await receive(c, "0.1001", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "0.1001", "0"));
      const m = await originalMovement(g);
      await transfer(m, "0.1001");
      const p = await project(c);
      assert.equal(line(p).technically_accepted_quantity, "0.1001");
      assert.equal(line(p).accepted_quantity, "0.1001");
      assert.equal(line(p).quarantined_quantity, "0");
      assert.equal(p.partially_received, true);
    });
    await test("unrepresentable inventory interface quantity fails rather than rounding receipt evidence", async () => {
      const c = await make(),
        g = await receive(c, "10", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "10", "0"));
      const m = await originalMovement(g),
        before = await snapshot();
      await assert.rejects(() => transfer(m, "1.00000000000000001"), {
        code: "RECEIPT_STATUS_PRECISION_REQUIRED",
      });
      assert.deepEqual(await snapshot(), before);
    });
    await test("an unpaired status-leg reversal cannot inflate receiving progress or permit further releases", async () => {
      const c = await make(),
        g = await receive(c, "10", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "10", "0"));
      const m = await originalMovement(g),
        r = await transfer(m, "4");
      await require("../services/inventoryReversalService").reverseMovement({
        movementId: r.debit.movement.id,
        actor: stockOperator,
        reason: "Unpaired correction must not fabricate source acceptance",
        idempotencyKey: key(),
      });
      assert.equal(line(await project(c)).accepted_quantity, "0");
      assert.equal((await project(c)).receipt_complete, false);
      assert.equal((await project(c)).evidence_gap, true);
      await assert.rejects(() => transfer(m, "1"), {
        code: "RECEIPT_STATUS_SOURCE_CONFLICT",
      });
    });
    await test("receipt stock transfer holds warehouse ownership and activation through commit", async () => {
      const c = await make(),
        g = await receive(c, "10", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "10", "0"));
      const m = await originalMovement(g),
        tx = await pool.connect(),
        other = await pool.connect();
      try {
        await tx.query("BEGIN");
        await status.releaseQuarantine(
          {
            receiptMovementId: m.id,
            quantity: "1",
            reason: "Hold warehouse scope until audited transfer commits",
            actor: stockOperator,
            idempotencyKey: key(),
          },
          tx,
        );
        await other.query("BEGIN");
        await other.query("SET LOCAL lock_timeout='100ms'");
        await assert.rejects(
          () =>
            other.query("UPDATE warehouses SET is_active=false WHERE id=811"),
          { code: "55P03" },
        );
        await other.query("ROLLBACK");
        await tx.query("COMMIT");
        assert.equal(await balance(c), "1");
        assert.equal(
          (await one("SELECT is_active FROM warehouses WHERE id=811"))
            .is_active,
          true,
        );
      } finally {
        await other.query("ROLLBACK");
        await tx.query("ROLLBACK");
        other.release();
        tx.release();
      }
    });
    await test("generic quarantine serializes with locked receipt completion evidence", async () => {
      const c = await make(),
        g = await receive(c, "10");
      await apply(await authorize(await receiptTask(g), "10", "0"));
      const m = await originalMovement(g),
        tx = await pool.connect(),
        other = await pool.connect();
      const before = await snapshot();
      try {
        await tx.query("BEGIN");
        await tx.query(
          "SELECT id FROM inventory_transactions WHERE id=$1 FOR SHARE",
          [m.id],
        );
        await other.query("BEGIN");
        await other.query("SET LOCAL lock_timeout='100ms'");
        await assert.rejects(
          () =>
            status.quarantine(
              {
                inventoryItemId: c.stock.id,
                instituteId: 801,
                warehouseId: 811,
                quantity: "1",
                sourceDocumentType: "inventory_status_transfer",
                sourceDocumentId: key(),
                reason: "Concurrent generic quarantine",
                actor: stockOperator,
                idempotencyKey: key(),
              },
              other,
            ),
          { code: "55P03" },
        );
      } finally {
        await other.query("ROLLBACK");
        await tx.query("ROLLBACK");
        other.release();
        tx.release();
      }
      assert.deepEqual(await snapshot(), before);
    });
    await test("separate technical rounds on one GR line retain separate release provenance and events", async () => {
      const c = await make(),
        g = await receive(c, "10", { quarantine: true });
      await apply(await authorize(await receiptTask(g), "4", "0"));
      await apply(await authorize(await receiptTask(g), "6", "0"));
      const originals = (
        await client.query(
          "SELECT * FROM inventory_transactions WHERE source_document_type='goods_receipt' AND source_document_id=$1 AND source_document_line_id=$2 AND movement_type='GOODS_RECEIPT' ORDER BY id",
          [String(g.receipt.id), String(g.receipt.items[0].id)],
        )
      ).rows;
      assert.equal(originals.length, 2);
      const k = key();
      await transfer(originals[0], "4", { key: k });
      const before = await snapshot();
      await assert.rejects(() => transfer(originals[1], "4", { key: k }), {
        code: "IDEMPOTENCY_CONFLICT",
      });
      assert.deepEqual(await snapshot(), before);
      await transfer(originals[1], "6");
      assert.equal(line(await project(c)).accepted_quantity, "10");
      assert.equal(line(await project(c)).quarantined_quantity, "0");
      assert.equal((await project(c)).receipt_complete, true);
      const events = await consume(c);
      const releaseEvents = events.filter(
        (e) => e.event_type === "GOODS_RECEIPT_STOCK_STATUS_CHANGED",
      );
      assert.equal(releaseEvents.length, 2);
      assert.equal(new Set(releaseEvents.map((e) => e.entity_id)).size, 2);
      assert.equal(await caseStatus(c), "DELIVERED");
    });
    await test("SQL repeat preserves historical records and receipt status provenance is immutable", async () => {
      const before = await snapshot();
      const sql = fs.readFileSync(
        path.join(
          __dirname,
          "../sql/manual/068_goods_receipt_acceptance_integration.sql",
        ),
        "utf8",
      );
      await client.query(sql);
      await client.query(sql);
      assert.deepEqual(await snapshot(), before);
      await assert.rejects(
        () => client.query("DELETE FROM goods_receipt_inventory_status_links"),
        /immutable/,
      );
      assert.deepEqual(await snapshot(), before);
    });
    console.log(
      `Goods Receipt acceptance PostgreSQL scenarios passed: ${passed}`,
    );
  } finally {
    await pool.end();
  }
}
module.exports = { run };
