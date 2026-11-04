"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { disposableDatabaseUrl } = require("./disposableDatabase");
async function run(client, url) {
  process.env.DATABASE_URL = disposableDatabaseUrl(url);
  process.env.NODE_ENV = "test";
  const pool = require("../config/db"),
    service = require("../services/procurementCompletionService");
  const repository =
    require("../repositories/connectedP2PRepository").createTransactionalP2PRepository(
      pool,
    );
  const { createGoodsReceipt } = require("../services/goodsReceiptService");
  const { postMovement } = require("../services/inventoryPostingService");
  const one = async (sql, p = []) => (await client.query(sql, p)).rows[0];
  let serial = 0,
    passed = 0,
    actor;
  const key = () => `completion-native-${++serial}`;
  const test = async (name, fn) => {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  };
  const project = async (r) =>
    (
      await one(
        "SELECT public.canonical_procurement_completion($1,701,NULL) AS c",
        [r.id ?? r],
      )
    ).c;
  const first = (c) => c.items.find((x) => x.eligible);
  const snapshot = async () => {
    const out = {};
    for (const table of [
      "requests",
      "requested_items",
      "purchase_orders",
      "purchase_order_items",
      "goods_receipts",
      "goods_receipt_items",
      "warehouse_supplied_items",
      "inventory_transactions",
      "inventory_transaction_allocations",
      "warehouse_stock_levels",
      "audit_logs",
      "notification_outbox",
    ])
      out[table] = (
        await one(
          `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) h FROM ${table} t`,
        )
      ).h;
    return out;
  };
  const denied = async (fn, code) => {
    const before = await snapshot();
    await assert.rejects(fn, code ? { code } : undefined);
    assert.deepEqual(await snapshot(), before);
  };
  const make = async ({
    status = "Approved",
    type = "Non-Stock",
    quantity = "10",
    uom = "EA",
  } = {}) => {
    const r = await one(
      "INSERT INTO requests(request_type,requester_id,department_id,institute_id,status,assigned_to) VALUES($1,701,701,701,$2,701) RETURNING *",
      [type, status],
    );
    const item = await one(
      "INSERT INTO requested_items(request_id,item_name,quantity,unit_of_measure,approval_status,request_mode,catalog_status,stocking_policy) VALUES($1,$2,$3,$4,'Approved','approved_free_text_exception','approved_exception','non_stock') RETURNING *",
      [r.id, key(), quantity, uom],
    );
    return { ...r, item };
  };
  const po = async (r, quantity = "10", options = {}) => {
    if (options.inventory)
      await client.query(
        "UPDATE requested_items SET generic_item_id=701 WHERE id=$1",
        [r.item.id],
      );
    const p = await one(
      "INSERT INTO purchase_orders(request_id,supplier_id,po_number,status,currency,total_amount) VALUES($1,701,$2,$3,'USD',10) RETURNING *",
      [r.id, key(), options.status || "PO_ISSUED"],
    );
    const line = await one(
      "INSERT INTO purchase_order_items(purchase_order_id,request_id,request_item_id,requested_item_id,item_name,quantity,unit_price,line_type,source_uom,base_uom,conversion_factor,source_uom_id,base_uom_id,generic_item_id) VALUES($1,$2,$3,$3,'Completion line',$4,1,$5,$6,'EA',$7,$9,701,$8) RETURNING *",
      [
        p.id,
        r.id,
        r.item.id,
        quantity,
        options.inventory
          ? "INVENTORY"
          : options.service
            ? "SERVICE"
            : "NON_INVENTORY",
        options.source || "EA",
        options.factor || "1",
        options.inventory ? 701 : null,
        options.source === "BOX" ? 703 : 701,
      ],
    );
    return { ...p, line };
  };
  const receive = (p, q, options = {}) =>
    createGoodsReceipt({
      repository,
      purchaseOrderId: p.id,
      idempotencyKey: options.key || key(),
      actor,
      lines: [
        {
          purchase_order_item_id: p.line.id,
          received_quantity: q,
          ...(p.line.line_type === "INVENTORY" ? { warehouse_id: 711 } : {}),
          ...options.line,
        },
      ],
    });
  const warehouse = async (original = null, q = "10") => {
    const r = await one(
      "INSERT INTO requests(request_type,requester_id,department_id,institute_id,status,supply_warehouse_id) VALUES('Warehouse Supply',701,701,701,'Approved',711) RETURNING *",
    );
    const wsi = await one(
      "INSERT INTO warehouse_supply_items(request_id,requested_item_id,item_name,quantity,approval_status) VALUES($1,$2,'Completion stock',$3,'Approved') RETURNING *",
      [r.id, original?.item?.id ?? null, q],
    );
    return { ...r, wsi };
  };
  const issue = async (wr, q = "10") => {
    const record = await one(
      "INSERT INTO warehouse_supplied_items(request_id,item_id,supplied_quantity,supplied_by) VALUES($1,$2,$3,701) RETURNING *",
      [wr.id, wr.wsi.id, q],
    );
    return postMovement({
      movementType: "ISSUE",
      inventoryItemId: 701,
      warehouseId: 711,
      instituteId: 701,
      departmentId: 701,
      quantity: q,
      stockStatus: "AVAILABLE",
      baseUom: "EA",
      sourceDocumentType: "warehouse_supply",
      sourceDocumentId: wr.id,
      sourceDocumentLineId: record.id,
      destinationLocation: "department:701",
      actor,
      idempotencyKey: key(),
    });
  };
  try {
    await client.query(`INSERT INTO institutes(id,name) OVERRIDING SYSTEM VALUE VALUES(701,'Completion institute'),(702,'Foreign');
 INSERT INTO departments(id,name,type,institute_id) OVERRIDING SYSTEM VALUE VALUES(701,'Completion ward','Operational',701),(702,'Foreign','Operational',702);
 INSERT INTO warehouses(id,name,institute_id,is_active) OVERRIDING SYSTEM VALUE VALUES(711,'Completion warehouse',701,true),(712,'Foreign warehouse',702,true);
 INSERT INTO users(id,name,email,password,role,institute_id,department_id,warehouse_id,is_active) OVERRIDING SYSTEM VALUE VALUES(701,'Completion actor','completion701@test.invalid','test','custom',701,701,711,true),(702,'Foreign actor','completion702@test.invalid','test','custom',702,702,NULL,true);
 INSERT INTO user_permissions(user_id,permission_id) SELECT u,p.id FROM unnest(ARRAY[701,702]) u CROSS JOIN permissions p WHERE p.code IN ('requests.manage','requests.view','warehouse.manage-supply','warehouse.view-supply','procure-to-pay.receipts.manage','procure-to-pay.lifecycle.view','inventory.reverse');
 INSERT INTO item_uom(id,uom_code,uom_name,normalized_uom_code,is_active) OVERRIDING SYSTEM VALUE VALUES(701,'EA','EA','ea',true),(703,'BOX','Box','box',true);
 INSERT INTO generic_items(id,item_code,generic_name,canonical_description,item_type,category,base_uom,inventory_uom,structured_fingerprint,base_uom_id,inventory_uom_id,is_active,lifecycle_status) OVERRIDING SYSTEM VALUE VALUES(701,'COMP-701','Completion generic','Completion stock','general_item','General','EA','EA','completion-fixture',701,701,true,'active');
 INSERT INTO stock_items(id,name,unit,generic_item_id,inventory_uom_id,mapping_status) OVERRIDING SYSTEM VALUE VALUES(701,'Completion stock','EA',701,701,'mapped_generic');
 INSERT INTO suppliers(id,name,institute_id) OVERRIDING SYSTEM VALUE VALUES(701,'Completion supplier',701);
 INSERT INTO warehouse_stock_levels(warehouse_id,stock_item_id,item_name,quantity,reserved_quantity,stock_status) VALUES(711,701,'Completion stock',1000,0,'AVAILABLE');`);
    actor = await service.actor(client, { id: 701 });
    let ordered, partial, accepted, quarantine, stock, mixed, multi, technical;
    await test("approved unpurchased request is not complete", async () => {
      const r = await make();
      const c = await project(r);
      assert.equal(c.fulfillment_complete, false);
      assert.equal(c.procurement_complete, false);
      await denied(
        () => service.complete(r.id, actor),
        "COMPLETION_EVIDENCE_REQUIRED",
      );
    });
    await test("fully ordered undelivered demand remains unfulfilled", async () => {
      ordered = await make();
      await po(ordered);
      const c = await project(ordered);
      assert.equal(c.procurement_complete, true);
      assert.equal(c.receipt_complete, false);
      assert.equal(c.fulfillment_complete, false);
    });
    await test("partial PO issuance is not complete procurement", async () => {
      const r = await make();
      await po(r, "4");
      const c = await project(r);
      assert.equal(c.procurement_complete, false);
      assert.equal(first(c).ordered_quantity, "4");
    });
    await test("partial Goods Receipt remains partial fulfillment", async () => {
      partial = await make();
      const p = await po(partial);
      await receive(p, "4");
      const c = await project(partial);
      assert.equal(c.partially_fulfilled, true);
      assert.equal(c.fulfillment_complete, false);
    });
    await test("full delivery pending technical inspection is not acceptance", async () => {
      technical = await make();
      const p = await po(technical);
      const g = await receive(p, "10");
      await client.query(
        "UPDATE goods_receipt_items SET technical_inspection_required=true WHERE goods_receipt_id=$1",
        [g.receipt.id],
      );
      const c = await project(technical);
      assert.equal(first(c).delivered_quantity, "10");
      assert.equal(c.receipt_complete, false);
      assert.equal(first(c).inspection_pending, true);
    });
    await test("accepted direct receipt satisfies demand independently of payment", async () => {
      accepted = await make();
      const p = await po(accepted);
      await receive(p, "10");
      const c = await project(accepted);
      assert.equal(c.fulfillment_complete, true);
      assert.equal(c.can_complete, true);
      const result = await service.complete(accepted.id, actor);
      assert.equal(result.after, "Completed");
      assert.ok(
        (
          await one("SELECT completed_at FROM requests WHERE id=$1", [
            accepted.id,
          ])
        ).completed_at,
      );
    });
    await test("rejected receipt does not count as accepted", async () => {
      const r = await make();
      const p = await po(r);
      const g = await receive(p, "10");
      await client.query(
        "UPDATE goods_receipt_items SET technical_inspection_required=true,technical_rejected_quantity=10 WHERE goods_receipt_id=$1",
        [g.receipt.id],
      );
      const c = await project(r);
      assert.equal(first(c).accepted_quantity, "0");
      assert.equal(first(c).rejected_quantity, "10");
      assert.equal(c.fulfillment_complete, false);
    });
    await test("quarantined stock cannot fulfill demand", async () => {
      quarantine = await make();
      const p = await po(quarantine);
      await receive(p, "10", { line: { stock_status: "QUARANTINE" } });
      const c = await project(quarantine);
      assert.equal(first(c).quarantined_quantity, "10");
      assert.equal(c.fulfillment_complete, false);
    });
    await test("partial warehouse supply stays partial", async () => {
      stock = await warehouse();
      await issue(stock, "4");
      assert.equal((await project(stock)).partially_fulfilled, true);
      assert.equal((await project(stock)).fulfillment_complete, false);
    });
    await test("full warehouse supply requires actual issue and no PO", async () => {
      await issue(stock, "6");
      const c = await project(stock);
      assert.equal(c.fulfillment_complete, true);
      assert.equal(first(c).warehouse_issued_quantity, "10");
      await service.complete(stock.id, actor);
    });
    await test("stock-only original resolves from linked actual issue", async () => {
      const r = await make({ type: "Stock" });
      await client.query(
        "UPDATE requested_items SET approval_status='Rejected',procurement_status='available_in_stock' WHERE id=$1",
        [r.item.id],
      );
      const w = await warehouse(r);
      assert.equal((await project(r)).fulfillment_complete, false);
      await issue(w);
      assert.equal((await project(r)).fulfillment_complete, true);
      assert.equal(
        (
          await one(
            "SELECT COUNT(*)::int n FROM purchase_orders WHERE request_id=$1",
            [r.id],
          )
        ).n,
        0,
      );
    });
    await test("mixed stock and direct procurement are counted once per source", async () => {
      mixed = await make();
      const p = await po(mixed, "6");
      await receive(p, "6");
      const w = await warehouse(mixed, "4");
      await issue(w, "4");
      const c = await project(mixed);
      assert.equal(first(c).fulfilled_quantity, "10");
      assert.equal(c.fulfillment_complete, true);
    });
    await test("one fully received PO cannot close larger multi-PO demand", async () => {
      multi = await make();
      const p = await po(multi, "4");
      await po(multi, "6");
      await receive(p, "4");
      assert.equal((await project(multi)).fulfillment_complete, false);
    });
    await test("multiple receipts accumulate without duplicate links", async () => {
      const r = await make();
      const p = await po(r);
      await receive(p, "4");
      await receive(p, "6");
      assert.equal(first(await project(r)).accepted_quantity, "10");
    });
    await test("duplicate receipt retry emits no duplicate evidence", async () => {
      const r = await make();
      const p = await po(r);
      const k = key();
      const a = await receive(p, "4", { key: k });
      const before = await snapshot();
      const b = await receive(p, "4", { key: k });
      assert.equal(b.receipt.id, a.receipt.id);
      assert.equal(b.idempotent, true);
      assert.deepEqual(await snapshot(), before);
    });
    await test("concurrent receiving cannot overfulfill PO capacity", async () => {
      const r = await make();
      const p = await po(r);
      const result = await Promise.allSettled([
        receive(p, "6"),
        receive(p, "6"),
      ]);
      assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(first(await project(r)).accepted_quantity, "6");
    });
    for (const terminal of ["Cancelled", "Rejected"])
      await test(`${terminal} request cannot reopen through completion evidence`, async () => {
        const r = await make({ status: terminal });
        const p = await po(r);
        await receive(p, "10");
        assert.equal((await project(r)).fulfillment_complete, false);
        await denied(() => service.complete(r.id, actor));
        assert.equal(
          (await one("SELECT status FROM requests WHERE id=$1", [r.id])).status,
          terminal,
        );
      });
    await test("foreign or grafted receipt ancestry is never counted", async () => {
      const r = await make();
      const p = await po(r);
      const g = await receive(p, "10");
      await client.query(
        "UPDATE goods_receipts SET request_id=$2 WHERE id=$1",
        [g.receipt.id, ordered.id],
      );
      const c = await project(r);
      assert.equal(c.evidence_gap, true);
      assert.equal(c.fulfillment_complete, false);
      await assert.rejects(() => service.get(r.id, { id: 702 }), {
        statusCode: 404,
      });
    });
    await test("legacy inspection cannot replace required acceptance or write request state", async () => {
      await client.query(
        "INSERT INTO technical_inspections(request_id,item_name,acceptance_status) VALUES($1,'Legacy evidence','passed')",
        [technical.id],
      );
      const before = await one(
        "SELECT status,completed_at FROM requests WHERE id=$1",
        [technical.id],
      );
      await require("../utils/technicalInspectionStatus").applyRequestStatusFromInspections(
        client,
        { requestId: technical.id },
      );
      assert.equal((await project(technical)).fulfillment_complete, false);
      assert.deepEqual(
        await one("SELECT status,completed_at FROM requests WHERE id=$1", [
          technical.id,
        ]),
        before,
      );
    });
    await test("controlled UOM snapshots convert packaging into demand units", async () => {
      const r = await make({ quantity: "24" });
      const p = await po(r, "2", {
        inventory: true,
        source: "BOX",
        factor: "12",
      });
      await receive(p, "2");
      const c = await project(r);
      assert.equal(first(c).ordered_quantity, "24");
      assert.equal(first(c).accepted_quantity, "24");
      assert.equal(c.receipt_complete, true);
      assert.equal(c.fulfillment_complete, false);
    });
    await test("audit failure rolls completion status timestamp and outbox back", async () => {
      const r = await make();
      const p = await po(r);
      await receive(p, "10");
      const before = await snapshot();
      const a = await service.actor(client, actor);
      const lifecycle =
        require("../services/requestLifecycleService").createRequestLifecycleService(
          {
            audit: async () => {
              throw Error("Injected completion audit failure");
            },
          },
        );
      await assert.rejects(
        () =>
          lifecycle.transition({
            requestId: r.id,
            actor: a,
            toStatus: "Completed",
            permission: "requests.manage",
          }),
        /Injected completion audit failure/,
      );
      assert.deepEqual(await snapshot(), before);
    });
    await test("warehouse controller rejects partial close and stale duplicate execution", async () => {
      const r = await warehouse();
      const controller = require("../controllers/warehouseSupplyController");
      const call = async (fn, body = {}) => {
        let error;
        const res = {
          status() {
            return this;
          },
          json(value) {
            this.value = value;
            return this;
          },
        };
        await fn(
          { params: { requestId: String(r.id) }, body, user: actor },
          res,
          (e) => {
            error = e;
          },
        );
        return { error, value: res.value };
      };
      const save = (q) => ({
        items: [
          {
            item_id: r.wsi.id,
            stock_item_id: 701,
            supplied_quantity: q,
            expected_supplied_quantity: 0,
          },
        ],
      });
      const a = await call(controller.recordSuppliedItems, save(4));
      assert.ifError(a.error);
      assert.equal((await project(r)).fulfillment_complete, false);
      const before = await snapshot();
      const retry = await call(controller.recordSuppliedItems, save(4));
      assert.equal(retry.error.code, "SUPPLY_QUANTITY_CHANGED");
      assert.deepEqual(await snapshot(), before);
      const close = await call(controller.closeWarehouseSupplyRequest);
      assert.equal(close.error.statusCode, 409);
      assert.deepEqual(await snapshot(), before);
      const b = await call(controller.recordSuppliedItems, {
        items: [
          {
            item_id: r.wsi.id,
            stock_item_id: 701,
            supplied_quantity: 6,
            expected_supplied_quantity: 4,
          },
        ],
      });
      assert.ifError(b.error);
      assert.equal((await project(r)).fulfillment_complete, true);
      assert.equal(
        (await one("SELECT status FROM requests WHERE id=$1", [r.id])).status,
        "Completed",
      );
    });
    await test("reversing a warehouse issue removes fulfillment without rewriting history", async () => {
      const r = await warehouse();
      const movement = await issue(r);
      assert.equal((await project(r)).fulfillment_complete, true);
      await require("../services/inventoryReversalService").reverseMovement({
        movementId: movement.movement.id,
        reason: "Completion regression reversal",
        actor,
        idempotencyKey: key(),
      });
      assert.equal(first(await project(r)).warehouse_issued_quantity, "0");
      assert.equal((await project(r)).fulfillment_complete, false);
    });
    await test("ambiguous UOM and unverified service acceptance cannot close demand", async () => {
      for (const options of [
        { source: "BOX", factor: "12" },
        { service: true },
      ]) {
        const r = await make({ uom: options.service ? "EA" : "UNKNOWN" });
        const p = await po(r, "10", options);
        await receive(p, "10");
        const c = await project(r);
        assert.equal(c.evidence_gap, true);
        assert.equal(c.fulfillment_complete, false);
        await denied(
          () => service.complete(r.id, actor),
          "COMPLETION_EVIDENCE_REQUIRED",
        );
      }
    });
    await test("purchased counters and cancelled item labels do not fulfill demand", async () => {
      const r = await make();
      await client.query(
        "UPDATE requested_items SET purchased_quantity=quantity,procurement_status='purchased' WHERE id=$1",
        [r.item.id],
      );
      assert.equal((await project(r)).fulfillment_complete, false);
      await client.query(
        "UPDATE requested_items SET procurement_status='canceled' WHERE id=$1",
        [r.item.id],
      );
      await denied(
        () => service.complete(r.id, actor),
        "COMPLETION_EVIDENCE_REQUIRED",
      );
    });
    await test("completion command retry is idempotent and has one lifecycle event", async () => {
      const before = await snapshot();
      const result = await service.complete(accepted.id, actor);
      assert.equal(result.idempotent, true);
      assert.deepEqual(await snapshot(), before);
    });
    await test("requester acknowledgment confirms accepted stock without another receipt movement", async () => {
      const r = await make({ quantity: "24" });
      const p = await po(r, "2", {
        inventory: true,
        source: "BOX",
        factor: "12",
      });
      await receive(p, "2");
      assert.equal((await project(r)).fulfillment_complete, false);
      const before = await one(
        "SELECT count(*)::int n FROM inventory_transactions",
      );
      let error;
      const res = {
        json(value) {
          this.value = value;
        },
      };
      await require("../controllers/requests/updateRequestsController").markRequestAsReceived(
        {
          params: { id: String(r.id) },
          body: { item_id: r.item.id },
          user: actor,
        },
        res,
        (e) => {
          error = e;
        },
      );
      assert.ifError(error);
      assert.equal((await project(r)).fulfillment_complete, true);
      assert.equal(
        (await one("SELECT status FROM requests WHERE id=$1", [r.id])).status,
        "Received",
      );
      assert.deepEqual(
        await one("SELECT count(*)::int n FROM inventory_transactions"),
        before,
      );
    });
    await test("pending approval prevents completion even with full accepted delivery", async () => {
      const r = await make();
      const p = await po(r);
      await receive(p, "10");
      await client.query(
        "INSERT INTO approvals(request_id,approver_id,approval_level,status) VALUES($1,701,1,'Pending')",
        [r.id],
      );
      assert.equal((await project(r)).approved_demand, false);
      await denied(
        () => service.complete(r.id, actor),
        "COMPLETION_EVIDENCE_REQUIRED",
      );
    });
    await test("case outbox delivery uses all accepted demand and retries idempotently", async () => {
      const r = await make();
      const p1 = await po(r, "4"),
        p2 = await po(r, "6");
      const c = await one(
        "INSERT INTO procurement_cases(request_id,requested_item_id,institute_id,department_id,case_status) VALUES($1,$2,701,701,'SUPPLIER_FULFILLMENT') RETURNING *",
        [r.id, r.item.id],
      );
      const consume = async (receipt) => {
        const event = await one(
          "SELECT * FROM notification_outbox WHERE event_type='GOODS_RECEIPT_POSTED' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
          [String(receipt.receipt.id)],
        );
        assert.ok(event);
        await require("../services/notificationOutboxProcessor").deliverInApp(
          client,
          event,
        );
      };
      const a = await receive(p1, "4");
      await consume(a);
      assert.equal(
        (
          await one("SELECT case_status FROM procurement_cases WHERE id=$1", [
            c.id,
          ])
        ).case_status,
        "SUPPLIER_FULFILLMENT",
      );
      const b = await receive(p2, "6");
      await consume(b);
      assert.equal(
        (
          await one("SELECT case_status FROM procurement_cases WHERE id=$1", [
            c.id,
          ])
        ).case_status,
        "DELIVERED",
      );
      const before = await one(
        "SELECT count(*)::int n FROM procurement_case_activities WHERE procurement_case_id=$1",
        [c.id],
      );
      await consume(b);
      assert.deepEqual(
        await one(
          "SELECT count(*)::int n FROM procurement_case_activities WHERE procurement_case_id=$1",
          [c.id],
        ),
        before,
      );
    });
    await test("completion waits for a concurrent issue reversal and refuses stale evidence", async () => {
      const r = await warehouse(),
        issued = await issue(r);
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        await require("../services/inventoryReversalService").reverseMovement(
          {
            movementId: issued.movement.id,
            reason: "Concurrent evidence withdrawal",
            actor,
            idempotencyKey: key(),
          },
          tx,
        );
        const pending = service.complete(r.id, actor).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
        await tx.query("COMMIT");
        const result = await pending;
        assert.equal(result.error?.code, "COMPLETION_EVIDENCE_REQUIRED");
        assert.equal(
          (await one("SELECT status FROM requests WHERE id=$1", [r.id])).status,
          "Approved",
        );
      } finally {
        await tx.query("ROLLBACK");
        tx.release();
      }
    });
    await test("completion requires fresh explicit authority rather than a legacy role name", async () => {
      await client.query(
        "INSERT INTO users(id,name,email,password,role,institute_id,department_id,is_active) OVERRIDING SYSTEM VALUE VALUES(703,'Ungrant actor','completion703@test.invalid','fixture','SCM',701,701,true)",
      );
      const r = await make();
      const p = await po(r);
      await receive(p, "10");
      await client.query("UPDATE requests SET requester_id=703 WHERE id=$1", [
        r.id,
      ]);
      await denied(
        () => service.complete(r.id, { id: 703 }),
        "PERMISSION_DENIED",
      );
      await client.query("UPDATE users SET is_active=false WHERE id=703");
      await assert.rejects(() => service.get(r.id, { id: 703 }), {
        statusCode: 403,
      });
    });
    await test("SQL projection cannot be executed directly by browser database roles", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const privilege = await one(
          "SELECT has_function_privilege($1,'public.canonical_procurement_completion(integer,integer,integer)','EXECUTE') allowed",
          [role],
        );
        assert.equal(privilege.allowed, role === "service_role");
      }
      assert.equal(
        require("../services/approvalPolicyEngine").LIVE_ROUTING_ENABLED,
        false,
      );
    });
    await test("approved stock diversion preserves inactive future approvals and its no-PO completion path", async () => {
      const r = await make({ status: "Available in Stock", type: "Stock" });
      await client.query(
        "UPDATE requested_items SET approval_status='Rejected',procurement_status='available_in_stock' WHERE id=$1",
        [r.item.id],
      );
      await client.query(
        "INSERT INTO approvals(request_id,approver_id,approval_level,status,is_active) VALUES($1,701,2,'Pending',false)",
        [r.id],
      );
      const w = await warehouse(r);
      await issue(w);
      assert.equal((await project(r)).can_complete, true);
      await service.complete(r.id, actor);
      assert.equal((await project(r)).fulfillment_complete, true);
    });
    await test("read projection and repeated SQL preserve historical rows", async () => {
      const before = await snapshot();
      for (const r of [
        ordered,
        partial,
        accepted,
        quarantine,
        stock,
        mixed,
        multi,
        technical,
      ])
        await project(r);
      const sql = fs.readFileSync(
        require("node:path").join(
          __dirname,
          "../sql/manual/067_canonical_procurement_completion.sql",
        ),
        "utf8",
      );
      await client.query(sql);
      await client.query(sql);
      assert.deepEqual(await snapshot(), before);
    });
    console.log(`Canonical completion PostgreSQL cases passed: ${passed}`);
  } finally {
    await pool.end();
  }
}
module.exports = { run };
