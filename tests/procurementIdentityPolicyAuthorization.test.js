const express = require("express");
const request = require("supertest");
jest.mock("../config/db", () => ({ query: jest.fn(), connect: jest.fn() }));
const pool = require("../config/db");
const routes = require("../routes/itemMaster");
function app(allowed) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = {
      id: 1,
      hasPermission: (code) => allowed && code === "permissions.manage",
    };
    next();
  });
  server.use("/item-master", routes);
  server.use((err, _req, res, _next) =>
    res
      .status(err.statusCode || 500)
      .json({ message: err.message, code: err.code }),
  );
  return server;
}
beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockResolvedValue({ rows: [{ available: false }] });
});
test("a viewer can read effective strict mode but cannot change policy", async () => {
  await request(app(false))
    .get("/item-master/procurement-policy")
    .expect(200, { enforce_item_identity: true, configured: false });
  pool.query.mockClear();
  await request(app(false))
    .put("/item-master/procurement-policy")
    .send({ enforce_item_identity: false, reason: "Setup" })
    .expect(403);
  expect(pool.connect).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
});
test("administrator receives actionable migration error and transaction rolls back", async () => {
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [{ available: false }] }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  const result = await request(app(true))
    .put("/item-master/procurement-policy")
    .send({ enforce_item_identity: false, reason: "Setup" })
    .expect(503);
  expect(result.body.code).toBe("IDENTITY_POLICY_SCHEMA_MISSING");
  expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  expect(client.release).toHaveBeenCalled();
});
