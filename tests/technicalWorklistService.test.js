const {
  createTechnicalWorklistService,
} = require("../services/technicalWorklistService");
const actor = { id: 5, institute_id: 7, role: "HOD", permissions: [] };
const ready = { reviews: true, legacy: true };
const harness = (available = ready) => {
  const database = {
    query: jest
      .fn()
      .mockResolvedValueOnce({ rows: [available] })
      .mockResolvedValue({
        rows: [{ rows: [], total: 0, summary: {}, departments: [] }],
      }),
  };
  return { database, list: createTechnicalWorklistService(database) };
};
test("missing or invalid institute scope is rejected before database reads", async () => {
  const h = harness();
  await expect(h.list({ ...actor, institute_id: null })).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(h.database.query).not.toHaveBeenCalled();
});
test.each([
  { from: "2026-02-31" },
  { from: "2026-10-03", to: "2026-10-02" },
  { type: "DELIVERY" },
  { status: "ANY" },
  { department: "1 OR true" },
  { page: -1 },
  { tab: "x" },
])("rejects invalid worklist filters %p", async (filter) => {
  const h = harness();
  await expect(h.list(actor, filter)).rejects.toMatchObject({
    statusCode: 400,
  });
  expect(h.database.query).not.toHaveBeenCalled();
});
test("assigned users read only scoped review tasks; legacy manage permission is not inferred from department roles", async () => {
  const h = harness();
  await h.list(actor, {
    search: "device",
    from: "2026-10-01",
    to: "2026-10-30",
    department: 9,
    tab: "pending",
  });
  const [sql, values] = h.database.query.mock.calls[1];
  expect(sql).toContain("own.reviewer_id=$2");
  expect(sql).toContain("u.department_id=own.department_id");
  expect(sql).not.toContain("FROM technical_inspections i");
  expect(sql).toContain("Asia/Baghdad");
  expect(sql).toContain("FROM filtered");
  expect(values).toEqual([
    7,
    5,
    false,
    "%device%",
    9,
    "2026-10-01",
    "2026-10-30",
    0,
  ]);
});
test("legacy-only deployments remain readable without requiring the optional pre-procurement migration", async () => {
  const h = harness({ reviews: false, legacy: true });
  const result = await h.list({
    ...actor,
    permissionSet: undefined,
    permissions: ["technical-inspections.manage"],
  });
  expect(result.warnings).toHaveLength(1);
  expect(h.database.query.mock.calls[1][0]).toContain(
    "creator.institute_id=$1",
  );
  expect(h.database.query.mock.calls[1][0]).not.toContain(
    "FROM preprocurement_technical_reviews",
  );
});
test("missing optional schemas return explicit empty results without executing DDL", async () => {
  const h = harness({ reviews: false, legacy: false });
  const result = await h.list(actor);
  expect(result.total).toBe(0);
  expect(result.summary.awaiting_my_review).toBe(0);
  expect(result.warnings).toHaveLength(1);
  expect(h.database.query).toHaveBeenCalledTimes(1);
});
