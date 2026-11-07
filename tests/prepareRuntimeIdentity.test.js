const { prepare } = require("../scripts/prepareRuntimeIdentity");
const password = "x".repeat(40);
test.each([
  "postgresql://postgres:fixture@127.0.0.1:5432/postgres",
  "postgresql://postgres.projectref:fixture@127.0.0.1:5432/postgres?sslmode=require",
])(
  "offline identity preserves the endpoint but replaces owner credentials %s",
  (ownerUrl) => {
    const result = prepare({ ownerUrl, password });
    const url = new URL(
      result.environment
        .split("\n")
        .find((s) => s.startsWith("DATABASE_URL="))
        .slice(13),
    );
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.username).toBe(
      ownerUrl.includes("projectref")
        ? "wici_purchase_runtime.projectref"
        : "wici_purchase_runtime",
    );
    expect(url.password).toBe(password);
    expect(url.searchParams.get("options")).toBeNull();
    expect(result.environment).toContain("DB_RUNTIME_ROLE=purchase_backend");
    expect(result.environment).not.toContain(":fixture@");
    expect(result.sql).toContain(
      "NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE",
    );
    expect(result.sql).toContain("RUNTIME_ROLE_ALREADY_EXISTS_REVIEW_REQUIRED");
  },
);
test.each([
  "postgres",
  "purchase_backend",
  "anon",
  "x;DROP ROLE postgres",
  'role"injection',
])("rejects unsafe/shared login %s", (role) => {
  expect(() =>
    prepare({
      ownerUrl: "postgresql://owner:fixture@localhost/db",
      role,
      password,
    }),
  ).toThrow();
});
test("release reference cannot inject environment variables", () => {
  expect(() =>
    prepare({
      ownerUrl: "postgresql://owner:fixture@localhost/db",
      password,
      releaseRef: "a\nDATABASE_URL=bad",
    }),
  ).toThrow("Invalid release reference");
});
