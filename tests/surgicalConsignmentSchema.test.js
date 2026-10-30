const {
  createSurgicalConsignmentService,
} = require("../services/surgicalConsignmentService");
const dbFor = (missing) => ({
  query: jest
    .fn()
    .mockResolvedValueOnce({ rows: [{ available: true }] })
    .mockResolvedValueOnce({ rows: missing }),
});
test("legacy supplier scope reports the exact missing column and manual compatibility patch before any supplier selection", async () => {
  const db = dbFor([{ table_name: "suppliers", column_name: "institute_id" }]);
  await expect(
    createSurgicalConsignmentService(db).options({
      id: 1,
      institute_id: 7,
      role: "SCM",
      permissions: ["requests.manage"],
    }),
  ).rejects.toMatchObject({
    statusCode: 503,
    code: "SURGICAL_CONSIGNMENT_SCHEMA_REQUIRED",
    message: expect.stringMatching(/public\.suppliers\.institute_id.*SQL 052/),
  });
  expect(db.query).toHaveBeenCalledTimes(2);
});
test("other missing institute scope cannot silently fall back to unscoped clinical data", async () => {
  const db = dbFor([
    { table_name: "users", column_name: "institute_id" },
    { table_name: "departments", column_name: "institute_id" },
  ]);
  await expect(
    createSurgicalConsignmentService(db).checkSchema(),
  ).rejects.toMatchObject({
    statusCode: 503,
    message: expect.stringMatching(
      /public\.users\.institute_id.*public\.departments\.institute_id.*reconciliation/,
    ),
  });
  expect(db.query.mock.calls.some(([sql]) => sql.includes("ALTER TABLE"))).toBe(
    false,
  );
});
test("an absent consignment module still asks for full SQL 051 rather than suggesting the supplier-only patch", async () => {
  const db = {
    query: jest.fn().mockResolvedValue({ rows: [{ available: false }] }),
  };
  await expect(
    createSurgicalConsignmentService(db).checkSchema(),
  ).rejects.toMatchObject({
    statusCode: 503,
    message: expect.stringContaining("SQL 051"),
  });
});
test("an installed complete institute-scoped schema passes the preflight without DDL", async () => {
  const db = dbFor([]);
  await expect(
    createSurgicalConsignmentService(db).checkSchema(),
  ).resolves.toBeUndefined();
  expect(
    db.query.mock.calls.some(([sql]) => /ALTER|CREATE TABLE/i.test(sql)),
  ).toBe(false);
});
