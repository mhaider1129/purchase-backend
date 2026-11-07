jest.mock("../config/db", () => ({ connect: jest.fn() }));
jest.mock("../services/scopFoundationService", () => ({
  requireEnabled: jest.fn(),
  get: jest.fn(),
  command: jest.fn(),
  classifications: jest.fn(),
}));
const express = require("express"),
  request = require("supertest");
const service = require("../services/scopFoundationService");
const pool = require("../config/db");
const app = () => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user = { id: 1, permissions: ["scop.allocations.manage"] };
    next();
  });
  a.use("/api/scop", require("../routes/scopFoundation"));
  a.use((e, _req, res, _next) =>
    res.status(e.statusCode || 500).json({ code: e.code }),
  );
  return a;
};
beforeEach(() => jest.clearAllMocks());
test("disabled feature blocks all new endpoints without a database connection", async () => {
  service.requireEnabled.mockImplementation(() => {
    throw Object.assign(new Error("off"), {
      statusCode: 404,
      code: "SCOP_DISABLED",
    });
  });
  expect((await request(app()).get("/api/scop/classifications")).status).toBe(
    404,
  );
  expect(pool.connect).not.toHaveBeenCalled();
  expect(service.classifications).not.toHaveBeenCalled();
});
test("route preserves canonical IDs and actor and returns service data", async () => {
  service.requireEnabled.mockImplementation(() => {});
  service.command.mockResolvedValue({ id: "7" });
  const res = await request(app())
    .post("/api/scop/requests/1/items/requested_item/2/allocations/7/cancel")
    .send({ command_key: "k", expected_revision: 1, reason: "cancel unused" });
  expect(res.status).toBe(200);
  expect(service.command).toHaveBeenCalledWith(
    expect.objectContaining({ id: 1 }),
    expect.objectContaining({
      requestId: "1",
      itemKind: "requested_item",
      itemId: "2",
      allocationId: "7",
    }),
    "cancel",
    expect.objectContaining({ command_key: "k" }),
  );
});
