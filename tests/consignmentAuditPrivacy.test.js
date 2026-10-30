const express = require("express"),
  request = require("supertest"),
  pool = require("../config/db");
jest.mock("../config/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));
jest.mock("../utils/capabilityPolicyService", () => ({
  resolveCapability: jest
    .fn()
    .mockResolvedValue({
      module: "surgical",
      resource: "consignment",
      action: "create",
      permissions: [],
    }),
}));
jest.mock("../services/surgicalConsignmentService", () => ({
  createSurgicalConsignmentService: () => ({
    create: jest
      .fn()
      .mockResolvedValue({ id: 7, status: "AWAITING_AUTHORIZATION" }),
  }),
}));
const { writeAuditTrail } = require("../middleware/writeAuditTrail");
test("actual clinical route supplies non-clinical transport metadata instead of MRN/procedure/body", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, role: "Requester", institute_id: 2 };
    next();
  });
  app.use(writeAuditTrail);
  app.use(
    "/api/surgical-consignments",
    require("../routes/surgicalConsignments"),
  );
  const response = await request(app)
    .post("/api/surgical-consignments")
    .send({
      patient_mrn: "PRIVATE-TEST-MRN",
      procedure_type: "Private procedure",
      notes: "Clinical notes also stay out of transport audit",
    });
  expect(response.status).toBe(201);
  await new Promise((resolve) => setImmediate(resolve));
  const call = pool.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO governance_audit_trail"),
  );
  expect(JSON.parse(call[1][12])).toEqual({
    module: "surgical_consignment",
    operation: "POST",
  });
  expect(JSON.stringify(call)).not.toContain("PRIVATE-TEST-MRN");
  expect(JSON.stringify(call)).not.toContain("Private procedure");
  expect(JSON.stringify(call)).not.toContain("Clinical notes");
});
