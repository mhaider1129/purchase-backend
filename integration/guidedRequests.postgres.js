"use strict";
const assert = require("node:assert/strict");
const { disposableDatabaseUrl } = require("./disposableDatabase");
async function run(client, url) {
  process.env.DATABASE_URL = disposableDatabaseUrl(url);
  process.env.NODE_ENV = "test";
  process.env.GUIDED_REQUESTS_ENABLED = "true";
  process.env.JWT_SECRET = "disposable-guided-only";
  const pool = require("../config/db");
  const service = require("../services/guidedRequestService");
  const express = require("express"),
    request = require("supertest"),
    jwt = require("jsonwebtoken");
  const app = express();
  app.use(express.json());
  app.use(
    "/requests/guided",
    require("../middleware/authMiddleware").authenticateUser,
    require("../routes/guidedRequests"),
  );
  app.use((error, req, res, next) =>
    res.status(error.statusCode || 500).json({ message: error.message }),
  );
  let passed = 0;
  const test = async (name, fn) => {
    await fn();
    passed++;
    console.log("PASS guided: " + name);
  };
  try {
    await client.query(`INSERT INTO institutes(id,name) VALUES(801,'Guided hospital'),(802,'Foreign hospital');
 INSERT INTO departments(id,name,type,institute_id) VALUES(801,'Guided clinical','Medical',801),(802,'Foreign','Medical',802);
 INSERT INTO warehouses(id,name,institute_id,department_id,type) VALUES(801,'Guided warehouse',801,801,'medical'),(802,'Foreign warehouse',802,802,'medical');
 INSERT INTO users(id,name,email,password,role,institute_id,department_id,warehouse_id,is_active,can_request_medication) VALUES
 (801,'Guided requester','guided-requester@example.invalid','fixture','requester',801,801,801,true,true),
 (802,'Guided approver','guided-approver@example.invalid','fixture','SCM',801,801,NULL,true,false),
 (803,'Foreign requester','guided-foreign@example.invalid','fixture','requester',802,802,802,true,true);
 INSERT INTO item_categories(id,category_name,is_active) OVERRIDING SYSTEM VALUE VALUES(801,'Guided clinical items',true);
 UPDATE approval_route_versions SET is_active=false;
 INSERT INTO approval_route_versions(id,version_label,is_active) VALUES(801,'guided-fixture',true);
 INSERT INTO approval_route_rules(version_id,request_type,department_type,approval_level,role,min_amount,max_amount)
 SELECT 801,t,'medical',1,'SCM',0,999999999 FROM unnest(ARRAY['Stock','Non-Stock','Medication','Medical Device','IT Item']) t;`);
    for (const [index, type] of [
      "general_item",
      "medication",
      "medical_device",
      "it_item",
    ].entries())
      await client.query(
        `INSERT INTO generic_items(id,item_code,generic_name,canonical_description,item_type,category,category_id,base_uom,inventory_uom,structured_fingerprint,institute_id,is_active,lifecycle_status)
 VALUES($1,$2,$3,'Canonical guided item',$4,'Guided clinical items',801,'Piece','Piece',$2,801,true,'active')`,
        [801 + index, `GUIDED-${index}`, `Guided ${type}`, type],
      );
    const token = (id) =>
      jwt.sign({ user_id: id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const api = (method, path, id = 801) =>
      request(app)
        [method]("/requests/guided" + path)
        .set("Authorization", `Bearer ${token(id)}`);
    const payload = (family, key = `guided-${family.id}-${Date.now()}`) => ({
      family: family.id,
      category_id: 801,
      purpose: "ROUTINE",
      required_by: "2099-01-01",
      justification: "Hospital operational need",
      operational_impact: "Care interruption",
      specialized: Object.fromEntries(
        family.fields.map((field) => [
          field,
          field === "procedure_date"
            ? "2099-01-01"
            : field === "period"
              ? "2099-01"
              : field === "activity"
                ? "5"
                : field === "calibration_at"
                  ? "2099-01-01T10:00:00Z"
                  : "Fixture evidence",
        ]),
      ),
      items: [
        {
          request_mode: "generic_item",
          generic_item_id:
            family.id === "medication"
              ? 802
              : family.id === "device"
                ? 803
                : family.id === "it"
                  ? 804
                  : 801,
          quantity: 2,
          unit_of_measure: "Piece",
          unit_cost: 0,
          specs: "Clinical requirement",
        },
      ],
      client_submission_key: key,
    });
    const submit = (p) => api("post", "").field("payload", JSON.stringify(p));
    await test("unauthenticated API denied", async () =>
      assert.equal(
        (await request(app).get("/requests/guided/options")).status,
        401,
      ));
    await test("server-derived requester and unavailable SAP", async () => {
      const result = await api("get", "/options");
      assert.equal(result.status, 200, result.text);
      assert.equal(result.body.requester.institute_id, 801);
      assert.equal(result.body.sap_inventory.available, false);
    });
    for (const family of service.FAMILIES)
      await test(`${family.id}: canonical request, item, policy, audit and outbox`, async () => {
        const p = payload(family);
        const preview = await api("post", "/preview").send(p);
        assert.equal(preview.status, 200, preview.text);
        assert.equal(preview.body.request_type, family.request_type);
        assert.equal(preview.body.approvals[0].role, "SCM");
        const result = await submit(p);
        assert.equal(result.status, 201, result.text);
        const data = (
          await client.query(
            `SELECT r.*,ri.required_date,ri.specs FROM requests r JOIN requested_items ri ON ri.request_id=r.id WHERE r.id=$1`,
            [result.body.request_id],
          )
        ).rows[0];
        assert.equal(data.request_type, family.request_type);
        assert.equal(data.institute_id, 801);
        assert.equal(data.department_id, 801);
        assert.equal(data.status, "Submitted");
        assert(data.specs.includes(`Family: ${family.id}`));
        assert.equal(
          (
            await client.query(
              `SELECT count(*)::int n FROM approvals WHERE request_id=$1 AND approver_id=802`,
              [data.id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await client.query(
              `SELECT count(*)::int n FROM audit_logs WHERE target_type='request' AND target_id=$1 AND action='REQUEST_CREATED'`,
              [data.id],
            )
          ).rows[0].n,
          1,
        );
        assert(
          (
            await client.query(
              `SELECT count(*)::int n FROM notification_outbox WHERE entity_type='request' AND entity_id=$1::text`,
              [data.id],
            )
          ).rows[0].n > 0,
        );
      });
    await test("foreign catalog item hidden from search and direct selection", async () => {
      assert.deepEqual(
        (await api("get", "/catalog?q=GUIDED", 803)).body.data,
        [],
      );
      const p = payload(service.FAMILIES[0]);
      assert.equal((await api("post", "/preview", 803).send(p)).status, 403);
    });
    await test("foreign assigned warehouse denied", async () => {
      await client.query("UPDATE users SET warehouse_id=802 WHERE id=801");
      assert.equal(
        (await api("post", "/preview").send(payload(service.FAMILIES[1])))
          .status,
        403,
      );
      await client.query("UPDATE users SET warehouse_id=801 WHERE id=801");
    });
    await test("unauthorized medication actor", async () =>
      assert.equal(
        (await api("post", "/preview", 802).send(payload(service.FAMILIES[2])))
          .status,
        403,
      ));
    await test("invalid quantity and patient identifiers rejected", async () => {
      const p = payload(service.FAMILIES[0]);
      p.items[0].quantity = -1;
      assert.equal((await submit(p)).status, 400);
      p.items[0].quantity = 1;
      p.patient_name = "forbidden";
      assert.equal((await submit(p)).status, 400);
    });
    await test("controlled new-item referral; no direct master creation", async () => {
      const p = payload(service.FAMILIES[0]);
      p.items = [
        {
          request_mode: "pending_item_creation",
          quantity: 1,
          unit_of_measure: "Piece",
          unit_cost: 0,
          pending_item: {
            proposed_name: "Pending guided item",
            item_type: "general_item",
            category: "Guided clinical items",
            justification: "No suitable catalog item",
          },
        },
      ];
      const result = await submit(p);
      assert.equal(result.status, 201, result.text);
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM pending_item_requests WHERE request_id=$1",
            [result.body.request_id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM generic_items WHERE generic_name='Pending guided item'",
          )
        ).rows[0].n,
        0,
      );
    });
    await test("concurrent duplicate submission commits one request and audit", async () => {
      const p = payload(service.FAMILIES[0], "guided-concurrent-duplicate");
      const results = await Promise.all([submit(p), submit(p)]);
      assert(
        results.every((r) => [200, 201].includes(r.status)),
        JSON.stringify(results.map((r) => [r.status, r.body])),
      );
      assert.equal(results[0].body.request_id, results[1].body.request_id);
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM requests WHERE client_submission_key=$1",
            [p.client_submission_key],
          )
        ).rows[0].n,
        1,
      );
    });
    await test("audit failure rolls back entire canonical submission", async () => {
      await client.query(
        `CREATE FUNCTION public.guided_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='REQUEST_CREATED' THEN RAISE EXCEPTION 'guided injected audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER guided_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.guided_test_audit_failure()`,
      );
      try {
        const p = payload(service.FAMILIES[0], "guided-audit-rollback");
        assert.equal((await submit(p)).status, 500);
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM requests WHERE client_submission_key=$1",
              [p.client_submission_key],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await client.query(
          "DROP TRIGGER guided_test_audit_failure ON audit_logs; DROP FUNCTION public.guided_test_audit_failure()",
        );
      }
    });
    await test("contract-covered stock retains the specialized contract chooser", async () => {
      await client.query(`INSERT INTO contracts(id,title,vendor,status,institute_id,end_user_department_id,created_by)
        VALUES(8801,'Guided fixture contract','Fixture vendor','active',801,801,801);
        INSERT INTO contract_items(contract_id,item_name,is_active) VALUES(8801,'Guided general_item',true)`);
      try {
        const result = await submit(payload(service.FAMILIES[1]));
        assert.equal(result.status, 409, result.text);
      } finally {
        await client.query(
          "UPDATE contract_items SET is_active=false WHERE contract_id=8801",
        );
      }
    });
    await test("missing approver configuration rolls back instead of auto-approving", async () => {
      await client.query(
        "UPDATE approval_route_rules SET role='Unassigned fixture role' WHERE version_id=801 AND request_type='Non-Stock'",
      );
      const p = payload(service.FAMILIES[0], "guided-unresolved-route");
      try {
        const result = await submit(p);
        assert.equal(result.status, 409, result.text);
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM requests WHERE client_submission_key=$1",
              [p.client_submission_key],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await client.query(
          "UPDATE approval_route_rules SET role='SCM' WHERE version_id=801 AND request_type='Non-Stock'",
        );
      }
    });
    await test("deactivated actor cannot submit or search", async () => {
      await client.query("UPDATE users SET is_active=false WHERE id=801");
      assert.equal((await submit(payload(service.FAMILIES[0]))).status, 401);
      await client.query("UPDATE users SET is_active=true WHERE id=801");
    });
    console.log(`Guided request PostgreSQL cases passed: ${passed}`);
  } finally {
    await pool.end();
  }
}
module.exports = { run };
