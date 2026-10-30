"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createTechnicalReviewService,
} = require("../services/preprocurementTechnicalReviewService");
const {
  assertReadyForCommand,
} = require("../services/procurementIdentityPolicyService");
const { CHECKLIST } = require("../services/preprocurementTechnicalReviewModel");
module.exports = async (client) => {
  assert.equal(client.connectionParameters.host, "127.0.0.1");
  assert.equal(client.connectionParameters.user, "p2p_test");
  const patch = fs.readFileSync(
    path.join(
      __dirname,
      "../sql/manual/049_preprocurement_technical_reviews.sql",
    ),
    "utf8",
  );
  await client.query(patch);
  await client.query(patch);
  const protectedTables = (
    await client.query(
      "SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('public.preprocurement_technical_reviews'::regclass,'public.preprocurement_technical_review_assignments'::regclass,'public.preprocurement_technical_review_policy'::regclass)",
    )
  ).rows;
  assert.equal(protectedTables.length, 3);
  assert(protectedTables.every((row) => row.relrowsecurity));
  await client.query("BEGIN");
  let savepoint = 0,
    failNotification = false;
  const adapter = {
    release: () => {},
    query: async (sql, params) => {
      if (sql === "BEGIN") {
        savepoint++;
        return client.query(`SAVEPOINT technical_service_${savepoint}`);
      }
      if (sql === "COMMIT")
        return client.query(`RELEASE SAVEPOINT technical_service_${savepoint}`);
      if (sql === "ROLLBACK") {
        await client.query(
          `ROLLBACK TO SAVEPOINT technical_service_${savepoint}`,
        );
        return client.query(`RELEASE SAVEPOINT technical_service_${savepoint}`);
      }
      if (
        failNotification &&
        sql.startsWith("INSERT INTO public.notifications")
      ) {
        failNotification = false;
        throw new Error("Injected notification failure");
      }
      return client.query(sql, params);
    },
  };
  const database = { query: adapter.query, connect: async () => adapter },
    service = createTechnicalReviewService(database);
  try {
    const inst = (
      await client.query(
        "INSERT INTO public.institutes(id,name) SELECT COALESCE(max(id),0)+100,'Technical workflow fixture' FROM public.institutes RETURNING id",
      )
    ).rows[0].id;
    const other = (
      await client.query(
        "INSERT INTO public.institutes(id,name) SELECT COALESCE(max(id),0)+100,'Other technical fixture' FROM public.institutes RETURNING id",
      )
    ).rows[0].id;
    const dept = async (name, institute = inst) =>
      (
        await client.query(
          "INSERT INTO public.departments(id,name,type,institute_id) SELECT COALESCE(max(id),0)+100,$1,'Operational',$2 FROM public.departments RETURNING id",
          [name, institute],
        )
      ).rows[0].id;
    const requesting = await dept("Requesting fixture"),
      related = await dept("Related fixture"),
      foreignDept = await dept("Foreign fixture", other);
    const user = async (name, role, department, institute = inst) => {
      const row = (
        await client.query(
          "INSERT INTO public.users(id,name,email,password,role,department_id,institute_id,is_active) SELECT COALESCE(max(id),0)+100,$1,$2,'local-test-hash',$3,$4,$5,true FROM public.users RETURNING *",
          [
            name,
            `${name.replaceAll(" ", "")}@technical.invalid`,
            role,
            department,
            institute,
          ],
        )
      ).rows[0];
      return {
        ...row,
        hasPermission: (permission) =>
          role === "SCM" && permission === "technical-inspections.manage",
      };
    };
    const manager = await user("SCM fixture", "SCM", related),
      hod = await user("HOD fixture", "HOD", requesting),
      expert = await user("Expert fixture", "Technician", related),
      outsider = await user("Unassigned fixture", "HOD", related),
      foreign = await user("Foreign SCM fixture", "SCM", foreignDept, other);
    const makeRequest = async () => {
      const request = (
        await client.query(
          "INSERT INTO public.requests(request_type,status,requester_id,department_id,institute_id) VALUES('Stock','Approved',$1,$2,$3) RETURNING *",
          [hod.id, requesting, inst],
        )
      ).rows[0];
      const items = [];
      for (const name of ["Chair", "Cable"])
        items.push(
          (
            await client.query(
              "INSERT INTO public.requested_items(request_id,item_name,quantity,specs,unit_of_measure,approval_status,request_mode,catalog_status,restriction_justification) VALUES($1,$2,2,'Specification fixture','Piece','Approved','approved_free_text_exception','approved_exception','Authorized direct use') RETURNING *",
              [request.id, name],
            )
          ).rows[0],
        );
      return { request, items };
    };
    const worklist =
      require("../services/technicalWorklistService").createTechnicalWorklistService(
        database,
      );
    const fixture = await makeRequest();
    const payload = (key) => ({
      request_id: fixture.request.id,
      submission_key: key,
      instructions: "Check all proposed items before procurement",
      reviewer_ids: [hod.id, expert.id],
      items: fixture.items.map((item) => ({
        item_id: item.id,
        evidence: {
          basis: "description",
          category: "Furniture",
          no_sample_reason: "No sample available from supplier",
          evidence_description:
            "Dimensions and performance provided in the requirement",
        },
      })),
    });
    const reports = (review, reject = false) =>
      review.item_packets.map((packet, index) => ({
        item_id: packet.item_id,
        decision: reject && index === 0 ? "REJECTED" : "APPROVED",
        inspection_date: "2026-10-29",
        inspection_time: "09:30",
        overall_condition: "good",
        findings: "Technical opinion from the provided description",
        checklist: Object.fromEntries(
          Object.entries(CHECKLIST).map(([key, options]) => [
            key,
            {
              condition:
                key === "specifications" && reject && index === 0
                  ? "not_met"
                  : options[0],
              comment: "Evidence reviewed",
              action_required: "",
            },
          ]),
        ),
      }));
    const ready = (item = fixture.items[0], command = "register_procurement") =>
      assertReadyForCommand(adapter, item, manager, command);
    await ready(); // Selected-only policy starts with no requirement/history.
    assert.equal((await service.policy(manager)).require_for_all, false);
    await assert.rejects(
      service.create(manager, {
        ...payload("missing-requesting"),
        reviewer_ids: [expert.id],
      }),
      { statusCode: 400 },
    );
    await assert.rejects(service.create(hod, payload("not-scm")), {
      statusCode: 403,
    });
    const otherRequest = await makeRequest();
    const attachment = (
      await client.query(
        "INSERT INTO public.attachments(request_id,file_name,file_path,uploaded_by) VALUES($1,'Fixture data sheet.pdf','fixture-only.pdf',$2) RETURNING id",
        [otherRequest.request.id, manager.id],
      )
    ).rows[0];
    const withDataSheet = payload("wrong-evidence-request");
    withDataSheet.items[0].evidence = {
      ...withDataSheet.items[0].evidence,
      basis: "data_sheet",
      attachment_ids: [attachment.id],
    };
    await assert.rejects(service.create(manager, withDataSheet), {
      statusCode: 400,
    });
    await client.query(
      "UPDATE public.attachments SET request_id=$1 WHERE id=$2",
      [fixture.request.id, attachment.id],
    );
    // The successful round uses a real request attachment, not a supplied file path.
    const firstPayload = payload("first-round");
    firstPayload.items[0].evidence = {
      ...firstPayload.items[0].evidence,
      basis: "data_sheet",
      attachment_ids: [attachment.id],
    };
    let review = await service.create(manager, firstPayload);
    assert.equal(review.attachments[0].file_name, "Fixture data sheet.pdf");
    assert.equal(review.assignments.length, 2);
    assert.equal((await service.create(manager, firstPayload)).id, review.id);
    await assert.rejects(
      service.create(manager, {
        ...payload("first-round"),
        instructions: "Changed payload",
      }),
      { statusCode: 409 },
    );
    await assert.rejects(service.create(manager, payload("duplicate-open")), {
      statusCode: 409,
    });
    await assert.rejects(service.get(outsider, review.id), { statusCode: 404 });
    await assert.rejects(service.get(foreign, review.id), { statusCode: 404 });
    await assert.rejects(
      service.sign(hod, review.id, {
        row_version: review.row_version,
        decision: "APPROVED",
        notes: "Not SCM",
      }),
      { statusCode: 403 },
    );
    for (const command of [
      "create_award",
      "create_purchase_order",
      "register_procurement",
    ])
      await assert.rejects(ready(fixture.items[0], command), {
        code: "TECHNICAL_REVIEW_REQUIRED",
      });
    await ready(fixture.items[0], "start_sourcing");
    await ready(fixture.items[0], "submit_quotation");
    review = await service.opinion(hod, review.id, {
      row_version: review.row_version,
      reports: reports(review),
      signed_by: manager.id,
    });
    const signature = review.assignments.find(
      (row) => row.reviewer_id === hod.id,
    ).signature;
    assert.equal(signature.user_id, hod.id);
    assert.equal(signature.name, hod.name);
    assert(signature.signed_at);
    await assert.rejects(
      service.sign(manager, review.id, {
        row_version: review.row_version,
        decision: "APPROVED",
        notes: "Premature",
      }),
      { statusCode: 409 },
    );
    review = await service.opinion(expert, review.id, {
      row_version: review.row_version,
      reports: reports(review, true),
    });
    await assert.rejects(
      service.sign(manager, review.id, {
        row_version: review.row_version,
        decision: "APPROVED",
        notes: "Cannot override failed opinion",
      }),
      { statusCode: 409 },
    );
    review = await service.sign(manager, review.id, {
      row_version: review.row_version,
      decision: "REJECTED",
      notes: "Revise proposed specification",
    });
    assert.equal(review.status, "REJECTED");
    await assert.rejects(ready(), { code: "TECHNICAL_REVIEW_REQUIRED" });
    review = await service.create(manager, payload("second-round"));
    const oldVersion = review.row_version;
    review = await service.opinion(hod, review.id, {
      row_version: review.row_version,
      reports: reports(review),
    });
    await assert.rejects(
      service.opinion(expert, review.id, {
        row_version: oldVersion,
        reports: reports(review),
      }),
      { statusCode: 409 },
    );
    review = await service.opinion(expert, review.id, {
      row_version: review.row_version,
      reports: reports(review),
    });
    review = await service.sign(manager, review.id, {
      row_version: review.row_version,
      decision: "APPROVED",
      notes: "All departments approved; technically cleared for procurement",
    });
    assert.equal(review.status, "APPROVED");
    assert.equal(review.signer_snapshot.user_id, manager.id);
    for (const command of [
      "create_award",
      "create_purchase_order",
      "register_procurement",
    ])
      await ready(fixture.items[0], command);
    await client.query(
      "UPDATE public.requested_items SET specs='Changed requirement' WHERE id=$1",
      [fixture.items[0].id],
    );
    await assert.rejects(ready(), { code: "TECHNICAL_REVIEW_STALE" });
    const unreviewed = await makeRequest();
    await service.updatePolicy(manager, {
      require_for_all: true,
      reason: "Technical clearance rollout",
    });
    await assert.rejects(ready(unreviewed.items[0]), {
      code: "TECHNICAL_REVIEW_REQUIRED",
    });
    await service.updatePolicy(manager, {
      require_for_all: false,
      reason: "Selected workflow rollout",
    });
    await ready(unreviewed.items[0]);
    await assert.rejects(ready(), { code: "TECHNICAL_REVIEW_STALE" });
    review = await service.create(manager, payload("third-round"));
    review = await service.cancel(manager, review.id, {
      row_version: review.row_version,
      notes: "Await updated vendor evidence",
    });
    assert.equal(review.status, "CANCELLED");
    await assert.rejects(ready(), { code: "TECHNICAL_REVIEW_REQUIRED" });
    const before = Number(
      (
        await client.query(
          "SELECT count(*) AS n FROM public.preprocurement_technical_reviews",
        )
      ).rows[0].n,
    );
    failNotification = true;
    await assert.rejects(
      service.create(manager, payload("atomic-notification")),
      /Injected notification failure/,
    );
    assert.equal(
      Number(
        (
          await client.query(
            "SELECT count(*) AS n FROM public.preprocurement_technical_reviews",
          )
        ).rows[0].n,
      ),
      before,
    );
    assert.equal(
      (
        await client.query("SELECT status FROM public.requests WHERE id=$1", [
          fixture.request.id,
        ])
      ).rows[0].status,
      "Approved",
    );
    assert(
      (
        await client.query(
          "SELECT purchased_quantity FROM public.requested_items WHERE request_id=$1",
          [fixture.request.id],
        )
      ).rows.every((row) => row.purchased_quantity === 0),
    );
    // Actual SQL read model: access scope, filters, paged totals, and historical
    // records remain separate from authenticated departmental assignments.
    const unassignedTasks = await worklist(outsider);
    assert.equal(unassignedTasks.total, 0);
    assert.equal((await worklist(foreign)).total, 0);
    const completedTasks = await worklist(hod, {
      tab: "history",
      type: "PRE_PROCUREMENT",
    });
    assert.equal(completedTasks.total, 3);
    assert.equal(Number(completedTasks.summary.completed), 3);
    assert.equal(Number(completedTasks.summary.awaiting_my_review), 0);
    assert(completedTasks.rows.every((row) => row.item_name.includes("Chair")));
    assert.equal(
      (await worklist(hod, { search: "nonexistent technical item" })).total,
      0,
    );
    assert.equal((await worklist(hod, { department: foreignDept })).total, 0);
    assert.equal((await worklist(manager, { from: "2099-01-01" })).total, 0);
    await client.query(
      "INSERT INTO technical_inspections(id,item_name,created_by,acceptance_status) SELECT COALESCE(max(id),0)+100,'Historical local inspection',$1,'pending' FROM technical_inspections",
      [manager.id],
    );
    await client.query(
      "INSERT INTO technical_inspections(id,item_name,created_by,acceptance_status) SELECT COALESCE(max(id),0)+100,'Foreign historical inspection',$1,'pending' FROM technical_inspections",
      [foreign.id],
    );
    const legacyTasks = await worklist(manager, { type: "LEGACY_INSPECTION" });
    assert.equal(legacyTasks.total, 1);
    assert.equal(legacyTasks.rows[0].item_name, "Historical local inspection");
    assert.equal(legacyTasks.rows[0].awaiting_me, false);
    const conciseRequest = await makeRequest();
    let conciseReview = await service.create(manager, {
      ...payload("concise-round"),
      request_id: conciseRequest.request.id,
      items: conciseRequest.items.map((item, index) => ({
        ...payload("unused").items[index],
        item_id: item.id,
      })),
    });
    assert.equal(
      Number(
        (await worklist(hod, { tab: "pending" })).summary.awaiting_my_review,
      ),
      1,
    );
    const conciseReports = conciseReview.item_packets.map((packet) => ({
      item_id: packet.item_id,
      assessment_version: 2,
      decision: "APPROVED",
      assessment: {
        specifications: "compliant",
        compatibility: "compatible",
        suitability: "suitable",
      },
    }));
    conciseReview = await service.opinion(hod, conciseReview.id, {
      row_version: conciseReview.row_version,
      reports: conciseReports,
    });
    assert.equal((await worklist(hod, { tab: "in_progress" })).total, 1);
    assert.equal(Number((await worklist(hod)).summary.awaiting_my_review), 0);
    conciseReview = await service.opinion(expert, conciseReview.id, {
      row_version: conciseReview.row_version,
      reports: conciseReports,
    });
    assert.equal(
      Number((await worklist(manager)).summary.awaiting_my_review),
      1,
    );
    assert.deepEqual(conciseReview.assignments[0].reports[0].checklist, {});
    conciseReview = await service.sign(manager, conciseReview.id, {
      row_version: conciseReview.row_version,
      decision: "APPROVED",
      notes: "All suitability opinions are complete",
    });
    assert.equal(conciseReview.status, "APPROVED");
    const cleared = await worklist(manager, {
      type: "PRE_PROCUREMENT",
      tab: "history",
    });
    assert.equal(cleared.total, 4);
    assert.equal(Number(cleared.summary.awaiting_my_review), 0);
    // Pagination counts the entire result; cards never summarize a 25-row slice.
    for (let n = 0; n < 27; n++)
      await client.query(
        "INSERT INTO technical_inspections(id,item_name,created_by,acceptance_status) SELECT COALESCE(max(id),0)+100,$1,$2,'pending' FROM technical_inspections",
        ["Paged inspection " + n, manager.id],
      );
    const secondPage = await worklist(manager, {
      type: "LEGACY_INSPECTION",
      page: 2,
    });
    assert.equal(secondPage.total, 28);
    assert.equal(secondPage.rows.length, 3);
    await client.query(
      "INSERT INTO technical_inspections(id,item_name,created_by,acceptance_status,created_at) SELECT COALESCE(max(id),0)+100,'Baghdad boundary before midnight',$1,'pending','2026-10-30T20:59:59Z'::timestamptz FROM technical_inspections",
      [manager.id],
    );
    await client.query(
      "INSERT INTO technical_inspections(id,item_name,created_by,acceptance_status,created_at) SELECT COALESCE(max(id),0)+100,'Baghdad boundary after midnight',$1,'pending','2026-10-30T21:00:00Z'::timestamptz FROM technical_inspections",
      [manager.id],
    );
    const boundary = await worklist(manager, {
      search: "Baghdad boundary",
      from: "2026-10-30",
      to: "2026-10-30",
    });
    assert.equal(boundary.total, 1);
    assert.equal(
      boundary.rows[0].item_name,
      "Baghdad boundary before midnight",
    );
    console.log(
      "Technical worklist: actual scoped SQL, date/search/department filters, full-result counts, pagination and concise signed opinions PASS",
    );
    const beforeRows = (
      await client.query(
        "SELECT * FROM public.preprocurement_technical_reviews ORDER BY id",
      )
    ).rows;
    await client.query(
      patch.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""),
    );
    assert.deepEqual(
      (
        await client.query(
          "SELECT * FROM public.preprocurement_technical_reviews ORDER BY id",
        )
      ).rows,
      beforeRows,
    );
    console.log(
      "SQL 049 technical reviews: department routing/authority, immutable signed opinions, rejection/resubmission, SCM clearance, gates, stale scope, policy, atomic notifications and repeat preservation PASS",
    );
  } finally {
    await client.query("ROLLBACK");
  }
};
