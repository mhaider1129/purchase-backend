jest.mock("../config/db", () => ({ query: jest.fn() }));
const express = require("express");
const request = require("supertest");
const db = require("../config/db");
const router = require("../routes/tasks");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, role: req.headers["x-role"] || "SCM" };
  next();
});
app.use("/tasks", router);
beforeEach(() => db.query.mockReset());
test("task reads require deployed schema and perform no DDL", async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ relation: "employee_tasks" }] })
    .mockResolvedValueOnce({ rows: [{ id: 1, title: "Inspection" }] });
  const response = await request(app).get("/tasks/my");
  expect(response.status).toBe(200);
  expect(
    db.query.mock.calls.every(([sql]) => !/CREATE|ALTER|DROP/.test(sql)),
  ).toBe(true);
});
test("missing task table fails without provisioning", async () => {
  db.query.mockResolvedValue({ rows: [{ relation: null }] });
  const response = await request(app).get("/tasks/my");
  expect(response.status).toBe(503);
  expect(response.body.code).toBe("EMPLOYEE_TASKS_SCHEMA_MISSING");
  expect(db.query).toHaveBeenCalledTimes(1);
});
test("an employee cannot assign tasks", async () => {
  expect(
    (
      await request(app)
        .post("/tasks")
        .set("x-role", "Employee")
        .send({ title: "Task", assigned_to: 8 })
    ).status,
  ).toBe(403);
  expect(db.query).not.toHaveBeenCalled();
});
test("an employee cannot update another assignee task", async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ relation: "employee_tasks" }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ assigned_to: 8 }] });
  expect(
    (await request(app).patch("/tasks/1/status").send({ status: "completed" }))
      .status,
  ).toBe(403);
  expect(db.query.mock.calls.some(([sql]) => /^UPDATE/.test(sql))).toBe(false);
});
