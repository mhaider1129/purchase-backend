"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
function serializeContract(c) {
  return (
    '{\n  "version": ' +
    JSON.stringify(c.version) +
    ',\n  "baseline_ref": ' +
    JSON.stringify(c.baseline_ref) +
    ',\n  "catalog": {\n' +
    Object.entries(c.catalog)
      .map(
        ([k, rows]) =>
          "    " +
          JSON.stringify(k) +
          ": [\n" +
          rows.map((r) => "      " + JSON.stringify(r)).join(",\n") +
          "\n    ]",
      )
      .join(",\n") +
    "\n  }\n}\n"
  );
}
async function capture(client) {
  if (!process.argv.includes("--capture-database-contract")) return;
  const dir = path.join(__dirname, "../database/releases");
  fs.writeFileSync(
    path.join(dir, "schema-contract.json"),
    serializeContract({
      version: "hospital-erp-2026-11-scop1",
      baseline_ref: "2d27e3f2",
      catalog: await require("../scripts/lib/databaseRelease/catalog").snapshot(
        client,
      ),
    }),
  );
  fs.writeFileSync(
    path.join(dir, "migration-inventory.json"),
    JSON.stringify(
      require("../scripts/lib/databaseRelease/inventory").inventory(),
      null,
      2,
    ) + "\n",
  );
}
async function run(client, url, c) {
  require("./disposableDatabase").disposableDatabaseUrl(url);
  const s = require("../services/scopFoundationService");
  process.env.SCOP_FOUNDATION_ENABLED = "true";
  const one = async (sql, p = []) => (await client.query(sql, p)).rows[0];
  let n = 0,
    passed = 0;
  const key = () => `scop-native-${++n}`,
    actor = { id: 9701 };
  const test = async (name, fn) => {
    await fn();
    passed++;
    console.log(`PASS SCOP ${name}`);
  };
  const params = (x) => ({
    requestId: String(x.request.id),
    itemKind: "requested_item",
    itemId: String(x.item.id),
  });
  const snapshot = async () => {
    const out = {};
    for (const t of [
      "requests",
      "requested_items",
      "approvals",
      "warehouse_supply_items",
      "warehouse_supplied_items",
      "inventory_transactions",
      "warehouse_stock_levels",
      "purchase_orders",
      "purchase_order_items",
      "goods_receipts",
      "goods_receipt_items",
      "supplier_invoices",
      "ap_vouchers",
      "ap_payables",
      "payment_records",
      "payment_allocations",
      "contract_invoices",
      "contract_payments",
      "notification_outbox",
    ])
      out[t] = (
        await one(
          `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) h FROM ${t} t`,
        )
      ).h;
    return out;
  };
  const cmd = async (x, action, input = {}, a = actor) => {
    const before = await snapshot();
    try {
      return await s.command(a, x.request ? params(x) : x, action, {
        command_key: key(),
        ...input,
      });
    } finally {
      assert.deepEqual(await snapshot(), before);
    }
  };
  const classify = (x, extra = {}) =>
    cmd(x, "classify", {
      category_id: 9701,
      purpose_code: "ROUTINE",
      policy_code: "STANDARD",
      ...extra,
    });
  const source = (quantity = "10", extra = {}) => ({
    source_kind: "CENTRAL_SUPPLY",
    responsible_user_id: 9701,
    quantity,
    reason: "Approved source responsibility",
    ...extra,
  });
  const allocate = (x, q = "10", extra = {}) =>
    cmd(x, "create", source(q, extra));
  const act = (x, a, action, body = {}) =>
    cmd({ ...params(x), allocationId: String(a.id) }, action, {
      expected_revision: a.revision,
      reason: "Reviewed transition",
      ...body,
    });
  const read = (x) => s.get(actor, params(x));
  const facts = async (x, a) =>
    (await read(x)).allocations.find((r) => String(r.id) === String(a.id))
      .progress;
  const bind = (x, a, kind, id) =>
    act(x, a, "evidence", { kind, source_id: String(id) });
  const fresh = async (options) => {
    const x = await c.make(options);
    await classify(x);
    return x;
  };
  const deny = (fn, code) => assert.rejects(fn, code ? { code } : undefined);
  await client.query(`INSERT INTO users(id,name,email,password,role,institute_id,department_id,warehouse_id,is_active) OVERRIDING SYSTEM VALUE VALUES
   (9701,'SCOP coordinator','scop9701@test.invalid','fixture','custom',801,801,811,true),(9702,'Foreign','scop9702@test.invalid','fixture','custom',802,802,NULL,true),
   (9703,'Buyer','scop9703@test.invalid','fixture','SCM',801,801,811,true),(9704,'No permission','scop9704@test.invalid','fixture','custom',801,801,811,true);
   INSERT INTO user_permissions(user_id,permission_id) SELECT u,p.id FROM unnest(ARRAY[9701,9702,9703]) u CROSS JOIN permissions p WHERE p.code IN ('scop.allocations.manage','scop.allocations.view','requests.manage','warehouse.manage-supply','inventory.cross-warehouse','inventory.transfer','contracts.manage','procurement.update-status');
   INSERT INTO warehouses(id,name,institute_id,is_active) OVERRIDING SYSTEM VALUE VALUES(813,'SCOP origin',801,true);
   INSERT INTO item_categories(id,category_name,normalized_name,is_active) OVERRIDING SYSTEM VALUE VALUES(9701,'SCOP test','scop test',true);`);
  const root = await c.make();
  let a;
  await test("Central Supply marker reloads actor, serializes no-op retries and rejects foreign request", async () => {
    const update =
      require("../controllers/requests/centralSupplyChainController").updateCentralSupplyChainStatus;
    const invoke = async (user, requestId, sent) => {
      let result, error;
      await update(
        { user, params: { id: String(requestId) }, body: { sent } },
        {
          json: (v) => {
            result = v;
          },
        },
        (e) => {
          error = e;
        },
      );
      if (error) throw error;
      return result;
    };
    const x = await c.make(),
      before = await one("SELECT count(*)::int n FROM audit_logs");
    const values = await Promise.all([
      invoke(actor, x.request.id, true),
      invoke(actor, x.request.id, true),
    ]);
    assert.deepEqual(values[0], values[1]);
    assert.equal(
      (await one("SELECT count(*)::int n FROM audit_logs")).n,
      before.n + 1,
    );
    await deny(() => invoke({ id: 9702 }, x.request.id, false));
    await client.query(
      "CREATE FUNCTION scop_test_marker_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='request.central_supply_status_changed' THEN RAISE EXCEPTION 'marker audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER scop_test_marker_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION scop_test_marker_failure()",
    );
    try {
      await deny(() => invoke(actor, x.request.id, false));
      assert.notEqual(
        (
          await one(
            "SELECT sent_to_central_supply_at FROM requests WHERE id=$1",
            [x.request.id],
          )
        ).sent_to_central_supply_at,
        null,
      );
    } finally {
      await client.query(
        "DROP TRIGGER scop_test_marker_failure ON audit_logs; DROP FUNCTION scop_test_marker_failure()",
      );
    }
  });
  await test("disabled flag blocks reads and writes without enrolling history", async () => {
    delete process.env.SCOP_FOUNDATION_ENABLED;
    await deny(() => classify(root), "SCOP_DISABLED");
    await deny(() => read(root), "SCOP_DISABLED");
    process.env.SCOP_FOUNDATION_ENABLED = "true";
    assert.equal((await read(root)).enrolled, false);
  });
  await test("unauthorized and foreign actors fail closed", async () => {
    await deny(() => s.get({ id: 9704 }, params(root)));
    await deny(() => s.get({ id: 9702 }, params(root)), "SCOP_NOT_FOUND");
  });
  await test("actor deactivation and null institute are revalidated", async () => {
    await client.query("UPDATE users SET is_active=false WHERE id=9701");
    await deny(() => classify(root));
    await client.query(
      "UPDATE users SET is_active=true,institute_id=NULL WHERE id=9701",
    );
    await deny(() => classify(root));
    await client.query("UPDATE users SET institute_id=801 WHERE id=9701");
  });
  await test("pending approval, cancellation and item rejection block enrollment", async () => {
    const x = await c.make();
    await client.query(
      "INSERT INTO approvals(request_id,approver_id,approval_level,status,is_active) VALUES($1,9701,3,'Pending',true)",
      [x.request.id],
    );
    await deny(() => classify(x));
    const y = await c.make();
    await client.query("UPDATE requests SET status='Cancelled' WHERE id=$1", [
      y.request.id,
    ]);
    await deny(() => classify(y));
    const z = await c.make();
    await client.query(
      "UPDATE requested_items SET approval_status='Rejected' WHERE id=$1",
      [z.item.id],
    );
    await deny(() => classify(z), "SCOP_ITEM_REJECTED");
  });
  await test("classification preserves original request, approval and department function", async () => {
    const p = await classify(root);
    assert.equal(p.requesting_function_id, 801);
    assert.equal(p.requested_item_id, root.item.id);
    assert.equal(p.approval_snapshot.request_status, "Approved");
    await deny(() => classify(root));
  });
  await test("foreign item reference and frontend institute spoofing are rejected", async () => {
    const x = await c.make();
    await deny(
      () =>
        s.command(
          actor,
          { ...params(root), itemId: String(x.item.id) },
          "create",
          { command_key: key(), ...source() },
        ),
      "SCOP_NOT_FOUND",
    );
    await deny(() => allocate(root, "1", { institute_id: 802 }));
  });
  await test("partial allocation replay returns one durable result and audit", async () => {
    const k = key(),
      body = { command_key: k, ...source("4") };
    a = await cmd(root, "create", body);
    assert.deepEqual(await cmd(root, "create", body), a);
    assert.equal((await read(root)).unallocated_quantity, "6.000000");
    assert.equal(
      (
        await one(
          "SELECT count(*)::int n FROM audit_logs WHERE details::text LIKE $1",
          ["%" + JSON.stringify("scop:801:" + k) + "%"],
        )
      ).n,
      1,
    );
    await deny(
      () => cmd(root, "create", { ...body, quantity: "5" }),
      "SCOP_IDEMPOTENCY_CONFLICT",
    );
  });
  await test("invalid, excessive and unsupported quantities never commit", async () => {
    for (const q of ["-1", "0", "0.0000001", "7", "1e1"])
      await deny(() => allocate(root, q));
  });
  await test("split exactly conserves parent and keeps immutable lineage", async () => {
    const split = await act(root, a, "split", {
      parts: [source("1"), source("3")],
    });
    assert.equal(split.allocations.length, 2);
    assert(
      split.allocations.every(
        (x) => String(x.parent_allocation_id) === String(a.id),
      ),
    );
    assert.equal((await read(root)).unallocated_quantity, "6.000000");
    await deny(
      () => act(root, a, "split", { parts: [source("1"), source("3")] }),
      "SCOP_STALE",
    );
    a = split.allocations[0];
  });
  await test("invalid split rolls back parent transition", async () => {
    await deny(
      () => act(root, a, "split", { parts: [source("0.4"), source("0.5")] }),
      "SCOP_SPLIT_QUANTITY",
    );
    assert.equal(
      (await read(root)).allocations.find((x) => x.id === a.id).status,
      "ACTIVE",
    );
  });
  await test("reassignment requires eligible active buyer and preserves quantity", async () => {
    const body = source("1", {
      source_kind: "LOCAL_PROCUREMENT",
      responsible_user_id: 9701,
    });
    delete body.quantity;
    await deny(() => act(root, a, "reassign", body));
    body.responsible_user_id = 9703;
    a = await act(root, a, "reassign", body);
    assert.equal(a.quantity, "1.000000");
    await deny(() =>
      act(root, a, "reassign", { ...body, responsible_user_id: 9702 }),
    );
  });
  await test("unused cancellation releases capacity and preserves history", async () => {
    assert.equal((await act(root, a, "cancel")).status, "CANCELLED");
    assert.equal((await read(root)).unallocated_quantity, "7.000000");
    await deny(() => act(root, a, "cancel"), "SCOP_STALE");
  });
  await test("concurrent allocation cannot exceed original approved ceiling", async () => {
    const x = await fresh(),
      r = await Promise.allSettled([allocate(x, "7"), allocate(x, "7")]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await read(x)).unallocated_quantity, "3.000000");
  });
  await test("simultaneous identical execution creates one allocation", async () => {
    const x = await fresh(),
      body = { command_key: key(), ...source("6") };
    const r = await Promise.all([
      s.command(actor, params(x), "create", body),
      s.command(actor, params(x), "create", body),
    ]);
    assert.deepEqual(r[0], r[1]);
    assert.equal((await read(x)).allocations.length, 1);
  });
  await test("simultaneous reassignment is revision fenced", async () => {
    const x = await fresh(),
      a = await allocate(x),
      body = source();
    delete body.quantity;
    const r = await Promise.allSettled([
      act(x, a, "reassign", body),
      act(x, a, "reassign", body),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  });
  await test("warehouse stock requires owned scoped warehouse", async () => {
    const x = await fresh();
    await allocate(x, "4", {
      source_kind: "WAREHOUSE_STOCK",
      warehouse_id: 811,
    });
    await deny(() =>
      allocate(x, "1", { source_kind: "WAREHOUSE_STOCK", warehouse_id: 812 }),
    );
  });
  await test("local residual requires explicit policy exception authority and evidence", async () => {
    const x = await c.make();
    await classify(x, { policy_code: "CENTER_FIRST" });
    await deny(
      () =>
        allocate(x, "4", {
          source_kind: "LOCAL_PROCUREMENT",
          responsible_user_id: 9703,
        }),
      "SCOP_POLICY_EXCEPTION_REQUIRED",
    );
    await client.query(
      "INSERT INTO user_permissions(user_id,permission_id) SELECT 9701,id FROM permissions WHERE code='scop.allocations.override-policy'",
    );
    await allocate(x, "4", {
      source_kind: "LOCAL_PROCUREMENT",
      responsible_user_id: 9703,
      evidence_note: "Attested center release REF-42",
    });
  });
  await test("contract source checks actual institute and approved item identity", async () => {
    const x = await fresh(),
      ct = await one(
        "INSERT INTO contracts(title,vendor,status,institute_id,end_user_department_id,source_request_id,supplier_id) VALUES('SCOP blanket','Supplier','active',801,801,$1,801) RETURNING *",
        [x.request.id],
      );
    await client.query(
      "INSERT INTO contract_items(contract_id,item_name,generic_item_id,is_active) VALUES($1,'Original product',$2,true)",
      [ct.id, x.generic.id],
    );
    await allocate(x, "4", { source_kind: "CONTRACT", contract_id: ct.id });
    await client.query("UPDATE contracts SET institute_id=802 WHERE id=$1", [
      ct.id,
    ]);
    await deny(() =>
      allocate(x, "1", { source_kind: "CONTRACT", contract_id: ct.id }),
    );
  });
  await test("approved transfer checks source identity, capacity and institute scope", async () => {
    const x = await fresh(),
      t = await one(
        "INSERT INTO warehouse_transfer_requests(origin_warehouse_id,destination_warehouse_id,status) VALUES(813,811,'Approved') RETURNING *",
      ),
      l = await one(
        "INSERT INTO warehouse_transfer_items(transfer_id,stock_item_id,item_name,quantity) VALUES($1,$2,'SCOP transfer',3) RETURNING *",
        [t.id, x.stock.id],
      );
    await allocate(x, "3", {
      source_kind: "TRANSFER",
      warehouse_id: 811,
      transfer_id: t.id,
      transfer_line_id: l.id,
    });
    await deny(() =>
      allocate(x, "1", {
        source_kind: "TRANSFER",
        warehouse_id: 811,
        transfer_id: t.id,
        transfer_line_id: l.id,
      }),
    );
    await client.query(
      "UPDATE warehouse_transfer_requests SET origin_warehouse_id=812 WHERE id=$1",
      [t.id],
    );
    await deny(
      () =>
        allocate(x, "1", {
          source_kind: "TRANSFER",
          warehouse_id: 811,
          transfer_id: t.id,
          transfer_line_id: l.id,
        }),
      "SCOP_TRANSFER_SCOPE",
    );
  });
  await test("audit failure rolls back both business change and command identity", async () => {
    const x = await fresh(),
      before = await one(
        "SELECT count(*)::int n FROM scop_allocation_commands",
      );
    await client.query(
      "CREATE FUNCTION scop_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'request.scop.%' THEN RAISE EXCEPTION 'SCOP audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER scop_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION scop_test_audit_failure()",
    );
    try {
      await deny(() => allocate(x));
      assert.equal((await read(x)).allocations.length, 0);
      assert.equal(
        (await one("SELECT count(*)::int n FROM scop_allocation_commands")).n,
        before.n,
      );
    } finally {
      await client.query(
        "DROP TRIGGER scop_test_audit_failure ON audit_logs; DROP FUNCTION scop_test_audit_failure()",
      );
    }
  });
  await test("purchase evidence alone cannot fulfill or close", async () => {
    const x = await fresh(),
      a = await allocate(x),
      next = await bind(x, a, "PO_LINE", x.po.line.id);
    assert.equal((await facts(x, a)).ordered_quantity, "10.000000");
    assert.equal((await facts(x, a)).fulfilled_quantity, "0.000000");
    await deny(() => act(x, next, "close"), "SCOP_CLOSURE_BLOCKED");
  });
  await test("canonical partial receipt, technical acceptance and rejection count once", async () => {
    const x = await fresh(),
      a = await allocate(x);
    let next = await bind(x, a, "PO_LINE", x.po.line.id);
    const gr = await c.receive(x, "6");
    await c.apply(await c.authorize(await c.receiptTask(gr), "4", "1"));
    next = await bind(x, next, "RECEIPT_LINE", gr.receipt.items[0].id);
    const q = await facts(x, a);
    assert.equal(q.received_quantity, "6.000000");
    assert.equal(q.accepted_quantity, "4.000000");
    assert.equal(q.rejected_quantity, "1.000000");
    assert.equal(q.pending_inspection_quantity, "1.000000");
    assert.equal(q.outstanding_quantity, "10.000000");
    await deny(() => bind(x, next, "RECEIPT_LINE", gr.receipt.items[0].id));
    await deny(() => act(x, next, "cancel"), "SCOP_EXECUTION_EXISTS");
  });
  await test("pending inspection and quarantine cannot become accepted progress", async () => {
    const x = await fresh(),
      a = await allocate(x);
    let next = await bind(x, a, "PO_LINE", x.po.line.id);
    const gr = await c.receive(x, "10", { quarantine: true });
    next = await bind(x, next, "RECEIPT_LINE", gr.receipt.items[0].id);
    assert.equal((await facts(x, a)).pending_inspection_quantity, "10.000000");
    await c.apply(await c.authorize(await c.receiptTask(gr), "10", "0"));
    assert.equal((await facts(x, a)).accepted_quantity, "0.000000");
    assert.equal((await facts(x, a)).quarantined_quantity, "10.000000");
  });
  await test("multiple receipts and subsequent issue permit overlay closure only", async () => {
    const x = await fresh(),
      a = await allocate(x);
    let next = await bind(x, a, "PO_LINE", x.po.line.id);
    for (const q of ["4", "6"]) {
      const gr = await c.receive(x, q);
      await c.apply(await c.authorize(await c.receiptTask(gr), q, "0"));
      next = await bind(x, next, "RECEIPT_LINE", gr.receipt.items[0].id);
    }
    assert.equal((await facts(x, a)).accepted_quantity, "10.000000");
    await c.issue(x, "10");
    const w = await one(
      "SELECT si.id FROM warehouse_supplied_items si JOIN warehouse_supply_items wi ON wi.id=si.item_id WHERE wi.requested_item_id=$1 ORDER BY si.id DESC LIMIT 1",
      [x.item.id],
    );
    next = await bind(x, next, "SUPPLY_LINE", w.id);
    assert.equal((await facts(x, a)).outstanding_quantity, "0.000000");
    assert.equal((await act(x, next, "close")).status, "CLOSED");
    assert.equal(
      (await one("SELECT status FROM requests WHERE id=$1", [x.request.id]))
        .status,
      "Approved",
    );
  });
  await test("foreign PO and over-capacity evidence cannot bind", async () => {
    const x = await fresh(),
      y = await c.make(),
      a = await allocate(x, "4");
    await deny(
      () => bind(x, a, "PO_LINE", y.po.line.id),
      "SCOP_REFERENCE_NOT_FOUND",
    );
    await deny(
      () => bind(x, a, "PO_LINE", x.po.line.id),
      "SCOP_EVIDENCE_CONFLICT",
    );
  });
  await test("standalone warehouse items enroll, diverted demand cannot enroll twice", async () => {
    const r = await one(
        "INSERT INTO requests(request_type,requester_id,department_id,institute_id,status,supply_warehouse_id) VALUES('Warehouse Supply',9701,801,801,'Approved',811) RETURNING *",
      ),
      w = await one(
        "INSERT INTO warehouse_supply_items(request_id,item_name,quantity,approval_status) VALUES($1,'Native warehouse demand',10,'Approved') RETURNING *",
        [r.id],
      );
    const p = {
      requestId: String(r.id),
      itemKind: "warehouse_supply_item",
      itemId: String(w.id),
    };
    await cmd(p, "classify", {
      category_id: 9701,
      purpose_code: "ROUTINE",
      policy_code: "STANDARD",
    });
    await cmd(
      p,
      "create",
      source("10", { source_kind: "WAREHOUSE_STOCK", warehouse_id: 811 }),
    );
    const diverted = await one(
      "INSERT INTO warehouse_supply_items(request_id,requested_item_id,item_name,quantity) VALUES($1,$2,'Diverted',1) RETURNING *",
      [r.id, root.item.id],
    );
    await deny(
      () =>
        cmd({ ...p, itemId: String(diverted.id) }, "classify", {
          category_id: 9701,
          purpose_code: "ROUTINE",
          policy_code: "STANDARD",
        }),
      "SCOP_USE_ORIGINAL_ITEM",
    );
  });
  await test("request cancellation and reduced approval ceiling block new execution", async () => {
    const x = await fresh(),
      a = await allocate(x);
    await client.query("UPDATE requests SET status='Cancelled' WHERE id=$1", [
      x.request.id,
    ]);
    await deny(() => bind(x, a, "PO_LINE", x.po.line.id));
    await act(x, a, "cancel");
    const y = await fresh();
    await allocate(y, "6");
    await client.query("UPDATE requested_items SET quantity=5 WHERE id=$1", [
      y.item.id,
    ]);
    await deny(() => allocate(y, "1"), "SCOP_APPROVAL_CHANGED");
    assert.equal((await read(y)).approval_changed, true);
  });
  await test("new tables deny browser access and preserve evidence history", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${role}`);
        await deny(() =>
          client.query("SELECT * FROM scop_fulfillment_allocations"),
        );
      } finally {
        await client.query("ROLLBACK");
      }
    }
    await deny(() => client.query("DELETE FROM scop_allocation_evidence"));
    await deny(() => client.query("DELETE FROM scop_requirement_profiles"));
  });
  await test("finance amounts need existing finance read authority", async () => {
    const x = await fresh();
    assert.equal((await read(x)).financial_settlement.state, "RESTRICTED");
    await client.query(
      "INSERT INTO user_permissions(user_id,permission_id) SELECT 9701,id FROM permissions WHERE code='procure-to-pay.lifecycle.view'",
    );
    assert.equal((await read(x)).financial_settlement.state, "NOT_POSTED");
  });
  await test("approval-route or item identity changes require reconciliation", async () => {
    const x = await fresh();
    await client.query(
      "UPDATE requested_items SET stocking_policy='stock' WHERE id=$1",
      [x.item.id],
    );
    await deny(() => allocate(x), "SCOP_APPROVAL_CHANGED");
    assert.equal((await read(x)).approval_changed, true);
  });
  await test("direct physical receipt fulfills independently of warehouse issue and cannot be counted twice", async () => {
    const x = await fresh({ inventory: false, required: false }),
      a = await allocate(x);
    let next = await bind(x, a, "PO_LINE", x.po.line.id);
    const gr = await c.receive(x, "10");
    next = await bind(x, next, "RECEIPT_LINE", gr.receipt.items[0].id);
    const q = await facts(x, a);
    assert.equal(q.fulfilled_quantity, "10.000000");
    assert.equal(q.issued_quantity, "0.000000");
    assert.equal((await act(x, next, "close")).status, "CLOSED");
    assert.equal(
      (await read(x)).canonical_completion.fulfillment_complete,
      true,
    );
  });
  await test("restricted backend role can append and transition allocations without history rewrite authority", async () => {
    const x = await fresh(),
      p = (await read(x)).profile;
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE purchase_backend");
      const inserted = await one(
        "INSERT INTO scop_fulfillment_allocations(profile_id,source_kind,responsible_user_id,quantity,reason,created_by) VALUES($1,'CENTRAL_SUPPLY',9701,1,'Restricted runtime role',9701) RETURNING *",
        [p.id],
      );
      await client.query(
        "UPDATE scop_fulfillment_allocations SET status='CANCELLED',revision=revision+1 WHERE id=$1",
        [inserted.id],
      );
      await client.query("SAVEPOINT denied_history");
      await deny(() =>
        client.query(
          "UPDATE scop_requirement_profiles SET purpose_code=purpose_code WHERE id=$1",
          [p.id],
        ),
      );
      await client.query("ROLLBACK TO SAVEPOINT denied_history");
    } finally {
      await client.query("ROLLBACK");
    }
  });
  await test("two partial stock issues against one warehouse requirement attribute 4 and 6 exactly once", async () => {
    const stock = await c.make();
    const gr = await c.receive(stock, "10");
    await c.apply(await c.authorize(await c.receiptTask(gr), "10", "0"));
    const r = await one(
      "INSERT INTO requests(request_type,requester_id,department_id,institute_id,status,supply_warehouse_id) VALUES('Warehouse Supply',9701,801,801,'Approved',811) RETURNING *",
    );
    const wi = await one(
      "INSERT INTO warehouse_supply_items(request_id,item_name,quantity,approval_status) VALUES($1,$2,10,'Approved') RETURNING *",
      [r.id, stock.item.item_name],
    );
    const p = {
      requestId: String(r.id),
      itemKind: "warehouse_supply_item",
      itemId: String(wi.id),
    };
    await cmd(p, "classify", {
      category_id: 9701,
      purpose_code: "ROUTINE",
      policy_code: "STANDARD",
    });
    const a4 = await cmd(
        p,
        "create",
        source("4", { source_kind: "WAREHOUSE_STOCK", warehouse_id: 811 }),
      ),
      a6 = await cmd(
        p,
        "create",
        source("6", { source_kind: "WAREHOUSE_STOCK", warehouse_id: 811 }),
      );
    const issuer = await require("../services/p2pAuthorization").loadActor(
      client,
      actor,
      "warehouse.manage-supply",
    );
    const supply = async (q) => {
      const si = await one(
        "INSERT INTO warehouse_supplied_items(request_id,item_id,supplied_quantity,supplied_by) VALUES($1,$2,$3,9701) RETURNING *",
        [r.id, wi.id, q],
      );
      await require("../services/inventoryPostingService").postMovement({
        movementType: "ISSUE",
        inventoryItemId: stock.stock.id,
        warehouseId: 811,
        instituteId: 801,
        departmentId: 801,
        quantity: q,
        baseUom: "EA",
        stockStatus: "AVAILABLE",
        sourceDocumentType: "warehouse_supply",
        sourceDocumentId: r.id,
        sourceDocumentLineId: si.id,
        actor: issuer,
        idempotencyKey: key(),
      });
      return si;
    };
    const si4 = await supply("4"),
      si6 = await supply("6");
    const attach = (a, si) =>
      cmd({ ...p, allocationId: String(a.id) }, "evidence", {
        expected_revision: a.revision,
        kind: "SUPPLY_LINE",
        source_id: String(si.id),
        reason: "Attribute actual partial issue",
      });
    await attach(a4, si4);
    await deny(() => attach(a6, si4));
    await attach(a6, si6);
    const v = await s.get(actor, p);
    assert.equal(v.totals.issued_quantity, "10.000000");
    assert.equal(v.totals.outstanding_quantity, "0.000000");
    assert.equal(v.allocations[0].progress.issued_quantity, "4.000000");
    assert.equal(v.allocations[1].progress.issued_quantity, "6.000000");
    assert.equal(
      require("../policies/scopFoundationPolicy").decimal(
        (await one("SELECT canonical_supply_quantity($1,801) q", [wi.id])).q,
      ),
      "10.000000",
    );
  });
  console.log(`SCOP foundation PostgreSQL scenarios passed: ${passed}`);
}
module.exports = { capture, run };
