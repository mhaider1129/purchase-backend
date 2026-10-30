"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { createDeviceDemoService } = require("../services/deviceDemoService");
const {
  assertReadyForCommand,
} = require("../services/procurementIdentityPolicyService");
const { DEFAULT_CRITERIA } = require("../services/deviceDemoModel");
module.exports = async (client) => {
  assert.equal(client.connectionParameters.host, "127.0.0.1");
  assert.equal(client.connectionParameters.user, "p2p_test");
  const ddl = fs.readFileSync(
    path.join(__dirname, "../sql/manual/050_device_demo_workspaces.sql"),
    "utf8",
  );
  await client.query(ddl);
  await client.query(ddl);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('device_demo_workspaces','device_demo_reviewers','device_demo_candidates','device_demo_reports','device_demo_selections','device_demo_events') AND relrowsecurity",
      )
    ).rows[0].n,
    6,
  );
  await client.query("BEGIN");
  let point = 0,
    failNotification = false;
  const adapter = {
    release: () => {},
    query: async (sql, params) => {
      if (sql === "BEGIN") return client.query(`SAVEPOINT demo_${++point}`);
      if (sql === "COMMIT")
        return client.query(`RELEASE SAVEPOINT demo_${point}`);
      if (sql === "ROLLBACK") {
        await client.query(`ROLLBACK TO SAVEPOINT demo_${point}`);
        return client.query(`RELEASE SAVEPOINT demo_${point}`);
      }
      if (
        failNotification &&
        sql.startsWith("INSERT INTO public.notifications")
      ) {
        failNotification = false;
        throw new Error("Demo notification failure");
      }
      return client.query(sql, params);
    },
  };
  const service = createDeviceDemoService({
    query: adapter.query,
    connect: async () => adapter,
  });
  try {
    const institute = async (name) =>
      (
        await client.query(
          "INSERT INTO public.institutes(id,name) SELECT COALESCE(max(id),0)+100,$1 FROM public.institutes RETURNING id",
          [name],
        )
      ).rows[0].id;
    const inst = await institute("Demo fixture"),
      other = await institute("Other demo fixture");
    const department = async (name, ins = inst) =>
      (
        await client.query(
          "INSERT INTO public.departments(id,name,type,institute_id) SELECT COALESCE(max(id),0)+100,$1,'Medical',$2 FROM public.departments RETURNING id",
          [name, ins],
        )
      ).rows[0].id;
    const requesting = await department("Demo requesting"),
      related = await department("Demo related"),
      foreignDept = await department("Demo foreign", other);
    const user = async (name, role, dept = requesting, ins = inst) => ({
      ...(
        await client.query(
          "INSERT INTO public.users(id,name,email,password,role,department_id,institute_id,is_active) SELECT COALESCE(max(id),0)+100,$1,$2,'test',$3,$4,$5,true FROM public.users RETURNING *",
          [name, name.replaceAll(" ", "") + "@demo.invalid", role, dept, ins],
        )
      ).rows[0],
      hasPermission: (code) => role === "SCM" && code === "requests.manage",
    });
    const scm = await user("Demo SCM", "SCM", related),
      medical = await user("Demo Medical", "Medical Devices", related),
      reviewer = await user("Demo HOD", "HOD"),
      expert = await user("Demo expert", "BME", related),
      coo = await user("Demo COO", "COO", related),
      outsider = await user("Demo outsider", "HOD", related),
      foreign = await user("Demo foreign COO", "COO", foreignDept, other);
    const request = (
      await client.query(
        "INSERT INTO public.requests(request_type,status,requester_id,department_id,institute_id) VALUES('Medical Device','Submitted',$1,$2,$3) RETURNING *",
        [reviewer.id, requesting, inst],
      )
    ).rows[0];
    const item = (
      await client.query(
        "INSERT INTO public.requested_items(request_id,item_name,quantity,specs,unit_of_measure,approval_status,request_mode,catalog_status,restriction_justification) VALUES($1,'Demo ultrasound',1,'Original specification','Piece','Approved','approved_free_text_exception','approved_exception','Approved exception') RETURNING *",
        [request.id],
      )
    ).rows[0];
    await client.query(
      "INSERT INTO public.approvals(request_id,approver_id,approval_level,status,is_active) VALUES($1,$2,3,'Pending',false)",
      [request.id, medical.id],
    );
    const open = {
      request_item_id: item.id,
      title: "Ultrasound company trials",
      objectives: "Assess image quality and workflow",
      reviewer_ids: [reviewer.id, expert.id],
      submission_key: "demo-first",
    };
    await assert.rejects(service.create(medical, open), { statusCode: 409 });
    await client.query(
      "UPDATE public.approvals SET is_active=true WHERE request_id=$1",
      [request.id],
    );
    assert(
      (await service.eligible(medical)).some(
        (row) => String(row.id) === String(item.id),
      ),
    );
    await assert.rejects(service.create(outsider, open), { statusCode: 403 });
    await assert.rejects(
      service.create(medical, { ...open, reviewer_ids: [expert.id] }),
      { statusCode: 400 },
    );
    await client.query(
      "UPDATE public.approvals SET status='On Hold' WHERE request_id=$1",
      [request.id],
    );
    await client.query(
      "UPDATE public.requests SET status='On Hold' WHERE id=$1",
      [request.id],
    );
    let w = await service.create(medical, open);
    assert.equal(w.status, "OPEN");
    assert.equal((await service.create(medical, open)).id, w.id);
    await assert.rejects(
      service.create(medical, { ...open, objectives: "Changed" }),
      { statusCode: 409 },
    );
    await assert.rejects(service.get(outsider, w.id), { statusCode: 404 });
    await assert.rejects(service.get(foreign, w.id), { statusCode: 404 });
    await assert.rejects(
      assertReadyForCommand(adapter, item, scm, "create_award", {
        supplier_id: 1,
      }),
      { code: "DEVICE_DEMO_SELECTION_REQUIRED" },
    );
    await assertReadyForCommand(adapter, item, scm, "start_sourcing");
    await assertReadyForCommand(adapter, item, scm, "submit_quotation");
    const specFile = (
      await client.query(
        "INSERT INTO public.attachments(request_id,file_name,file_path,uploaded_by) VALUES($1,'Device specification.pdf','device-spec-fixture.pdf',$2) RETURNING id",
        [request.id, reviewer.id],
      )
    ).rows[0];
    w = await service.mutate(
      reviewer,
      w.id,
      {
        row_version: w.row_version,
        notes: "Original device specification sheet",
        attachment_ids: [specFile.id],
      },
      "document",
    );
    assert.equal(w.demos.length, 0);
    assert.equal(w.attachments[0].file_name, "Device specification.pdf");
    assert.equal(w.events[0].actor_snapshot.user_id, reviewer.id);
    await assert.rejects(
      service.mutate(
        reviewer,
        w.id,
        { row_version: w.row_version, notes: "No files" },
        "document",
      ),
      { statusCode: 400 },
    );
    await assert.rejects(
      service.mutate(
        coo,
        w.id,
        {
          row_version: w.row_version,
          notes: "Not an evaluator",
          attachment_ids: [specFile.id],
        },
        "document",
      ),
      { statusCode: 403 },
    );
    const supplier = async (name, ins = inst) =>
      (
        await client.query(
          "INSERT INTO public.suppliers(name,status,institute_id) VALUES($1,'active',$2) RETURNING id",
          [name, ins],
        )
      ).rows[0].id;
    const a = await supplier("Demo company A"),
      b = await supplier("Demo company B"),
      f = await supplier("Foreign demo company", other);
    await client.query("SAVEPOINT demo_supplier_directory_fixture");
    const suspended = await supplier("Suspended demo supplier");
    await client.query(
      "UPDATE public.suppliers SET status='suspended' WHERE id=$1",
      [suspended],
    );
    const choices = await service.options(scm, w.id);
    assert(choices.suppliers.some((row) => Number(row.id) === Number(a)));
    assert(choices.suppliers.some((row) => Number(row.id) === Number(b)));
    assert(!choices.suppliers.some((row) => Number(row.id) === Number(f)));
    assert(
      !choices.suppliers.some((row) => Number(row.id) === Number(suspended)),
    );
    assert.deepEqual(choices.catalog, []);
    await assert.rejects(service.options(reviewer, w.id), { statusCode: 403 });
    // Legacy/free-text devices need the supplier directory, not an installed
    // or populated governed product catalogue, to register a loan/demo.
    await client.query(
      "ALTER TABLE public.supplier_catalog_items RENAME TO demo_catalog_unavailable_fixture",
    );
    assert(
      (await service.options(scm, w.id)).suppliers.some(
        (row) => Number(row.id) === Number(a),
      ),
    );
    await client.query("ALTER TABLE public.suppliers DROP COLUMN institute_id");
    await assert.rejects(
      service.options(scm, w.id),
      (err) =>
        err.code === "DEVICE_DEMO_SUPPLIER_SCHEMA_REQUIRED" &&
        err.message.includes("SQL 052"),
    );
    await assert.rejects(
      service.mutate(
        scm,
        w.id,
        {
          row_version: w.row_version,
          notes: "Register supplier demo",
          supplier_id: a,
        },
        "candidate",
      ),
      { code: "DEVICE_DEMO_SUPPLIER_SCHEMA_REQUIRED" },
    );
    const repair = fs
      .readFileSync(
        path.join(
          __dirname,
          "../sql/manual/052_surgical_consignment_supplier_scope_compatibility.sql",
        ),
        "utf8",
      )
      .replace(/^BEGIN;$/m, "")
      .replace(/^COMMIT;$/m, "");
    await client.query(repair);
    assert(
      (await service.options(scm, w.id)).suppliers.some(
        (row) => Number(row.id) === Number(a),
      ),
    );
    await client.query("ROLLBACK TO SAVEPOINT demo_supplier_directory_fixture");
    console.log(
      "Device demo supplier directory: canonical supplier IDs, tenant/status/role exclusions, no catalogue dependency for free text, named legacy-scope error and SQL 052 recovery PASS",
    );
    const candidate = (supplierId) => ({
      row_version: w.row_version,
      notes: "Register loan demo",
      supplier_id: supplierId,
      manufacturer: "Manufacturer",
      model: `Model ${supplierId}`,
      planned_start: "2026-10-29",
      planned_end: "2026-11-10",
      location: "Requesting department",
      description: "Configured test unit",
    });
    await assert.rejects(
      service.mutate(medical, w.id, candidate(f), "candidate"),
      { statusCode: 400 },
    );
    w = await service.mutate(medical, w.id, candidate(a), "candidate");
    w = await service.mutate(medical, w.id, candidate(b), "candidate");
    assert.equal(w.demos.length, 2);
    const mutate = async (actor, operation, fields = {}) => {
      w = await service.mutate(
        actor,
        w.id,
        {
          row_version: w.row_version,
          notes: "Documented demo action",
          ...fields,
        },
        operation,
      );
      return w;
    };
    await assert.rejects(
      service.mutate(
        medical,
        w.id,
        {
          row_version: w.row_version - 1,
          notes: "Stale",
          demo_id: w.demos[0].id,
          status: "RECEIVED",
        },
        "transition",
      ),
      { code: "DEVICE_DEMO_VERSION_CONFLICT" },
    );
    await assert.rejects(
      mutate(medical, "transition", {
        demo_id: w.demos[0].id,
        status: "COMPLETED",
      }),
      { statusCode: 409 },
    );
    for (const demo of w.demos)
      for (const status of ["RECEIVED", "EVALUATING", "COMPLETED"])
        await mutate(medical, "transition", { demo_id: demo.id, status });
    await assert.rejects(mutate(scm, "recommend", { demo_id: w.demos[0].id }), {
      statusCode: 409,
    });
    const report = (score) => ({
      recommendation: "SUITABLE",
      findings: "Trial confirmed performance",
      safety_findings: "No safety issues observed",
      scores: DEFAULT_CRITERIA.map((c) => ({
        key: c.key,
        score,
        comment: "Observed evidence",
      })),
      signature: { name: "Forged" },
      weighted_score: 100,
    });
    for (const demo of w.demos) {
      await mutate(reviewer, "opinion", {
        demo_id: demo.id,
        ...report(String(demo.supplier_id) === String(a) ? 4 : 3),
      });
      await mutate(expert, "opinion", { demo_id: demo.id, ...report(4) });
    }
    assert(w.reports.every((r) => r.signature.name !== "Forged"));
    assert.equal(Number(w.reports[0].weighted_score), 80);
    await assert.rejects(
      mutate(reviewer, "opinion", { demo_id: w.demos[0].id, ...report(5) }),
      { statusCode: 409 },
    );
    await assert.rejects(
      mutate(reviewer, "observation", {
        demo_id: w.demos[0].id,
        attachment_ids: [2147483000],
      }),
      { statusCode: 400 },
    );
    const attachment = (
      await client.query(
        "INSERT INTO public.attachments(request_id,file_name,file_path,uploaded_by) VALUES($1,'Demo evidence.pdf','local-demo-fixture.pdf',$2) RETURNING id",
        [request.id, reviewer.id],
      )
    ).rows[0];
    await mutate(reviewer, "observation", {
      demo_id: w.demos[0].id,
      attachment_ids: [attachment.id],
      notes: "Evidence from the completed trial",
    });
    assert(
      w.attachments.some((file) => file.file_name === "Demo evidence.pdf"),
    );
    const primary = w.demos[0].id;
    await mutate(scm, "recommend", {
      demo_id: primary,
      notes: "Company A best meets workflow and imaging requirements",
    });
    assert.equal(w.status, "COO_REVIEW");
    assert.equal(w.selections[0].comparison_snapshot.length, 2);
    await assert.rejects(mutate(scm, "candidate", candidate(a)), {
      statusCode: 409,
    });
    await assert.rejects(mutate(scm, "decision", { decision: "APPROVED" }), {
      statusCode: 403,
    });
    await mutate(coo, "decision", {
      decision: "REJECTED",
      notes: "Explain support differences",
    });
    assert.equal(w.status, "REVISION_REQUIRED");
    assert.equal(w.reports.length, 4);
    await mutate(scm, "recommend", {
      demo_id: primary,
      notes: "Comparative support and usability assessment",
    });
    await mutate(coo, "decision", {
      decision: "APPROVED",
      notes: "Approve recommended company and device",
    });
    assert.equal(w.status, "SELECTED");
    assert.equal(w.selections[0].signature.user_id, coo.id);
    await assert.rejects(
      assertReadyForCommand(adapter, item, scm, "register_procurement", {
        supplier_id: a,
      }),
      { code: "DEVICE_DEMO_REQUEST_NOT_APPROVED" },
    );
    await client.query(
      "UPDATE public.requests SET status='Approved' WHERE id=$1",
      [request.id],
    );
    for (const command of [
      "create_award",
      "create_purchase_order",
      "register_procurement",
    ]) {
      await assert.rejects(
        assertReadyForCommand(adapter, item, scm, command, { supplier_id: b }),
        { code: "DEVICE_DEMO_SUPPLIER_MISMATCH" },
      );
      await assertReadyForCommand(adapter, item, scm, command, {
        supplier_id: a,
      });
    }
    await assert.rejects(
      assertReadyForCommand(adapter, item, scm, "register_procurement"),
      { code: "DEVICE_DEMO_SUPPLIER_MISMATCH" },
    );
    for (const state of ["Rejected", "Available in Stock"]) {
      await client.query(
        "UPDATE public.requested_items SET approval_status=$1 WHERE id=$2",
        [state, item.id],
      );
      await assert.rejects(
        assertReadyForCommand(adapter, item, scm, "create_award", {
          supplier_id: a,
        }),
        { code: "DEVICE_DEMO_STALE" },
      );
    }
    await client.query(
      "UPDATE public.requested_items SET approval_status='Approved' WHERE id=$1",
      [item.id],
    );
    await mutate(scm, "return", {
      demo_id: primary,
      notes: "Loan device returned to company",
    });
    assert(w.demos.find((d) => String(d.id) === String(primary)).returned_at);
    await client.query(
      "UPDATE public.requested_items SET specs='Changed specification' WHERE id=$1",
      [item.id],
    );
    await assert.rejects(
      assertReadyForCommand(adapter, item, scm, "create_award", {
        supplier_id: a,
      }),
      { code: "DEVICE_DEMO_STALE" },
    );
    await client.query(
      "UPDATE public.requested_items SET specs='Original specification' WHERE id=$1",
      [item.id],
    );
    await mutate(scm, "cancel", {
      notes: "Restart trial with revised requirements",
    });
    await assert.rejects(
      assertReadyForCommand(adapter, item, scm, "create_award", {
        supplier_id: a,
      }),
      { code: "DEVICE_DEMO_SELECTION_REQUIRED" },
    );
    await assert.rejects(
      service.mutate(
        scm,
        w.id,
        {
          row_version: w.row_version,
          notes: "Cancelled workspace cannot accept files",
          attachment_ids: [specFile.id],
        },
        "document",
      ),
      { statusCode: 403 },
    );
    const before = (
      await client.query(
        "SELECT count(*)::int AS n FROM public.device_demo_workspaces",
      )
    ).rows[0].n;
    await client.query(
      "INSERT INTO public.requested_item_financials(requested_item_id,request_id,committed_cost) VALUES($1,$2,10)",
      [item.id, request.id],
    );
    await assert.rejects(
      service.create(scm, {
        ...open,
        submission_key: "demo-already-committed",
      }),
      { statusCode: 409 },
    );
    await client.query(
      "DELETE FROM public.requested_item_financials WHERE requested_item_id=$1",
      [item.id],
    );
    failNotification = true;
    await assert.rejects(
      service.create(scm, { ...open, submission_key: "demo-rollback" }),
      /Demo notification failure/,
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM public.device_demo_workspaces",
        )
      ).rows[0].n,
      before,
    );
    assert.equal(
      (
        await client.query(
          "SELECT purchased_quantity FROM public.requested_items WHERE id=$1",
          [item.id],
        )
      ).rows[0].purchased_quantity,
      0,
    );
    const history = JSON.stringify(
      (
        await client.query(
          "SELECT * FROM public.device_demo_selections ORDER BY id",
        )
      ).rows,
    );
    await client.query(ddl.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""));
    assert.equal(
      JSON.stringify(
        (
          await client.query(
            "SELECT * FROM public.device_demo_selections ORDER BY id",
          )
        ).rows,
      ),
      history,
    );
    console.log(
      "SQL 050 device demos: stage initiation, multi-company trials, signed reports, COO rejection/resubmission/approval, supplier gates, stale requirements, custody return, scope, rollback and repeat preservation PASS",
    );
  } finally {
    await client.query("ROLLBACK");
  }
};
