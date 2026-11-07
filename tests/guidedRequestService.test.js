jest.mock("../utils/permissionService", () => ({
  getPermissionsForUserId: jest.fn(async () => ({ permissions: [] })),
  userHasPermission: jest.fn(() => false),
}));
jest.mock("../controllers/utils/approvalRoutes", () => ({
  fetchApprovalRoutes: jest.fn(async () => [
    { role: "HOD", approval_level: 1 },
    { role: "SCM", approval_level: 2 },
  ]),
}));
const service = require("../services/guidedRequestService");
const user = {
  id: 1,
  name: "Requester",
  role: "requester",
  institute_id: 1,
  department_id: 2,
  section_id: null,
  warehouse_id: 4,
  can_request_medication: true,
  department_type: "medical",
};
const payload = (family) => ({
  family: family.id,
  category_id: 1,
  purpose: "routine",
  required_by: "2099-01-01",
  justification: "Department requirement",
  operational_impact: "Service interruption",
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
              : "Evidence",
    ]),
  ),
  client_submission_key: "guided-command-123",
  items: [
    {
      request_mode: "generic_item",
      generic_item_id: 10,
      quantity: 2,
      unit_cost: 0,
    },
  ],
});
const runner = (overrides = {}) => ({
  query: jest.fn(async (sql) => ({
    rows: sql.includes("FROM users u")
      ? [{ ...user, ...overrides }]
      : sql.includes("FROM item_categories")
        ? [{ id: 1, name: "Clinical" }]
        : sql.includes("FROM scop_request_purposes")
          ? [{ code: "routine", label: "Routine" }]
          : sql.includes("FROM contract_items")
            ? []
            : sql.includes("FROM generic_items")
              ? [
                  {
                    generic_name: "Catalog item",
                    inventory_uom: "Piece",
                    category_id: 1,
                    item_type: overrides.itemType || "general_item",
                  },
                ]
              : [{ id: 4 }],
  })),
});
beforeEach(() => {
  process.env.GUIDED_REQUESTS_ENABLED = "true";
});
afterAll(() => {
  delete process.env.GUIDED_REQUESTS_ENABLED;
});
test.each(service.FAMILIES)(
  "$id uses canonical type, department and required date",
  async (family) => {
    const r = runner({
      itemType:
        family.id === "medication"
          ? "medication"
          : family.id === "device"
            ? "medical_device"
            : "general_item",
    });
    const result = await service.prepare(r, 1, payload(family));
    expect(result.body.request_type).toBe(family.request_type);
    expect(result.body.target_department_id).toBe(2);
    expect(result.body.items[0].required_date).toBe("2099-01-01");
    expect(result.body.items[0].specs).toContain(`Family: ${family.id}`);
  },
);
test("disabled flag blocks direct API service access", async () => {
  delete process.env.GUIDED_REQUESTS_ENABLED;
  await expect(service.options(runner(), 1)).rejects.toMatchObject({
    statusCode: 404,
  });
});
test.each([{ role: "SCM" }, { can_request_medication: false }])(
  "medication preserves canonical eligibility %j",
  async (override) => {
    await expect(
      service.prepare(runner(override), 1, payload(service.FAMILIES[2])),
    ).rejects.toMatchObject({ statusCode: 403 });
  },
);
test("warehouse replenishment requires assigned warehouse", async () => {
  await expect(
    service.prepare(
      runner({ warehouse_id: null }),
      1,
      payload(service.FAMILIES[1]),
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
});
test.each([0, -1, 1.5, "NaN", Infinity])(
  "quantity %s rejected",
  async (qty) => {
    const p = payload(service.FAMILIES[0]);
    p.items[0].quantity = qty;
    await expect(service.prepare(runner(), 1, p)).rejects.toMatchObject({
      statusCode: 400,
    });
  },
);
test.each([
  "institute_id",
  "target_department_id",
  "requester_id",
  "patient_name",
])("client cannot supply %s", async (key) => {
  const p = payload(service.FAMILIES[0]);
  p[key] = 99;
  await expect(service.prepare(runner(), 1, p)).rejects.toMatchObject({
    statusCode: 400,
  });
});
test("patient identifiers rejected in specialized fields", async () => {
  const p = payload(service.FAMILIES.find((f) => f.id === "procedure"));
  p.specialized.mrn = "secret";
  await expect(service.prepare(runner(), 1, p)).rejects.toMatchObject({
    statusCode: 400,
  });
});
test("medication catalog item cannot take general approval route", async () => {
  await expect(
    service.prepare(
      runner({ itemType: "medication" }),
      1,
      payload(service.FAMILIES[0]),
    ),
  ).rejects.toMatchObject({ statusCode: 400 });
});
test("preview reuses active approval resolver; roles are estimates", async () => {
  const p = payload(service.FAMILIES[0]);
  const result = await service.preview(runner(), 1, p);
  expect(result).toMatchObject({
    estimated: true,
    approvals: [
      { role: "HOD", level: 1 },
      { role: "SCM", level: 2 },
    ],
  });
});
test("commit revalidates and locks requester/catalog", async () => {
  const p = payload(service.FAMILIES[0]);
  const r = runner();
  const initial = await service.prepare(r, 1, p);
  await service.verifyForCommit(
    r,
    { payload: p, body: initial.body },
    initial.user,
  );
  expect(
    r.query.mock.calls.some(([sql]) => sql.includes("FOR SHARE OF u,d")),
  ).toBe(true);
  await expect(
    service.verifyForCommit(
      runner({ department_id: 9 }),
      { payload: p, body: initial.body },
      initial.user,
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("SAP unavailable, options eligibility, no fake balances", async () => {
  const result = await service.options(
    runner({ can_request_medication: false }),
    1,
  );
  expect(result.sap_inventory).toEqual({
    available: false,
    reason: "NO_VERIFIED_SYNCHRONIZATION",
  });
  expect(result.families.find((f) => f.id === "medication").enabled).toBe(
    false,
  );
});

test("covered stock requirements hand off to existing contracted-item controls", async () => {
  const r = runner();
  const query = r.query.getMockImplementation();
  r.query.mockImplementation(async (sql) =>
    sql.includes("FROM contract_items") ? { rows: [{ id: 1 }] } : query(sql),
  );
  await expect(
    service.prepare(r, 1, payload(service.FAMILIES[1])),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("unassigned approval role cannot silently auto-approve a guided submission", async () => {
  await expect(
    service.assertResolvedRoute(
      { query: async () => ({ rows: [{ id: 1 }] }) },
      1,
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("resolved approvals preserve canonical approval decisions", async () => {
  await expect(
    service.assertResolvedRoute({ query: async () => ({ rows: [] }) }, 1),
  ).resolves.toBeUndefined();
});
