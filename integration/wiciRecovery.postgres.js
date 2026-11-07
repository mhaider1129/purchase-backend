"use strict";
const assert = require("node:assert/strict");
const { build, fixtureContract } = require("./wiciObservedFixture");
const { loadProfile } = require("../scripts/lib/databaseRelease/profiles");
const planner = require("../scripts/lib/databaseRelease/planner");
async function run(client, url) {
  const ownerUrl = require("./disposableDatabase").disposableDatabaseUrl(url);
  const fixture = await build(client, ownerUrl);
  const service = require("../services/databaseReleaseService");
  const contract = fixtureContract(loadProfile("wici-2026-11"), fixture);
  const inventory = service.loadInventory();
  const releaseRef = "wici-recovery-native";
  const options = {
    contract,
    inventory,
    environment: "disposable",
    releaseRef,
    role: "purchase_backend",
  };
  const originalPre = planner.checks(
    loadProfile("wici-2026-11", "observed").catalog,
    { preflight: true },
  );
  function plan() {
    const sql = planner.bundle({
      contract,
      inventory,
      ids: ["073_wici_observed_schema_recovery"],
      environment: "disposable",
      actor: "disposable recovery reviewer",
      releaseRef,
    });
    assert(sql.includes(originalPre));
    // Test-only equivalence for PostgreSQL's pretty-printed expression reparse.
    // The production bundle retains the exact uploaded preflight definitions.
    return sql.replace(originalPre, () =>
      planner.checks(fixture.reconstructed, { preflight: true }),
    );
  }
  let passed = 0,
    pool;
  const test = async (name, fn) => {
    await fn();
    passed++;
    console.log("PASS WICI recovery: " + name);
  };
  const one = async (sql, params = []) =>
    (await client.query(sql, params)).rows[0];
  const pristine = async () => {
    assert.equal(
      (await one("SELECT to_regclass('public.contract_financial_reviews') t"))
        .t,
      null,
    );
    assert.equal(
      (await one("SELECT count(*)::int n FROM database_release_migrations")).n,
      0,
    );
  };
  try {
    await test("profile alone cannot certify the unrepaired schema", async () => {
      assert.equal((await service.verify(client, options)).status, "BLOCKED");
      await pristine();
    });
    await client.query(`INSERT INTO institutes(id,name) VALUES(901,'Recovery fixture');
   INSERT INTO departments(id,name,type,institute_id) VALUES(901,'Recovery','Medical',901);
   INSERT INTO users(id,name,email,password,role,institute_id,department_id,is_active) VALUES(901,'Recovery user','recovery@example.invalid','fixture','SCM',901,901,true);
   INSERT INTO requests(id,request_type,status,requester_id,department_id,institute_id) VALUES(901,'Non-Stock','Approved',901,901,901);
   INSERT INTO requested_items(id,request_id,item_name,quantity,received_quantity,receipt_issue_quantity) VALUES(901,901,'Preserved demand',4,2.50,1.25);
   INSERT INTO journal_entries(id,request_id,journal_type,journal_number,journal_reference,currency,total_amount,entry_status) OVERRIDING SYSTEM VALUE
    VALUES(901,901,'accrual','LEGACY-901','LEGACY-901','USD',40.20,'posted');
   INSERT INTO journal_entry_lines(id,journal_entry_id,line_no,line_number,description,debit_amount,credit_amount) OVERRIDING SYSTEM VALUE
    VALUES(901,901,1,1,'Preserved debit',40.20,0),(902,901,2,2,'Preserved credit',0,40.20);`);
    await test("SCOP 072 already installed with CRLF and no receipts is preserved by recovery", async () => {
      const fs = require("node:fs"),
        path = require("node:path");
      const body =
        require("../scripts/lib/databaseRelease/sqlStatements").migrationBody(
          fs.readFileSync(
            path.join(
              __dirname,
              "../sql/manual/072_scop_operational_foundation.sql",
            ),
            "utf8",
          ),
        );
      await client.query(body.replaceAll("\n", "\r\n"));
      await client.query(
        "INSERT INTO scop_allocation_commands(institute_id,command_key,actor_id,request_id,fingerprint,response) VALUES(901,'preserved-pre-recovery',901,901,'fixture-source','{\"fixture\":true}')",
      );
      assert.equal(
        (await one("SELECT count(*)::int n FROM database_release_migrations"))
          .n,
        0,
      );
      assert.equal(
        (await one("SELECT count(*)::int n FROM permissions")).n,
        157,
      );
    });
    const history = async () => ({
      operationalHistory: await one(
        "SELECT md5(row_to_json(c)::text) hash FROM scop_allocation_commands c WHERE command_key='preserved-pre-recovery'",
      ),
      quantities: await one(
        "SELECT md5(row_to_json(i)::text) hash FROM requested_items i WHERE id=901",
      ),
      header: await one(
        "SELECT md5(row_to_json(j)::text) hash FROM journal_entries j WHERE id=901",
      ),
      lines: (
        await client.query(
          "SELECT md5(row_to_json(j)::text) hash FROM journal_entry_lines j WHERE journal_entry_id=901 ORDER BY id",
        )
      ).rows,
    });
    const before = await history();
    await test("unreviewed RLS drift fails before changes commit", async () => {
      await client.query(
        "BEGIN; ALTER TABLE requests DISABLE ROW LEVEL SECURITY",
      );
      try {
        await assert.rejects(client.query(plan()), /DATABASE_CONTRACT_INVALID/);
      } finally {
        await client.query("ROLLBACK");
      }
      await pristine();
      assert.deepEqual(await history(), before);
    });
    await test("duplicate historical journal reference blocks recovery without deletion", async () => {
      await client.query(
        "BEGIN; INSERT INTO journal_entries(request_id,journal_type,journal_number,journal_reference,currency,total_amount,entry_status) VALUES(901,'accrual','LEGACY-DUPLICATE','LEGACY-901','USD',40.20,'posted')",
      );
      try {
        await assert.rejects(
          client.query(plan()),
          /DUPLICATE_JOURNAL_REFERENCE/,
        );
      } finally {
        await client.query("ROLLBACK");
      }
      await pristine();
      assert.deepEqual(await history(), before);
    });
    await test("release evidence insertion failure rolls back the repair", async () => {
      await client.query(
        "BEGIN; ALTER TABLE database_release_migrations ADD CONSTRAINT fixture_receipt_failure CHECK(migration_id<>'073_wici_observed_schema_recovery')",
      );
      try {
        await assert.rejects(
          client.query(plan()),
          (error) => error.code === "23514",
        );
      } finally {
        await client.query("ROLLBACK");
      }
      await pristine();
      assert.deepEqual(await history(), before);
    });
    await test("Windows CRLF bundle applies atomically with canonical new function bodies", async () => {
      await client.query(plan().replaceAll("\n", "\r\n"));
      assert.deepEqual(
        (await service.verify(client, { ...options, requireEvidence: false }))
          .findings,
        [],
      );
      assert.deepEqual(await history(), before);
    });
    await test("only the actual recovery is recorded; historical executions stay unverified", async () => {
      const rows = (
        await client.query(
          "SELECT migration_id,evidence FROM database_release_migrations",
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].migration_id, "073_wici_observed_schema_recovery");
      assert.equal(rows[0].evidence.historical_execution, "UNVERIFIED");
      const report = await service.verify(client, options);
      assert.equal(
        report.status,
        "DATABASE_READY",
        JSON.stringify(report.findings),
      );
      assert.equal(report.observed_baseline.historical_execution, "UNVERIFIED");
    });
    await test("reader RLS cannot masquerade as 157 missing permission definitions", async () => {
      await client.query(
        "CREATE ROLE wici_fixture_reader LOGIN NOINHERIT PASSWORD 'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr'; GRANT USAGE ON SCHEMA public,extensions TO wici_fixture_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO wici_fixture_reader",
      );
      const readerUrl = new URL(ownerUrl);
      readerUrl.username = "wici_fixture_reader";
      readerUrl.password = "r".repeat(40);
      const reader = new (require("pg").Client)({
        connectionString: readerUrl.toString(),
      });
      await reader.connect();
      try {
        await reader.query("BEGIN READ ONLY");
        assert.equal(
          (await reader.query("SELECT count(*)::int n FROM permissions"))
            .rows[0].n,
          0,
        );
        const report = await service.verify(reader, options);
        assert.equal(report.status, "BLOCKED");
        assert.equal(report.restart_eligible, false);
        assert.equal(report.observed_schema_sha256, null);
        assert(
          report.findings.some(
            (f) =>
              f.group === "catalog_visibility" && f.object === "permissions",
          ),
        );
        assert(!report.findings.some((f) => f.group === "permissions"));
        assert(
          report.findings.some(
            (f) =>
              f.reason ===
              "attestation_unverifiable_with_incomplete_visibility",
          ),
        );
        await reader.query("ROLLBACK");
        const oldUrl = process.env.DB_RELEASE_READONLY_URL,
          oldRole = process.env.DB_RUNTIME_ROLE,
          oldProfile = process.env.DB_RELEASE_SCHEMA_PROFILE,
          oldExit = process.exitCode,
          log = console.log;
        try {
          process.env.DB_RELEASE_READONLY_URL = readerUrl.toString();
          process.env.DB_RUNTIME_ROLE = "purchase_backend";
          process.env.DB_RELEASE_SCHEMA_PROFILE = "wici-2026-11";
          console.log = () => {};
          const diagnostic = await require("../scripts/databaseRelease").main({
            command: "verify",
            environment: "disposable",
            release: releaseRef,
            "backend-role": "purchase_backend",
          });
          assert.equal(diagnostic.verification_mode, "diagnostic");
          assert.equal(
            diagnostic.runtime.connection_role,
            "wici_fixture_reader",
          );
          assert.equal(diagnostic.runtime.assessment_mode, "TARGET_ROLE_ONLY");
          assert.equal(diagnostic.status, "BLOCKED");
          assert.equal(diagnostic.restart_eligible, false);
        } finally {
          console.log = log;
          process.exitCode = oldExit;
          for (const [key, value] of [
            ["DB_RELEASE_READONLY_URL", oldUrl],
            ["DB_RUNTIME_ROLE", oldRole],
            ["DB_RELEASE_SCHEMA_PROFILE", oldProfile],
          ])
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
      } finally {
        await reader.end();
      }
      await test("hidden migration ledger is unknown execution rather than a missing receipt", async () => {
        await client.query(
          "BEGIN; ALTER TABLE database_release_migrations ENABLE ROW LEVEL SECURITY; SET LOCAL ROLE wici_fixture_reader",
        );
        try {
          const report = await service.verify(client, options);
          assert.equal(report.status, "BLOCKED");
          assert.equal(
            report.receipt_visibility,
            "UNVERIFIED_INSUFFICIENT_VISIBILITY",
          );
          assert(
            !report.findings.some(
              (f) => f.reason === "APPLIED_receipt_missing",
            ),
          );
        } finally {
          await client.query("ROLLBACK");
        }
      });
    });
    await test("a new baseline never excuses a conflicting historical receipt checksum", async () => {
      await client.query(
        "BEGIN; INSERT INTO database_release_migrations(migration_id,filename,content_sha256,execution_environment,execution_status,execution_actor,duration_ms,application_release_ref,evidence) VALUES('069_database_release_governance','sql/manual/069_database_release_governance.sql',repeat('f',64),'disposable','APPLIED','negative-fixture',0,'negative-fixture','{}')",
      );
      try {
        const report = await service.verify(client, options);
        assert.equal(report.status, "BLOCKED");
        assert(
          report.findings.some(
            (f) => f.group === "ledger" && f.reason === "CHECKSUM_MISMATCH",
          ),
        );
      } finally {
        await client.query("ROLLBACK");
      }
    });
    await test("repeat recovery does not duplicate evidence or rewrite history", async () => {
      await client.query(plan());
      assert.equal(
        (await one("SELECT count(*)::int n FROM database_release_migrations"))
          .n,
        1,
      );
      assert.deepEqual(await history(), before);
    });
    await test("owner connection remains blocked even with the approved profile", async () => {
      const report = await service.verify(client, { ...options, role: null });
      assert.equal(report.status, "BLOCKED");
      assert.equal(
        report.findings.filter((f) =>
          ["runtime_role", "runtime_privilege"].includes(f.group),
        ).length,
        35,
      );
      assert(
        report.findings.some(
          (f) => f.reason === "persistent_ddl_or_owner_authority",
        ),
      );
    });
    await test("postgres-style owner credentials cannot pass by merely setting the backend role", async () => {
      await client.query("BEGIN; SET LOCAL ROLE purchase_backend");
      try {
        const report = await service.verify(client, { ...options, role: null });
        assert.equal(report.status, "BLOCKED");
        assert.equal(report.restart_eligible, false);
        assert(
          report.findings.some(
            (f) =>
              f.group === "connection_principal" &&
              f.reason === "persistent_ddl_or_owner_authority",
          ),
        );
      } finally {
        await client.query("ROLLBACK");
      }
    });
    const { prepare } = require("../scripts/prepareRuntimeIdentity");
    const identity = prepare({
      ownerUrl,
      role: "wici_fixture_runtime",
      password: "f".repeat(40),
      releaseRef,
    });
    await client.query(identity.sql);
    process.env.DATABASE_URL = identity.environment
      .split("\n")
      .find((line) => line.startsWith("DATABASE_URL="))
      .slice(13);
    process.env.DB_RUNTIME_ROLE = "purchase_backend";
    process.env.DB_RELEASE_SCHEMA_PROFILE = "wici-2026-11";
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "disposable-recovery-jwt-only";
    pool = require("../config/db");
    await test("dedicated NOINHERIT login establishes its reviewed role before checkout", async () => {
      const r = (
        await pool.query("SELECT current_user role,session_user principal")
      ).rows[0];
      assert.deepEqual(r, {
        role: "purchase_backend",
        principal: "wici_fixture_runtime",
      });
    });
    await test("startup is allowed only for the actual restricted connection", async () => {
      const readiness = await service.verify(pool, {
        contract,
        inventory,
        environment: "disposable",
        releaseRef,
      });
      assert.equal(
        readiness.status,
        "DATABASE_READY",
        JSON.stringify(readiness.findings),
      );
      const result = await service.startWhenReady(
        pool,
        { contract, inventory, environment: "disposable", releaseRef },
        () => ({ ready: true }),
      );
      assert.equal(result.ready, true);
    });
    await test("startup reference checks preserve the attested catalog", async () => {
      await require("../utils/permissionService").syncPermissionCatalog();
      await require("../utils/uiAccessService").syncUiAccessResources();
      await require("../utils/capabilityPolicyService").syncCapabilityPolicies();
      const report = await service.verify(pool, {
        contract,
        inventory,
        environment: "disposable",
        releaseRef,
      });
      assert.equal(
        report.status,
        "DATABASE_READY",
        JSON.stringify(report.findings),
      );
    });
    await test("real login handler authenticates an existing account after readiness", async () => {
      const bcrypt = require("bcrypt");
      await client.query("UPDATE users SET password=$1 WHERE id=901", [
        await bcrypt.hash("fixture-login-password", 4),
      ]);
      const app = require("express")();
      app.use(require("express").json());
      app.use("/api/auth", require("../routes/auth"));
      const response = await require("supertest")(app)
        .post("/api/auth/login/")
        .send({
          email: "recovery@example.invalid",
          password: "fixture-login-password",
        });
      assert.equal(response.status, 200, response.text);
      assert.equal(typeof response.body.token, "string");
    });
    await test("canonical journal writer satisfies legacy required aliases without changing money", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const journal =
          await require("../services/financeCoreService").createJournalEntry(
            c,
            {
              requestId: 901,
              journalType: "accrual",
              sourceType: "fixture",
              sourceId: "901",
              totalAmount: 25.5,
              lines: [
                {
                  accountCode: "5000-PROC-EXP",
                  debitAmount: 25.5,
                  description: "Debit",
                },
                {
                  accountCode: "2100-AP-ACCRUAL",
                  creditAmount: 25.5,
                  description: "Credit",
                },
              ],
            },
          );
        assert.equal(journal.journal_number, journal.journal_reference);
        const lines = (
          await c.query(
            "SELECT line_no,line_number FROM journal_entry_lines WHERE journal_entry_id=$1",
            [journal.id],
          )
        ).rows;
        assert(lines.every((l) => l.line_no === l.line_number));
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
      assert.deepEqual(await history(), before);
    });
    await test("runtime cannot change schema, assume owner, or write release evidence", async () => {
      const c = await pool.connect();
      const raw = require("pg").Client.prototype.query;
      try {
        await assert.rejects(
          raw.call(c, "CREATE TABLE public.fixture_forbidden(id int)"),
          (error) => error.code === "42501",
        );
        await assert.rejects(
          raw.call(c, "SET ROLE p2p_test"),
          (error) => error.code === "42501",
        );
        await assert.rejects(
          raw.call(c, "DELETE FROM database_release_migrations"),
          (error) => error.code === "42501",
        );
      } finally {
        c.release();
      }
    });
    await test("legacy direct-stock trigger stays disabled and browser grants stay denied", async () => {
      assert.equal(
        (
          await one(
            "SELECT tgenabled FROM pg_trigger WHERE tgname='trg_approve_stock_item_request'",
          )
        ).tgenabled,
        "D",
      );
      assert.equal(
        (
          await one(
            "SELECT has_table_privilege('anon','audit_log','SELECT') allowed",
          )
        ).allowed,
        false,
      );
    });
    console.log(`WICI hosted recovery PostgreSQL cases passed: ${passed}`);
    // Canonical receiving/inspection/inventory regressions run against the hosted
    // schema variant and the same already-initialized restricted application pool.
    await require("./goodsReceiptAcceptance.postgres").run(client, ownerUrl);
  } finally {
    if (pool && !pool.ending && !pool.ended) await pool.end();
    delete process.env.DB_RUNTIME_ROLE;
    delete process.env.DB_RELEASE_SCHEMA_PROFILE;
  }
}
module.exports = { run };
