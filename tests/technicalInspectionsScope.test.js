jest.mock("../config/db", () => ({ query: jest.fn() }));
jest.mock("../utils/ensureTechnicalInspectionsTable", () =>
  jest.fn().mockResolvedValue(),
);
jest.mock("../utils/technicalInspectionStatus", () => ({
  applyRequestStatusFromInspections: jest.fn(),
  getInspectionSummaryForRequest: jest.fn(),
}));
const pool = require("../config/db");
const controller = require("../controllers/technicalInspectionsController");
const request = (extra = {}) => ({
  user: { id: 1, institute_id: 7, name: "Inspector" },
  query: {},
  params: { id: "99" },
  body: {},
  ...extra,
});
const response = () => {
  const res = { json: jest.fn(), send: jest.fn() };
  res.status = jest.fn(() => res);
  return res;
};
beforeEach(() => {
  pool.query.mockReset();
});
test.each([
  "getTechnicalInspectionById",
  "updateTechnicalInspection",
  "deleteTechnicalInspection",
])("%s cannot act on a foreign inspection", async (method) => {
  pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  const next = jest.fn();
  await controller[method](request(), response(), next);
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 404 }),
  );
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.query.mock.calls[0][0]).toContain(
    "scope_request.institute_id=$1",
  );
  expect(pool.query.mock.calls[0][1]).toEqual([7, 99]);
});
test("an institute is mandatory before legacy schema initialization or data access", async () => {
  const next = jest.fn();
  await controller.listTechnicalInspections(
    request({ user: { id: 1 } }),
    response(),
    next,
  );
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 403 }),
  );
  expect(pool.query).not.toHaveBeenCalled();
});
test("historical list filters remain ANDed with institute ownership", async () => {
  pool.query.mockResolvedValue({ rows: [] });
  await controller.listTechnicalInspections(
    request({ query: { search: "pump" } }),
    response(),
    jest.fn(),
  );
  const [sql, values] = pool.query.mock.calls[0];
  expect(sql).toContain("scope_creator.institute_id=$1");
  expect(sql).toContain("AND (LOWER(item_name)");
  expect(values).toEqual([7, "%pump%"]);
});
test("legacy creation refuses a requested item linked to a different request", async () => {
  pool.query.mockResolvedValue({
    rows: [{ id: 8, request_id: 23 }],
    rowCount: 1,
  });
  const next = jest.fn();
  await controller.createTechnicalInspection(
    request({
      body: { item_name: "Pump", request_id: 22, requested_item_id: 8 },
    }),
    response(),
    next,
  );
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 400 }),
  );
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.query.mock.calls[0][1]).toEqual([8, 7]);
});
