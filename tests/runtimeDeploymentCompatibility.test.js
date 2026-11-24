"use strict";
const catalog = require("../scripts/lib/databaseRelease/catalog");
const service = require("../services/databaseReleaseService");
const fs = require("node:fs");
const path = require("node:path");
function database(change = () => {}, ledgerHidden = false) {
  const actual = structuredClone(service.loadContract().catalog);
  change(actual);
  const query = jest.fn(async (sql) => {
    for (const [group, text] of Object.entries({
      ...catalog.queries,
      ...catalog.businessQueries,
    })) {
      if (sql === text) return { rows: actual[group] || [] };
    }
    if (sql.includes("pg_catalog.row_security_active"))
      return {
        rows: [
          ...Object.values({ ...catalog.businessQueries })
            .map(() => null)
            .filter(Boolean),
          {
            relation: "database_release_migrations",
            can_select: !ledgerHidden,
            rls_active: ledgerHidden,
          },
          {
            relation: "database_release_attestations",
            can_select: !ledgerHidden,
            rls_active: ledgerHidden,
          },
        ],
      };
    if (sql === "SELECT current_user name,session_user principal")
      return {
        rows: [{ name: "purchase_backend", principal: "purchase_backend" }],
      };
    if (sql.includes("SELECT r.rolname name,r.rolsuper"))
      return {
        rows: [
          {
            name: "purchase_backend",
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolbypassrls: true,
            schema_create: false,
            database_create: false,
            owns_application_objects: false,
          },
        ],
      };
    if (sql.includes("encode(sha256"))
      return { rows: [{ digest: "a".repeat(64) }] };
    return { rows: [] };
  });
  return { query };
}
test("compatible database with empty ledgers starts without release/environment or manual attestation", async () => {
  const db = database();
  const ready = jest.fn();
  await service.startWhenReady(db, {}, ready);
  expect(ready).toHaveBeenCalledWith(
    expect.objectContaining({
      readiness_mode: "AUTOMATIC_RUNTIME_COMPATIBILITY",
      startup_eligible: true,
      status: "SCHEMA_VERIFIED_UNATTESTED",
      attestation: null,
    }),
  );
  expect(
    db.query.mock.calls.some(([sql]) => sql.startsWith("SELECT migration_id,")),
  ).toBe(false);
});
test("inaccessible certification rows do not become a routine startup prerequisite", async () => {
  await expect(
    service.assertRuntimeCompatible(
      database(() => {}, true),
      {},
    ),
  ).resolves.toMatchObject({ startup_eligible: true });
});
test("explicit release audit still requires genuine receipts and attestation", async () => {
  await expect(
    service.assertReady(database(), {
      releaseRef: "test-release",
      environment: "development",
    }),
  ).rejects.toMatchObject({
    code: "DATABASE_RELEASE_INCOMPATIBLE",
    findings: expect.arrayContaining([
      expect.objectContaining({ group: "attestation" }),
    ]),
  });
});
test.each(["columns", "constraints", "relations", "permissions", "functions"])(
  "runtime incompatibility in %s prevents listen and worker startup",
  async (group) => {
    const db = database((c) => {
      c[group] = c[group].slice(1);
    });
    const ready = jest.fn();
    await expect(service.startWhenReady(db, {}, ready)).rejects.toMatchObject({
      code: "DATABASE_RELEASE_INCOMPATIBLE",
    });
    expect(ready).not.toHaveBeenCalled();
  },
);
test("numeric precision and RLS mismatches remain blockers", async () => {
  for (const change of [
    (c) => {
      c.columns.find((c) => c.type.startsWith("numeric")).type = "numeric(4,1)";
    },
    (c) => {
      c.relations[0].rls = !c.relations[0].rls;
    },
  ]) {
    await expect(
      service.assertRuntimeCompatible(database(change), {}),
    ).rejects.toMatchObject({ code: "DATABASE_RELEASE_INCOMPATIBLE" });
  }
});
test("a hypothetical role cannot authorize application startup", async () => {
  const ready = jest.fn();
  await expect(
    service.startWhenReady(database(), { role: "postgres" }, ready),
  ).rejects.toMatchObject({ code: "RUNTIME_ROLE_OVERRIDE_NOT_ALLOWED" });
  expect(ready).not.toHaveBeenCalled();
});
test("automatic startup still rejects an owner/superuser runtime principal", async () => {
  const db = database();
  const original = db.query.getMockImplementation();
  db.query.mockImplementation(async (sql) => {
    const result = await original(sql);
    if (sql.includes("SELECT r.rolname name,r.rolsuper"))
      result.rows[0].rolsuper = true;
    return result;
  });
  await expect(service.assertRuntimeCompatible(db, {})).rejects.toMatchObject({
    code: "DATABASE_RELEASE_INCOMPATIBLE",
    findings: expect.arrayContaining([
      expect.objectContaining({ reason: "persistent_ddl_or_owner_authority" }),
    ]),
  });
});
test("pooled automatic checks use one read-only snapshot and release the client before listen", async () => {
  const client = database();
  client.release = jest.fn();
  const pool = { totalCount: 1, connect: jest.fn().mockResolvedValue(client) };
  const ready = jest.fn(() => {
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  await service.startWhenReady(pool, {}, ready);
  expect(client.query).toHaveBeenCalledWith(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  expect(client.query).toHaveBeenCalledWith("COMMIT");
  expect(ready).toHaveBeenCalledTimes(1);
});
test("failed pooled compatibility rolls back and cannot invoke the server callback", async () => {
  const client = database((c) => {
    c.permissions = [];
  });
  client.release = jest.fn();
  const pool = { totalCount: 1, connect: jest.fn().mockResolvedValue(client) };
  const ready = jest.fn();
  await expect(service.startWhenReady(pool, {}, ready)).rejects.toMatchObject({
    code: "DATABASE_RELEASE_INCOMPATIBLE",
  });
  expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  expect(client.release).toHaveBeenCalledTimes(1);
  expect(ready).not.toHaveBeenCalled();
});
test("candidate API starts with workers disabled and exposes source identity through the same-origin API", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  expect(source).toContain("app.get(['/health', '/api/health']");
  expect(source).toContain("process.env.APP_RELEASE_REF || null");
  expect(source).toContain("if (!workersEnabled) return;");
  expect(source.indexOf("if (!workersEnabled) return;")).toBeLessThan(
    source.indexOf("await reassignPendingApprovals();"),
  );
  expect(source).toContain("workersEnabled ? require");
});
