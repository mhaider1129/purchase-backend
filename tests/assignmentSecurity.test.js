jest.mock("../config/db", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../utils/permissionService", () => ({
  ...jest.requireActual("../utils/permissionService"),
  getPermissionsForUserId: jest.fn(),
}));
jest.mock("../utils/emailService", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../middleware/authMiddleware", () => ({
  authenticateUser: async (req, res, next) => {
    if (!req.headers.authorization)
      return res.status(401).json({ message: "Authentication required" });
    const id = Number(req.headers.authorization),
      grants =
        await require("../utils/permissionService").getPermissionsForUserId(id);
    req.user = { id, permissions: grants.permissions };
    next();
  },
}));
const pool = require("../config/db"),
  { getPermissionsForUserId } = require("../utils/permissionService"),
  { sendEmail } = require("../utils/emailService");
const fixture = require("./helpers/assignmentFixture"),
  assignment = require("../services/procurementAssignmentService"),
  auto = require("../services/requestAutoAssignmentService");
const { deliverInApp } = require("../services/notificationOutboxProcessor"),
  {
    buyerWorkload,
  } = require("../services/procurementPerformance/procurementMetricsService");
const express = require("express"),
  request = require("supertest"),
  handlers = require("../controllers/requests/assignRequestController");
const { authenticateUser } = require("../middleware/authMiddleware"),
  permission = require("../middleware/requirePermission");
const app = express();
app.use(express.json());
app.use("/rules", require("../routes/requestAutoAssignmentRules"));
app.put(
  "/manual",
  authenticateUser,
  permission("requests.manage"),
  handlers.assignRequestToUser,
);
app.put(
  "/legacy",
  authenticateUser,
  permission("requests.manage"),
  handlers.assignRequestLegacy,
);
app.put(
  "/split/:id",
  authenticateUser,
  permission("requests.manage"),
  handlers.splitAssignRequest,
);
app.get(
  "/history/:id",
  authenticateUser,
  require("../controllers/requests/fetchRequestsController").getRequestLogs,
);
app.get('/directory',authenticateUser,require('../controllers/requests/fetchRequestsController').getProcurementUsers);
app.use((e, req, res, next) =>
  res
    .status(e.statusCode || 500)
    .json({ message: e.statusCode ? e.message : "Internal error" }),
);
let f;
beforeEach(() => {
  jest.clearAllMocks();
  f = fixture(pool, getPermissionsForUserId);
});
const manual = (userId = 10, extra = {}) =>
  assignment.assign({
    requestId: 55,
    actor: { id: 7 },
    method: "manual",
    assignments: [{ user_id: userId }],
    ...extra,
  });
const automatic = (actorId = 7, requestId = 55) =>
  f.automatic((c) =>
    auto.applyAutoAssignmentForApprovedRequest(
      c,
      {
        id: requestId,
        institute_id: 999,
        assigned_to: 999,
        request_type: "IT",
      },
      actorId,
    ),
  );
const body = {
  request_type: "Non-Stock",
  assignee_user_id: 10,
  is_active: true,
};
const put = (path, data, actor = 7) =>
  request(app).put(path).set("Authorization", String(actor)).send(data);
const postRule = (data) =>
  request(app).post("/rules").set("Authorization", "7").send(data);
test("anonymous and role-only accounts lack assignment authority", async () => {
  expect((await request(app).get("/rules")).status).toBe(401);
  expect(
    (await request(app).get("/rules").set("Authorization", "15")).status,
  ).toBe(403);
  expect(
    (await put("/manual", { request_id: 55, user_id: 10 }, 15)).status,
  ).toBe(403);
  expect(f.state.logs).toEqual([]);
});
test("server grants override forged permissions and institute claims", async () => {
  f.state.users[0].permissions = [];
  await expect(
    manual(10, {
      actor: { id: 7, institute_id: 2, permissions: ["requests.manage"] },
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
});
test("foreign source request and assignee are rejected", async () => {
  await expect(manual(12)).rejects.toMatchObject({ statusCode: 404 });
  await expect(manual(10, { requestId: 56 })).rejects.toMatchObject({
    statusCode: 404,
  });
  expect(f.state.logs).toEqual([]);
});
test("cross-institute assignment needs explicit capability plus bounded target scope", async () => {
  f.state.users[0].permissions.push("requests.cross-institute");
  await expect(manual(12, { requestId: 56 })).rejects.toMatchObject({
    statusCode: 404,
  });
  f.state.users[0].scopes = { institute_ids: [2] };
  expect((await manual(12, { requestId: 56 })).assigned_to).toBe(12);
  expect(f.state.audits[0].instituteId).toBe(2);
});
test.each([13, 14, 15])(
  "inactive, non-staff or revoked-capability recipient %s cannot receive work",
  async (user) => {
    await expect(manual(user)).rejects.toMatchObject({
      statusCode: user === 13 ? 404 : 400,
    });
    expect(f.state.outbox).toEqual([]);
  },
);
test("newly deactivated assignee is reloaded before assignment", async () => {
  f.state.users.find((u) => u.id === 10).is_active = false;
  await expect(manual()).rejects.toMatchObject({ statusCode: 404 });
  expect(f.state.requests[0].assigned_to).toBeNull();
});
test("automatic routing uses actual stored institute/type, not supplied hints", async () => {
  expect((await automatic()).assigned_request.assigned_to).toBe(10);
  expect(f.state.items.every((i) => i.assigned_to === 10)).toBe(true);
  expect(f.state.audits[0]).toMatchObject({
    actor_id: 7,
    instituteId: 1,
    metadata: { method: "automatic", ruleId: 1 },
  });
  expect(sendEmail).not.toHaveBeenCalled();
});
test("same Non-stock criterion resolves independently in two institutes", async () => {
  f.state.users.push({
    id: 8,
    institute_id: 2,
    is_active: true,
    role: "Assignment manager",
    permissions: ["requests.manage"],
  });
  expect((await automatic(8, 56)).assigned_request.assigned_to).toBe(12);
  expect(f.state.requests[0].assigned_to).toBeNull();
});
test("final approver can continue the preauthorized rule but cannot manually assign", async () => {
  expect((await automatic(20)).assigned_request.assigned_to).toBe(10);
  await expect(manual(11, { actor: { id: 20 } })).rejects.toMatchObject({
    statusCode: 403,
  });
  f.state.approvals = [];
  await expect(automatic(20)).rejects.toMatchObject({ statusCode: 403 });
});
test("Stock preserves exact warehouse routing and existing request-type aliases", async () => {
  f.state.requests[0].request_type = "Stock";
  f.state.requests[0].supply_warehouse_id = 8;
  f.state.rules.push({
    id: 5,
    institute_id: 1,
    request_type: "Stock",
    warehouse_id: 8,
    assignee_user_id: 11,
    is_active: true,
  });
  expect((await automatic()).assigned_request.assigned_to).toBe(11);
  expect(auto.normalizeRequestType("IT Item")).toBe("IT");
  expect(auto.normalizeRequestType("Printing Logbook")).toBe("Logbook");
  f.state.requests[0].supply_warehouse_id = 9;
  await expect(automatic()).rejects.toMatchObject({ statusCode: 404 });
});
test.each([
  "Cancelled",
  "Canceled",
  "Rejected",
  "Completed",
  "Received",
  "Available in Stock",
  "Submitted",
  "On Hold",
])("assignment is blocked for %s", async (status) => {
  f.state.requests[0].status = status;
  await expect(manual()).rejects.toMatchObject({ statusCode: 409 });
  await expect(automatic()).rejects.toMatchObject({ statusCode: 409 });
  expect(f.state.logs).toEqual([]);
});
test.each(["Pending", "On Hold", "Rejected"])(
  "unresolved %s approval blocks an Approved request",
  async (status) => {
    f.state.approvals.push({ id: 6, request_id: 55, approver_id: 9, status });
    await expect(manual()).rejects.toMatchObject({ statusCode: 409 });
    expect(f.state.outbox).toEqual([]);
  },
);
test("manual/legacy reassignment preserves request authority and assignment history", async () => {
  expect(
    (await put("/manual", { request_id: 55, user_id: 10, institute_id: 2 }))
      .status,
  ).toBe(200);
  expect((await put("/legacy", { request_id: 55, user_id: 11 })).status).toBe(
    200,
  );
  expect(f.state.requests[0]).toMatchObject({
    institute_id: 1,
    requester_id: 90,
    status: "Approved",
    assigned_to: 11,
  });
  expect(f.state.logs.map((l) => l.action)).toEqual([
    "assigned_to_procurement",
    "reassigned_to_procurement",
  ]);
  expect(f.state.audits[1].beforeData.assigned_to).toBe(10);
  expect(f.state.audits[1].afterData.assigned_to).toBe(11);
  expect(f.state.approvals[0].status).toBe("Approved");
});
test("duplicate concurrent execution produces one assignment and one outbox event", async () => {
  await Promise.all([manual(), manual(), manual()]);
  expect(f.state.logs).toHaveLength(1);
  expect(f.state.outbox).toHaveLength(1);
  expect((await automatic()).changed).toBe(false);
  expect(f.state.outbox).toHaveLength(1);
});
test("explicit stale simultaneous reassignment cannot overwrite the accepted change", async () => {
  await manual();
  const results = await Promise.allSettled([
    manual(11, { expectedAssigneeId: 10 }),
    manual(10, { expectedAssigneeId: 10 }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected").reason).toMatchObject({
    statusCode: 409,
    code: "ASSIGNMENT_STALE",
  });
  expect(f.state.requests[0].assigned_to).toBe(11);
});
test("audit failure rolls back request/items/cases/history without notification", async () => {
  f.state.failAudit = true;
  await expect(manual()).rejects.toThrow("Audit failure");
  expect(f.state.requests[0].assigned_to).toBeNull();
  expect(f.state.items.every((i) => i.assigned_to === null)).toBe(true);
  expect(f.state.cases[0].assigned_buyer_id).toBeNull();
  expect(f.state.logs).toEqual([]);
  expect(f.state.outbox).toEqual([]);
  expect(sendEmail).not.toHaveBeenCalled();
});
test("outbox failure rolls back assignment and audit", async () => {
  f.state.failOutbox = true;
  await expect(manual()).rejects.toThrow("Outbox failure");
  expect(f.state.audits).toEqual([]);
  expect(f.state.requests[0].assigned_to).toBeNull();
});
test("outer approval rollback emits no assignment email or durable event", async () => {
  await expect(
    f.automatic(async (c) => {
      await auto.applyAutoAssignmentForApprovedRequest(c, { id: 55 }, 20);
      throw Error("Approval failure");
    }),
  ).rejects.toThrow("Approval failure");
  expect(f.state.requests[0].assigned_to).toBeNull();
  expect(f.state.outbox).toEqual([]);
  expect(sendEmail).not.toHaveBeenCalled();
});
test("worker delivery is idempotent and rechecks current recipient eligibility", async () => {
  await manual();
  const event = JSON.parse(JSON.stringify(f.state.outbox[0]));
  await f.automatic((c) => deliverInApp(c, event));
  await f.automatic((c) => deliverInApp(c, event));
  expect(f.state.notifications).toHaveLength(1);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  await manual(11);
  const next = JSON.parse(JSON.stringify(f.state.outbox[1]));
  f.state.users.find((u) => u.id === 11).is_active = false;
  await f.automatic((c) => deliverInApp(c, next));
  expect(sendEmail).toHaveBeenCalledTimes(1);
});
test("existing cases follow the buyer with unchanged workload weights and no case creation", async () => {
  await manual();
  expect(buyerWorkload(f.state.cases, [])[10].workloadUnits).toBe(4);
  await manual(11);
  expect(buyerWorkload(f.state.cases, [])[11].workloadUnits).toBe(4);
  expect(f.state.cases).toHaveLength(1);
  expect(f.state.cases[0].complexity_score).toBe(40);
});
test("foreign or inconsistent active case ownership blocks all assignment writes", async () => {
  f.state.cases[0].institute_id = 2;
  await expect(manual()).rejects.toMatchObject({ statusCode: 409 });
  expect(f.state.requests[0].assigned_to).toBeNull();
});
test("rules, directories and references are institute scoped; forged ownership is not authority", async () => {
  let r = await request(app).get("/rules").set("Authorization", "7");
  expect(r.status).toBe(200);
  expect(r.body.rules.map((x) => x.id)).toEqual([1]);
  expect(r.body.assignees.map((x) => x.id)).toEqual([10, 11]);
  expect(r.body.warehouses.map((x) => x.id)).toEqual([8]);
  r = await postRule({ ...body, institute_id: 2 });
  expect(r.status).toBe(201);
  expect(r.body.rule.institute_id).toBe(1);
  expect((await put("/rules/2", body)).status).toBe(404);
  expect(
    (await request(app).delete("/rules/2").set("Authorization", "7")).status,
  ).toBe(404);
  expect((await postRule({ ...body, assignee_user_id: 12 })).status).toBe(404);
  expect(
    (await postRule({ ...body, request_type: "Stock", warehouse_id: 9 }))
      .status,
  ).toBe(404);
});
test("rule audit rollback and schema gates preserve unknown historical rules without DDL", async () => {
  f.state.failAudit = true;
  expect((await postRule({ ...body, assignee_user_id: 11 })).status).toBe(500);
  expect(f.state.rules.find((r) => r.id === 1).assignee_user_id).toBe(10);
  expect(f.state.rules.find((r) => r.id === 3).institute_id).toBeNull();
  f.state.schema = false;
  expect(
    (await request(app).get("/rules").set("Authorization", "7")).status,
  ).toBe(503);
  expect(f.statements.some((q) => /^(CREATE|ALTER|DROP)\b/.test(q.sql))).toBe(
    false,
  );
});
test("history checks the actual request before returning assignment records", async () => {
  await manual();
  let response = await request(app)
    .get("/history/55")
    .set("Authorization", "7");
  expect(response.status).toBe(200);
  expect(response.body).toHaveLength(1);
  response = await request(app).get("/history/56").set("Authorization", "7");
  expect(response.status).toBe(404);
  expect(response.text).not.toMatch(/Buyer/);
});

test("canonical in-stock effective completion blocks assignment while preserving stored status", async () => {
  f.state.requests[0].assignment_effective_status = "Available in Stock";
  await expect(manual()).rejects.toMatchObject({ statusCode: 409 });
  expect(f.state.requests[0].status).toBe("Approved");
  expect(f.state.logs).toEqual([]);
});
test("completed case ownership is historical and is not reassigned with open request items", async () => {
  f.state.cases[0].case_status = "DELIVERED";
  f.state.cases[0].assigned_buyer_id = 10;
  await manual(11);
  expect(f.state.cases[0].assigned_buyer_id).toBe(10);
  expect(f.state.requests[0].assigned_to).toBe(11);
});
test("stale split snapshots detect another item-level assignment even if the header remains split", async () => {
  const first = {
    method: "split",
    assignments: [{ user_id: 10, requested_item_ids: [100] }],
    expectedItemAssignees: { 100: null },
  };
  await manual(10, first);
  expect(f.state.requests[0].assigned_to).toBeNull();
  await expect(
    manual(11, {
      ...first,
      assignments: [{ user_id: 11, requested_item_ids: [100] }],
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "ASSIGNMENT_STALE" });
});
test("absent/ineligible automatic rule never falls back to an unowned or foreign rule", async () => {
  f.state.rules[0].is_active = false;
  expect(await automatic()).toBeNull();
  expect(f.state.logs).toEqual([]);
  f.state.rules[0].is_active = true;
  f.state.users.find((u) => u.id === 10).permissions = [];
  expect(await automatic()).toMatchObject({
    skipped: true,
    reason: "ineligible_assignee",
  });
  expect(f.state.outbox).toEqual([]);
});
test("ambiguous active automatic rules fail closed rather than selecting arbitrary staff", async () => {
  f.state.rules.push({ ...f.state.rules[0], id: 77, assignee_user_id: 11 });
  await expect(automatic()).rejects.toMatchObject({ statusCode: 409 });
  expect(f.state.logs).toEqual([]);
});
test("same-institute rule update/delete retains audit history and does not mutate another institute", async () => {
  expect(
    (await put("/rules/1", { ...body, assignee_user_id: 11 })).status,
  ).toBe(200);
  expect(
    (await request(app).delete("/rules/1").set("Authorization", "7")).status,
  ).toBe(200);
  expect(f.state.rules.some((r) => r.id === 2)).toBe(true);
  expect(f.state.audits.map((a) => a.action)).toEqual([
    "AUTO_ASSIGNMENT_RULE_UPDATED",
    "AUTO_ASSIGNMENT_RULE_DELETED",
  ]);
});

test("a changed configured rule retains the existing approved-request automatic reassignment policy", async () => {
  await manual();
  f.state.rules[0].assignee_user_id = 11;
  const result = await automatic();
  expect(result.assigned_to).toBe(11);
  expect(f.state.audits[1].metadata.method).toBe("automatic_reassignment");
});

test('requester and approver retain canonical history visibility while unrelated users cannot read it',async()=>{
 f.state.users.push({id:90,role:'Requester',institute_id:1,is_active:true,permissions:[]});await manual();
 expect((await request(app).get('/history/55').set('Authorization','90')).status).toBe(200);
 expect((await request(app).get('/history/55').set('Authorization','20')).status).toBe(200);
 expect((await request(app).get('/history/55').set('Authorization','14')).status).toBe(404);
});

test('directory scope follows the actual request only with explicit bounded cross-institute authority',async()=>{
 expect((await request(app).get('/directory').query({request_id:56}).set('Authorization','7')).status).toBe(404);
 f.state.users[0].permissions.push('requests.cross-institute');f.state.users[0].scopes={institute_ids:[2]};
 const result=await request(app).get('/directory').query({request_id:56,institute_id:999}).set('Authorization','7');expect(result.status).toBe(200);expect(result.body.map(u=>u.id)).toEqual([12]);
});
