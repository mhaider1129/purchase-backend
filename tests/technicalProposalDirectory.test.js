const directory = require("../services/technicalProposalDirectory");
const actor = {
  id: 1,
  institute_id: 7,
  role: "SCM",
  permissions: ["technical-inspections.manage"],
};
test("reports exactly which scope column is missing before querying the directory", async () => {
  const db = {
    query: jest
      .fn()
      .mockResolvedValue({ rows: [{ table_name: "approved_products" }] }),
  };
  await expect(directory.load(db, actor)).rejects.toMatchObject({
    statusCode: 503,
    code: "TECHNICAL_PROPOSAL_SCHEMA_REQUIRED",
    message: expect.stringContaining("public.approved_products.institute_id"),
  });
  expect(db.query).toHaveBeenCalledTimes(1);
});
test("requires manager authority before schema or directory access", async () => {
  const db = { query: jest.fn() };
  await expect(
    directory.load(db, { ...actor, role: "Requester", permissions: [] }),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(db.query).not.toHaveBeenCalled();
});
test("includes shared catalog entries while retaining explicit institute filters", async () => {
  const db = {
    query: jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 11 }] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ id: 13 }] }),
  };
  await expect(directory.load(db, actor)).resolves.toEqual({
    quotations: [{ id: 11 }],
    suppliers: [{ id: 12 }],
    products: [{ id: 13 }],
  });
  for (const [sql, args] of db.query.mock.calls.slice(1)) {
    expect(args).toEqual([7]);
    expect(sql).toContain("institute_id=$1");
    expect(sql).toContain("institute_id IS NULL");
  }
});
