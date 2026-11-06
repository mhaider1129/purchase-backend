jest.mock("../config/db", () => ({ connect: jest.fn() }));
jest.mock("../utils/ensureCentralSupplyChainTrackingColumns", () => jest.fn());
jest.mock("../services/auditService", () => ({ writeAuditEvent: jest.fn() }));
jest.mock("../services/p2pAuthorization", () => ({ loadActor: jest.fn() }));
const pool = require("../config/db"),
  auth = require("../services/p2pAuthorization"),
  audit = require("../services/auditService");
const {
  updateCentralSupplyChainStatus: update,
} = require("../controllers/requests/centralSupplyChainController");
function harness({ wasSent = false, sent = true, found = true } = {}) {
  const before = {
    id: 42,
    institute_id: 3,
    sent_to_central_supply_at: wasSent ? "2026-11-06T00:00:00Z" : null,
    sent_to_central_supply_by: wasSent ? 7 : null,
  };
  const after = {
    ...before,
    sent_to_central_supply_at: sent ? "2026-11-06T01:00:00Z" : null,
    sent_to_central_supply_by: sent ? 7 : null,
  };
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (String(sql).includes("SELECT id, institute_id"))
        return { rowCount: found ? 1 : 0, rows: found ? [before] : [] };
      if (String(sql).includes("UPDATE public.requests"))
        return { rowCount: 1, rows: [after] };
      return {};
    }),
  };
  pool.connect.mockResolvedValue(client);
  const req = {
    params: { id: "42" },
    body: { sent },
    user: { id: 7, institute_id: 999 },
  };
  const res = { json: jest.fn() },
    next = jest.fn();
  return {
    before,
    after,
    client,
    req,
    res,
    next,
    run: () => update(req, res, next),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  auth.loadActor.mockResolvedValue({ id: 7, institute_id: 3 });
  audit.writeAuditEvent.mockResolvedValue({});
});
test.each([
  [false, true],
  [true, false],
])("atomic transition %s to %s", async (wasSent, sent) => {
  const h = harness({ wasSent, sent });
  await h.run();
  expect(h.next).not.toHaveBeenCalled();
  expect(h.client.query).toHaveBeenCalledWith(
    expect.stringContaining("institute_id = $2"),
    [42, 3],
  );
  expect(auth.loadActor).toHaveBeenCalledWith(
    h.client,
    h.req.user,
    "requests.manage",
  );
  expect(audit.writeAuditEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      client: h.client,
      instituteId: 3,
      actorUserId: 7,
      beforeData: expect.objectContaining({ sent: wasSent }),
      afterData: expect.objectContaining({ sent }),
    }),
  );
  expect(h.client.query).toHaveBeenLastCalledWith("COMMIT");
  expect(h.res.json).toHaveBeenCalledWith(h.after);
});
test.each([false, true])(
  "duplicate sent=%s is a stable no-op",
  async (sent) => {
    const h = harness({ wasSent: sent, sent });
    await h.run();
    expect(audit.writeAuditEvent).not.toHaveBeenCalled();
    expect(
      h.client.query.mock.calls.some(([q]) => /^\s*UPDATE\b/i.test(q)),
    ).toBe(false);
    expect(h.res.json).toHaveBeenCalledWith(h.before);
  },
);
test("foreign records remain not found", async () => {
  const h = harness({ found: false });
  await h.run();
  expect(h.next).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 404 }),
  );
  expect(audit.writeAuditEvent).not.toHaveBeenCalled();
});
test.each(["unauthorized", "inactive", "null institute"])(
  "fresh authorization rejects %s",
  async () => {
    const h = harness();
    auth.loadActor.mockRejectedValue(
      Object.assign(new Error("denied"), { statusCode: 403 }),
    );
    await h.run();
    expect(h.client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(h.next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
    expect(h.res.json).not.toHaveBeenCalled();
  },
);
test.each(["42P01", "42703", "23502", "22P02", "AUDIT_ERROR"])(
  "required audit failure %s rolls back",
  async (code) => {
    const h = harness();
    audit.writeAuditEvent.mockRejectedValue(
      Object.assign(new Error("failed"), { code }),
    );
    await h.run();
    expect(h.client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(h.res.json).not.toHaveBeenCalled();
  },
);
test("legacy request log failure is isolated after mandatory audit", async () => {
  const h = harness();
  const query = h.client.query.getMockImplementation();
  h.client.query.mockImplementation(async (...args) => {
    if (args[0].includes("INSERT INTO public.request_logs"))
      throw new Error("legacy schema");
    return query(...args);
  });
  await h.run();
  expect(audit.writeAuditEvent).toHaveBeenCalled();
  expect(h.client.query).toHaveBeenCalledWith(
    "ROLLBACK TO SAVEPOINT central_supply_request_log",
  );
  expect(h.client.query).toHaveBeenLastCalledWith("COMMIT");
});
test("malformed command never connects", async () => {
  const h = harness();
  h.req.body.sent = "true";
  await h.run();
  expect(pool.connect).not.toHaveBeenCalled();
  expect(h.next).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 400 }),
  );
});
