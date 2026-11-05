"use strict";
const fs = require("fs"),
  path = require("path");
const {
  splitStatements,
  migrationBody,
  leadingKeyword,
} = require("../scripts/lib/databaseRelease/sqlStatements");
const { assertRuntimeSql, guard } = require("../utils/runtimeSqlGuard");
const {
  inventory,
  verifyFiles,
  root,
} = require("../scripts/lib/databaseRelease/inventory");
const {
  selectMigrations,
  validateOrder,
  bundle,
} = require("../scripts/lib/databaseRelease/planner");
const {
  loadContract,
  loadInventory,
} = require("../services/databaseReleaseService");

test.each([
  "CREATE TABLE x(id int)",
  "/* outer /* nested */ comment */ ALTER TABLE x ADD y int",
  "SELECT 1; DROP TABLE x",
  "-- prefix\n DO $$ BEGIN NULL; END $$",
  "GRANT SELECT ON x TO PUBLIC",
  "TRUNCATE x",
])("runtime rejects schema authority: %s", (sql) => {
  expect(() => assertRuntimeSql(sql)).toThrow(
    expect.objectContaining({ code: "RUNTIME_DDL_DISABLED" }),
  );
});
test.each([
  "SELECT 'ALTER TABLE x; CREATE TABLE y'",
  "BEGIN; SELECT 1; COMMIT",
  "SELECT $$ CREATE TABLE ignored(x int); $$",
  "SELECT E'escaped\\\'quote; DROP text'",
  "SELECT 'standard\\'; SELECT 1",
])("runtime preserves SQL data and transaction boundaries: %s", (sql) =>
  expect(() => assertRuntimeSql(sql)).not.toThrow(),
);
test("SQL parser preserves quoted bodies and rejects unfinished input", () => {
  expect(
    splitStatements("BEGIN; DO $body$ BEGIN SELECT 1; END $body$; COMMIT;"),
  ).toHaveLength(3);
  expect(() => splitStatements("SELECT 'unfinished")).toThrow("Unterminated");
  expect(leadingKeyword("/* a /* b */ c */ --line\nSELECT 1")).toBe("SELECT");
  expect(migrationBody("BEGIN; SELECT 1; COMMIT;")).toContain("SELECT 1;");
  expect(() =>
    migrationBody("BEGIN; CREATE INDEX CONCURRENTLY x ON y(z); COMMIT;"),
  ).toThrow("nontransactional");
  expect(() => migrationBody("BEGIN; COMMIT; SELECT 1; COMMIT;")).toThrow(
    "nested transaction",
  );
});
test("query guard rejects callback and promise queries without invoking the driver", async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [{ one: 1 }] }) };
  guard(db);
  guard(db);
  await expect(
    db.query({ text: "ALTER TABLE x ADD y int" }),
  ).rejects.toMatchObject({ code: "RUNTIME_DDL_DISABLED" });
  await new Promise((resolve) =>
    db.query("CREATE TABLE x(id int)", (error) => {
      expect(error.code).toBe("RUNTIME_DDL_DISABLED");
      resolve();
    }),
  );
  expect(db.query).not.toHaveProperty("mock");
  await expect(db.query("SELECT 1")).resolves.toEqual({ rows: [{ one: 1 }] });
});
test("locked inventory discovers the actual highest migration and records unverified history", () => {
  const manifest = loadInventory(),
    current = inventory();
  expect(current.highest_manual_number).toBe(70);
  expect(verifyFiles(manifest)).toEqual([]);
  expect(
    current.artifacts.some((e) => e.classification === "test_fixture"),
  ).toBe(true);
  expect(
    current.artifacts.filter(
      (e) => e.classification === "superseded_migration",
    ),
  ).toHaveLength(9);
  expect(
    current.artifacts.every((e) => e.execution_evidence !== "APPLIED"),
  ).toBe(true);
});
test("planner blocks frozen history, changed checksums and dependency reversal", () => {
  const manifest = loadInventory();
  expect(() =>
    selectMigrations(manifest, ["067_canonical_procurement_completion"]),
  ).toThrow("FROZEN_REPLAY_DISABLED");
  const changed = structuredClone(manifest);
  changed.artifacts.find((e) => e.id === "070").sha256 = "0".repeat(64);
  expect(() => selectMigrations(changed)).toThrow("CHECKSUM_MISMATCH");
  expect(() =>
    validateOrder([
      { path: "070_child.sql", depends_on: ["069_parent"] },
      { path: "069_parent.sql" },
    ]),
  ).toThrow("MIGRATION_ORDER");
});
test("offline plans bind actor, environment, source digest, contract and execution evidence", () => {
  const manifest = loadInventory(),
    contract = loadContract();
  expect(() => bundle({ inventory: manifest, contract })).toThrow(
    "EXPLICIT_ENVIRONMENT",
  );
  const sql = bundle({
    inventory: manifest,
    contract,
    environment: "development",
    actor: "reviewer's account",
    releaseRef: "test-release",
  });
  for (const text of [
    "pg_try_advisory_xact_lock",
    "lock_timeout='3s'",
    "DATABASE_CONTRACT_INVALID",
    "MIGRATION_CHECKSUM_MISMATCH",
    "reviewer''s account",
    manifest.application_manifest_sha256,
    "database_release_attestations",
  ])
    expect(sql).toContain(text);
  expect(sql).not.toContain("DATABASE_URL");
  expect(sql.trim().endsWith("COMMIT;")).toBe(true);
});
test("new release machinery never imports the configured application connection", () => {
  for (const file of [
    "scripts/databaseRelease.js",
    "scripts/lib/databaseRelease/catalog.js",
    "scripts/lib/databaseRelease/planner.js",
    "services/databaseReleaseService.js",
  ]) {
    const code = fs.readFileSync(path.join(root, file), "utf8");
    expect(code).not.toMatch(/require\(['"].*config\/db['"]\)/);
  }
});

test("a rewritten source lock cannot retain an old release digest", () => {
  const manifest = structuredClone(loadInventory());
  manifest.application_manifest_sha256 = "0".repeat(64);
  expect(verifyFiles(manifest)).toContainEqual({
    file: "application_sources",
    reason: "MANIFEST_DIGEST_MISMATCH",
  });
});
