jest.mock("../config/db", () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock("../utils/permissionService", () => ({
  ...jest.requireActual("../utils/permissionService"),
  getPermissionsForUserId: jest.fn(),
}));
const pool = require("../config/db"),
  { getPermissionsForUserId } = require("../utils/permissionService");
const fixture = require("./helpers/assignmentFixture");
const {
  splitAssignRequest,
} = require("../controllers/requests/assignRequestController");
let f;
beforeEach(() => {
  jest.clearAllMocks();
  f = fixture(pool, getPermissionsForUserId);
});
const response = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};
const req = (assignments) => ({
  params: { id: "55" },
  body: { assignments },
  user: { id: 7 },
});
test("assigns request items to multiple eligible users transactionally and keeps split notifications durable", async () => {
  const res = response();
  await splitAssignRequest(
    req([
      { user_id: 10, requested_item_ids: [100, 101], notes: "Urgent line" },
      { user_id: 11, requested_item_ids: [102] },
    ]),
    res,
  );
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      success: true,
      data: expect.objectContaining({ request_id: 55, assigned_to: null }),
    }),
  );
  expect(f.state.items.map((i) => i.assigned_to)).toEqual([10, 10, 11]);
  expect(f.state.outbox).toHaveLength(2);
  expect(f.state.cases[0].assigned_buyer_id).toBe(10);
});
test("duplicate split item IDs cannot partially change request/items/history", async () => {
  const res = response();
  await splitAssignRequest(
    req([
      { user_id: 10, requested_item_ids: [100, 101] },
      { user_id: 11, requested_item_ids: [101] },
    ]),
    res,
  );
  expect(res.status).toHaveBeenCalledWith(400);
  expect(f.state.items.every((i) => i.assigned_to === null)).toBe(true);
  expect(f.state.logs).toEqual([]);
  expect(f.state.outbox).toEqual([]);
});
test("partial split retains untouched assignees instead of falsely setting one whole-request owner", async () => {
  f.state.items[2].assigned_to = 11;
  const res = response();
  await splitAssignRequest(
    req([{ user_id: 10, requested_item_ids: [100, 101] }]),
    res,
  );
  expect(res.status).toHaveBeenCalledWith(200);
  expect(f.state.requests[0].assigned_to).toBeNull();
  expect(f.state.items[2].assigned_to).toBe(11);
});
test("foreign-request or rejected items cannot be selected through a local split", async () => {
  f.state.items[0].approval_status = "Rejected";
  let res = response();
  await splitAssignRequest(
    req([{ user_id: 10, requested_item_ids: [100] }]),
    res,
  );
  expect(res.status).toHaveBeenCalledWith(400);
  res = response();
  await splitAssignRequest(
    req([{ user_id: 10, requested_item_ids: [999] }]),
    res,
  );
  expect(res.status).toHaveBeenCalledWith(400);
  expect(f.state.logs).toEqual([]);
});
