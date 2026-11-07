"use strict";
const {
  isolatedConnection,
  category,
} = require("../scripts/captureIsolatedReleaseDiagnostic");
function fixtureUrl(target) {
  const url = new URL(target);
  url.username = "fixture_reader";
  url.password = require("node:crypto").randomBytes(24).toString("hex");
  return url.toString();
}
test("only the explicitly named loopback restore is permitted, with server-side read-only defaults", () => {
  const c = isolatedConnection(
    fixtureUrl("postgresql://127.0.0.1:55432/wici_migration_test"),
  );
  expect(c).toMatchObject({
    host: "127.0.0.1",
    port: 55432,
    database: "wici_migration_test",
    options: "-c default_transaction_read_only=on",
  });
  expect(c.connectionString).toBeUndefined();
});
test.each([
  "postgresql://db.project.supabase.co:55432/wici_migration_test",
  "postgresql://127.0.0.1:5432/wici_migration_test",
  "postgresql://127.0.0.1:55432/postgres",
  "postgresql://127.0.0.1:55432/wici_migration_test?host=production",
  "postgresql://127.0.0.1:55432/wici_migration_test?options=-c%20role=postgres",
  "postgresql://reader@127.0.0.1:55432/wici_migration_test",
  "https://127.0.0.1:55432/wici_migration_test",
])("unsafe diagnostic target is rejected before connecting: %s", (url) =>
  expect(() =>
    isolatedConnection(url.includes("reader@") ? url : fixtureUrl(url)),
  ).toThrow(),
);
test("categories distinguish evidence/visibility/roles without asserting unexplained schema drift is benign", () => {
  expect(category({ group: "ledger" })).toBe("release_evidence");
  expect(category({ group: "catalog_visibility" })).toBe(
    "assessment_visibility",
  );
  expect(category({ group: "runtime_privilege" })).toBe(
    "runtime_role_provisioning",
  );
  expect(category({ group: "constraints", reason: "contract_drift" })).toBe(
    "constraint_or_server_representation_review",
  );
  expect(category({ group: "columns", reason: "contract_drift" })).toBe(
    "application_schema_review",
  );
  expect(category({ category: "extension_security_review" })).toBe(
    "extension_security_review",
  );
});
test("capture refuses missing isolated credentials instead of falling back to DATABASE_URL", async () => {
  const { main } = require("../scripts/captureIsolatedReleaseDiagnostic");
  const oldIsolated = process.env.WICI_ISOLATED_DATABASE_URL,
    oldDatabase = process.env.DATABASE_URL;
  const client = jest.spyOn(require("pg"), "Client");
  try {
    delete process.env.WICI_ISOLATED_DATABASE_URL;
    process.env.DATABASE_URL = fixtureUrl(
      "postgresql://production.invalid/postgres",
    );
    await expect(
      main([
        "--environment",
        "isolated",
        "--release",
        "test",
        "--profile",
        "canonical",
        "--output",
        "/tmp/not-written.json",
      ]),
    ).rejects.toThrow("EXPLICIT_ISOLATED_DATABASE_URL_REQUIRED");
    expect(client).not.toHaveBeenCalled();
  } finally {
    client.mockRestore();
    for (const [key, value] of [
      ["WICI_ISOLATED_DATABASE_URL", oldIsolated],
      ["DATABASE_URL", oldDatabase],
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
