"use strict";
const assert = require("node:assert/strict");
async function run({
  client,
  pool,
  make,
  makePo,
  receive,
  receiptTask,
  authorize,
  apply,
  issue,
  snapshot,
}) {
  const reports = require("../services/procurementReportingService");
  const grants = [
    "dashboard.view",
    "requests.view-all",
    "requests.view-incomplete",
    "requests.view",
    "warehouse.view-supply",
    "procurement-performance.view",
  ];
  const actor = {
    id: 804,
    institute_id: 801,
    department_id: 803,
    warehouse_id: 811,
    permissions: grants,
    hasPermission: (p) => grants.includes(p),
  };
  const one = async (q, p = []) => (await client.query(q, p)).rows[0];
  let passed = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS reporting ${name}`);
    passed++;
  };
  const row = async (c) =>
    (await reports.list(actor, { request_id: c.request.id }, client)).data[0];
  const accepted = async (c, q = "10", options = {}) => {
    const g = await receive(c, q, options);
    await apply(await authorize(await receiptTask(g), q, "0"));
    return g;
  };
  const full = await make();
  await accepted(full);
  await issue(full, "10");
  const partial = await make();
  await accepted(partial);
  await issue(partial, "4");
  const ordered = await make();
  const pending = await make();
  await receive(pending, "10");
  const rejected = await make();
  const rg = await receive(rejected, "10");
  await apply(await authorize(await receiptTask(rg), "0", "10"));
  const quarantine = await make();
  await accepted(quarantine, "10", { quarantine: true });
  await test("fully fulfilled request uses accepted stock and actual issue", async () => {
    assert.equal((await row(full)).completion_category, "fully_fulfilled");
    assert.equal((await row(full)).completion.fulfillment_complete, true);
  });
  await test("partial fulfillment is independent from full accepted receiving", async () => {
    const r = await row(partial);
    assert.equal(r.completion_category, "partially_fulfilled");
    assert.equal(r.completion.receipt_complete, true);
    assert.equal(r.completion.items[0].fulfilled_quantity, "4");
  });
  await test("fully ordered but undelivered request awaits delivery", async () => {
    assert.equal((await row(ordered)).completion_category, "awaiting_delivery");
    assert.equal((await row(ordered)).completion.fulfillment_complete, false);
  });
  await test("received header pending technical inspection remains unaccepted", async () => {
    const r = await row(pending);
    assert.equal(r.completion_category, "awaiting_technical_acceptance");
    assert.equal(r.completion.items[0].accepted_quantity, "0");
  });
  await test("rejected receipt never contributes accepted delivery", async () => {
    assert.equal(
      (await row(rejected)).completion.items[0].accepted_quantity,
      "0",
    );
    assert.equal((await row(rejected)).completion.receipt_complete, false);
  });
  await test("technically accepted quarantined stock is not available accepted delivery", async () => {
    const r = await row(quarantine);
    assert.equal(r.completion.items[0].technically_accepted_quantity, "10");
    assert.equal(r.completion.items[0].accepted_quantity, "0");
    assert.equal(r.completion.receipt_complete, false);
  });
  await test("multiple POs and multiple receipts aggregate without duplicate request counts", async () => {
    const c = await make({ poQuantity: "5" }),
      po = await makePo(c, "5");
    await accepted(c, "5");
    await accepted(c, "5", { po });
    const r = await row(c);
    assert.equal(r.completion.items[0].accepted_quantity, "10");
    const s = await reports.summary(
      actor,
      { request_id: c.request.id },
      client,
    );
    assert.equal(s.total_requests, 1);
    assert.equal(s.receipt_complete_requests, 1);
    assert.equal(s.fulfilled_requests, 0);
  });
  const stock = await make();
  const seed = await make();
  await accepted(seed);
  await client.query(
    "DELETE FROM purchase_order_items WHERE purchase_order_id=$1",
    [stock.po.id],
  );
  await client.query("DELETE FROM purchase_orders WHERE id=$1", [stock.po.id]);
  await client.query(
    "UPDATE requested_items SET generic_item_id=$1,procurement_status='available_in_stock' WHERE id=$2",
    [seed.generic.id, stock.item.id],
  );
  stock.stock = seed.stock;
  stock.generic = seed.generic;
  await test("stock-ready demand is not fulfilled until actual issue and needs no PO", async () => {
    assert.equal(
      (await row(stock)).completion_category,
      "awaiting_fulfillment",
    );
    await issue(stock, "10");
    const r = await row(stock);
    assert.equal(r.completion.fulfillment_complete, true);
    assert.equal(r.completion.procurement_complete, true);
    assert.equal(r.completion.items[0].ordered_quantity, "0");
  });
  await test("mixed stock and purchased lines remain partial until every line is fulfilled", async () => {
    const c = await make({ inventory: false });
    await receive(c, "10");
    const item = await one(
      "INSERT INTO requested_items(request_id,item_name,quantity,unit_of_measure,approval_status,procurement_status,generic_item_id) VALUES($1,'Stock balance',2,'EA','Approved','available_in_stock',$2) RETURNING *",
      [c.request.id, partial.generic.id],
    );
    const before = await row(c);
    assert.equal(before.completion.fulfillment_complete, false);
    assert.equal(before.completion.partially_fulfilled, true);
    await issue({ ...c, item, stock: partial.stock }, "2");
    assert.equal((await row(c)).completion.fulfillment_complete, true);
  });
  const cancelled = await make();
  await client.query("UPDATE requests SET status='Cancelled' WHERE id=$1", [
    cancelled.request.id,
  ]);
  await test("cancelled and rejected demand are disclosed but excluded from KPI denominator", async () => {
    for (const status of ["Cancelled", "Rejected"]) {
      await client.query("UPDATE requests SET status=$1 WHERE id=$2", [
        status,
        cancelled.request.id,
      ]);
      const s = await reports.summary(
        actor,
        { request_id: cancelled.request.id },
        client,
      );
      assert.equal(s.eligible_requests, 0);
      assert.equal(s.fulfilled_requests, 0);
      assert.equal(s.fulfillment_rate, null);
      assert.equal(s.excluded_terminal_requests, 1);
      assert.equal(
        (await row(cancelled)).completion_category,
        "cancelled_rejected",
      );
    }
  });
  const foreign = await one(
    "INSERT INTO requests(request_type,requester_id,department_id,institute_id,status) VALUES('Stock',806,804,802,'Approved') RETURNING *",
  );
  await test("foreign institutes require explicit server-side cross-institute authority", async () => {
    const scoped = { ...actor, data_scopes: { institute_ids: [802] } };
    assert.equal(
      (await reports.list(scoped, { request_id: foreign.id }, client)).total,
      0,
    );
    const cross = {
      ...scoped,
      hasPermission: (p) =>
        p === "requests.cross-institute" || actor.hasPermission(p),
    };
    assert.equal(
      (await reports.list(cross, { request_id: foreign.id }, client)).total,
      1,
    );
  });
  await test("department scope intersects filters and actual institute ownership", async () => {
    const u = {
      id: 805,
      institute_id: 801,
      department_id: 802,
      permissions: ["requests.view"],
      hasPermission: (p) => p === "requests.view",
    };
    const s = await reports.summary(u, { department_id: 801 }, client);
    assert.equal(s.total_requests, 0);
    const allowed = await reports.summary(
      actor,
      { department_id: 801 },
      client,
    );
    assert(allowed.total_requests > 0);
    assert(allowed.departments.every((d) => d.department_id === 801));
  });
  await test("warehouse cohort uses actual owned warehouse and foreign warehouse yields no rows", async () => {
    const s = await reports.summary(actor, { warehouse_id: 811 }, client);
    assert(s.total_requests > 0);
    assert.equal(s.quantity_scope, "whole_request");
    assert.equal(
      (await reports.summary(actor, { warehouse_id: 812 }, client))
        .total_requests,
      0,
    );
  });
  await test("warehouse viewers cannot select another assigned warehouse", async () => {
    const u = {
      id: 801,
      institute_id: 801,
      warehouse_id: 811,
      permissions: ["warehouse.view-supply"],
      hasPermission: (p) => p === "warehouse.view-supply",
    };
    await assert.rejects(() => reports.list(u, { warehouse_id: 812 }, client), {
      statusCode: 403,
    });
  });
  await test("SLA active timing subtracts actual recorded approval holds", async () => {
    const c = await make();
    await client.query(
      "UPDATE requests SET created_at='2026-01-01T00:00:00Z' WHERE id=$1",
      [c.request.id],
    );
    const a = await one(
      "INSERT INTO approvals(request_id,approver_id,status,is_active,updated_at) VALUES($1,802,'On Hold',true,'2026-01-02T00:00:00Z') RETURNING id",
      [c.request.id],
    );
    const r = await row(c);
    assert(Math.abs(Number(r.active_elapsed_seconds) - 86400) < 1);
    const s = await reports.summary(
      actor,
      { request_id: c.request.id },
      client,
    );
    assert.equal(s.completion_cycle_time, null);
    assert.equal(s.timing_basis, "active_time_excluding_approval_holds");
    await client.query("DELETE FROM approvals WHERE id=$1", [a.id]);
  });
  await test("date filters are inclusive UTC creation cohorts and reject invalid dates", async () => {
    await client.query(
      "UPDATE requests SET created_at='2026-02-28T23:59:59.999Z' WHERE id=$1",
      [ordered.request.id],
    );
    assert.equal(
      (
        await reports.list(
          actor,
          {
            request_id: ordered.request.id,
            from_date: "2026-02-28",
            to_date: "2026-02-28",
          },
          client,
        )
      ).total,
      1,
    );
    assert.equal(
      (
        await reports.list(
          actor,
          { request_id: ordered.request.id, from_date: "2026-03-01" },
          client,
        )
      ).total,
      0,
    );
    await assert.rejects(
      () => reports.list(actor, { from_date: "2026-02-30" }, client),
      { statusCode: 400 },
    );
    await assert.rejects(
      () =>
        reports.summary(
          actor,
          { from_date: "2026-03-01", to_date: "2026-02-28" },
          client,
        ),
      { statusCode: 400 },
    );
  });
  await test("stable pagination equals unpaginated export source, including empty pages", async () => {
    const all = await reports.list(actor, {}, client, { all: true });
    const ids = [];
    for (let page = 1; ids.length < all.total; page++) {
      const r = await reports.list(actor, { page, limit: 7 }, client);
      assert.equal(r.total, all.total);
      ids.push(...r.data.map((r) => r.id));
    }
    assert.deepEqual(
      ids,
      all.data.map((r) => r.id),
    );
    assert.equal(new Set(ids).size, ids.length);
    const empty = await reports.list(actor, { page: 999, limit: 7 }, client);
    assert.equal(empty.total, all.total);
    assert.deepEqual(empty.data, []);
  });
  await test("canonical export rows include the same flags and no financial amounts", async () => {
    const r = (
      await reports.list(
        actor,
        { request_id: String(partial.request.id) },
        client,
        {
          all: true,
        },
      )
    ).data[0];
    assert.deepEqual(r.completion, (await row(partial)).completion);
    for (const key of [
      "estimated_cost",
      "unit_cost",
      "total_cost",
      "paid_amount",
    ])
      assert.equal(Object.hasOwn(r, key), false);
  });
  await test("incomplete cohort includes ordered undelivered and unaccepted but excludes fulfilled and terminal", async () => {
    const data = (
      await reports.list(actor, { incomplete: true }, client, { all: true })
    ).data;
    const ids = data.map((r) => r.id);
    assert(ids.includes(ordered.request.id));
    assert(ids.includes(pending.request.id));
    assert(!ids.includes(full.request.id));
    assert(!ids.includes(cancelled.request.id));
    assert(
      data.every(
        (r) => !r.completion.terminal && !r.completion.fulfillment_complete,
      ),
    );
  });
  await test("monthly and department totals reconcile to unique filtered request denominator", async () => {
    const s = await reports.summary(actor, {}, client);
    assert.equal(
      s.monthly.reduce((n, m) => n + m.requests, 0),
      s.total_requests,
    );
    assert.equal(
      s.departments.reduce((n, d) => n + d.requests, 0),
      s.total_requests,
    );
    assert.equal(
      Object.values(s.categories).reduce((n, c) => n + c, 0),
      s.total_requests,
    );
    assert(s.fulfilled_requests <= s.eligible_requests);
  });
  await test("historical completed labels remain unchanged and explicitly unverified", async () => {
    const c = await make();
    await client.query("UPDATE requests SET status='Completed' WHERE id=$1", [
      c.request.id,
    ]);
    const before = await snapshot();
    const r = await row(c);
    assert.equal(r.status, "Completed");
    assert.equal(r.completion.fulfillment_complete, false);
    assert.equal(r.completion.legacy_completion_without_fulfillment, true);
    assert.deepEqual(await snapshot(), before);
  });
  await test("dashboard summary, workload, lifecycle and incomplete endpoints share canonical dimensions", async () => {
    const dashboard = require("../controllers/dashboardController"),
      incomplete = require("../controllers/requests/incompleteController");
    const invoke = async (fn, query) => {
      let output;
      const res = {
        json: (v) => {
          output = v;
          return res;
        },
        status: (c) => {
          assert(c < 400, `Unexpected HTTP ${c}`);
          return res;
        },
      };
      await fn({ user: actor, query }, res, (e) => {
        throw e;
      });
      return output;
    };
    const old = pool.query;
    pool.query = client.query.bind(client);
    try {
      const query = { request_id: String(partial.request.id) };
      const expected = await reports.summary(actor, query, client);
      for (const fn of [
        dashboard.getDashboardSummary,
        dashboard.getWorkloadAnalysis,
        dashboard.getLifecycleAnalytics,
      ]) {
        const data = await invoke(fn, query);
        assert.deepEqual(data.completion_report, expected);
      }
      const data = await invoke(incomplete.getAllIncomplete, query);
      assert.equal(data.length, 1);
      assert.deepEqual(data[0].completion, (await row(partial)).completion);
    } finally {
      pool.query = old;
    }
  });
  await test("completion category filtering and raw status filtering remain distinct", async () => {
    const r = await reports.list(
      actor,
      { completion_category: "awaiting_technical_acceptance" },
      client,
    );
    assert(
      r.data.every(
        (x) => x.completion_category === "awaiting_technical_acceptance",
      ),
    );
    await assert.rejects(
      () => reports.list(actor, { completion_category: "PAID" }, client),
      { statusCode: 400 },
    );
  });
  await test("warehouse report reads actual net issue movements and isolates foreign warehouses", async () => {
    const controller = require("../controllers/warehouseInventoryController"),
      old = pool.query;
    const invoke = async (query = {}) => {
      let output;
      await controller.getWeeklyDepartmentStockingReport(
        { user: actor, query },
        {
          json: (v) => {
            output = v;
          },
        },
        (e) => {
          throw e;
        },
      );
      return output;
    };
    pool.query = client.query.bind(client);
    try {
      const before = await snapshot(),
        r = await invoke();
      assert.equal(r.basis, "canonical_net_issue_quantities");
      assert.equal(r.warehouse_id, 811);
      const entries = r.departments.flatMap((d) => d.items);
      assert(
        entries.some(
          (x) => x.stock_item_id === full.stock.id && x.total_quantity === "10",
        ),
      );
      assert(entries.every((x) => x.base_uom));
      assert.deepEqual(await snapshot(), before);
      await assert.rejects(() => invoke({ warehouse_id: 812 }), {
        statusCode: 403,
      });
      const legacy = await invoke({ basis: "historical" });
      assert.equal(legacy.basis, "historical_stock_movement_archive");
    } finally {
      pool.query = old;
    }
  });
  await test("request list, specialist and department records expose the same category", async () => {
    const fetch = require("../controllers/requests/fetchRequestsController"),
      department = require("../controllers/departmentRequestedItemsController"),
      old = pool.query;
    const manager = { ...actor, role: "SCM" };
    const invoke = async (fn, query) => {
      let output;
      const res = {
        json: (v) => {
          output = v;
          return res;
        },
        status: (c) => {
          assert(c < 400);
          return res;
        },
      };
      await fn({ user: manager, query }, res, (e) => {
        throw e;
      });
      return output;
    };
    pool.query = client.query.bind(client);
    try {
      const all = await invoke(fetch.getAllRequests, {
        request_id: String(partial.request.id),
        limit: 250,
      });
      assert.equal(all.data.length, 1);
      assert.deepEqual(all.data[0].completion, (await row(partial)).completion);
      const assigned = await invoke(fetch.getAssignedRequests, {});
      const r = assigned.data.find((x) => x.id === partial.request.id);
      assert(r);
      assert.deepEqual(r.completion, all.data[0].completion);
      const dept = await invoke(department.getDepartmentRequestedItems, {
        department_id: 801,
        include_completed: "true",
        limit: 250,
      });
      const d = dept.data.find((x) => x.request_id === partial.request.id);
      assert(d);
      assert.deepEqual(d.completion, all.data[0].completion);
    } finally {
      pool.query = old;
    }
  });
  await test("CSV endpoint parity and explicit historical export stay scoped", async () => {
    const router = require("../routes/requests"),
      handler = router.stack.find((l) => l.route?.path === "/export/csv").route
        .stack[0].handle,
      old = pool.query;
    const invoke = async (query) => {
      let body;
      const res = {
        header: () => res,
        attachment: () => res,
        send: (v) => {
          body = v;
          return res;
        },
        status: (c) => {
          assert(c < 400);
          return res;
        },
        json: (v) => {
          throw new Error(JSON.stringify(v));
        },
      };
      await handler({ user: actor, query }, res);
      return body;
    };
    pool.query = client.query.bind(client);
    try {
      const csv = await invoke({ request_id: String(partial.request.id) });
      assert(csv.includes("canonical_completion_v1"));
      assert(csv.includes("partially_fulfilled"));
      assert.equal(csv.trim().split("\n").length, 2);
      const foreignCsv = await invoke({ request_id: foreign.id });
      assert.equal(foreignCsv.trim().split("\n").length, 1);
      const historical = await invoke({
        request_id: String(partial.request.id),
        basis: "historical",
      });
      assert.equal(historical.trim().split("\n").length, 2);
    } finally {
      pool.query = old;
    }
  });
  await test("case reporting uses the same eligibility gate and excludes cancelled accepted delivery", async () => {
    const router = require("../routes/procurementPerformance"),
      handler = router.stack.find((l) => l.route?.path === "/dashboard").route
        .stack[0].handle,
      old = pool.query;
    const invoke = async () => {
      let out;
      await handler(
        { user: actor, query: {} },
        {
          json: (v) => {
            out = v;
          },
        },
        (e) => {
          throw e;
        },
      );
      return out;
    };
    pool.query = client.query.bind(client);
    try {
      const before = await invoke();
      const c = await make();
      await accepted(c);
      await client.query("UPDATE requests SET status='Cancelled' WHERE id=$1", [
        c.request.id,
      ]);
      const after = await invoke();
      assert.equal(
        after.metrics.completion.accepted_delivery_cases,
        before.metrics.completion.accepted_delivery_cases,
      );
      assert.equal(after.metrics.completion.unit, "case");
      assert.equal(after.metrics.completion_contract, reports.CONTRACT);
    } finally {
      pool.query = old;
    }
  });
  await test("warehouse issue totals subtract actual compensating reversals without duplicate rows", async () => {
    const c = await make();
    await accepted(c);
    const movement = await issue(c, "3");
    const a = await require("../services/procurementCompletionService").actor(
      client,
      { id: 807 },
    );
    await require("../services/inventoryReversalService").reverseMovement({
      movementId: movement.movement.id,
      actor: a,
      reason: "Reporting compensation evidence",
      idempotencyKey: "phase6c-issue-reversal",
    });
    const controller = require("../controllers/warehouseInventoryController"),
      old = pool.query;
    pool.query = client.query.bind(client);
    try {
      let report;
      const before = await snapshot();
      await controller.getWeeklyDepartmentStockingReport(
        { user: actor, query: {} },
        {
          json: (v) => {
            report = v;
          },
        },
        (e) => {
          throw e;
        },
      );
      assert(
        !report.departments
          .flatMap((d) => d.items)
          .some((x) => x.stock_item_id === c.stock.id),
      );
      assert.deepEqual(await snapshot(), before);
    } finally {
      pool.query = old;
    }
  });
  await test("incomplete-only permission does not grant unrelated fulfilled history", async () => {
    const u = {
      id: 805,
      institute_id: 801,
      department_id: 801,
      permissions: ["requests.view-incomplete"],
      hasPermission: (p) => p === "requests.view-incomplete",
    };
    const data = (await reports.list(u, {}, client, { all: true })).data;
    assert(data.some((r) => r.id === ordered.request.id));
    assert(!data.some((r) => r.id === full.request.id));
    assert(
      data.every(
        (r) => !r.completion.terminal && !r.completion.fulfillment_complete,
      ),
    );
  });
  console.log(`Canonical reporting PostgreSQL scenarios passed: ${passed}`);
}
module.exports = { run };
