const express = require("express"),
  request = require("supertest"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const mockService = {
  get: jest.fn(),
  read: jest.fn(),
  attach: jest.fn(),
  download: jest.fn(),
};
jest.mock("../services/surgicalConsignmentService", () => ({
  createSurgicalConsignmentService: () => mockService,
}));
jest.mock("../config/db", () => ({ query: jest.fn() }));
let directory, app;
beforeEach(async () => {
  jest.clearAllMocks();
  directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "surgical-private-test-"),
  );
  process.env.SURGICAL_CONSIGNMENT_PRIVATE_DIR = directory;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, institute_id: 2 };
    next();
  });
  app.use("/surgical-consignments", require("../routes/surgicalConsignments"));
  app.use((e, req, res, next) =>
    res.status(e.statusCode || 500).json({ message: e.message }),
  );
  mockService.get.mockResolvedValue({ clinical_access: true });
  mockService.attach.mockImplementation(async (a, id, f) => ({
    id,
    clinical_access: true,
    files: [{ id: 3, file_name: f.file_name, purpose: f.purpose }],
  }));
});
afterEach(async () => {
  delete process.env.SURGICAL_CONSIGNMENT_PRIVATE_DIR;
  await fs.rm(directory, { recursive: true, force: true });
});
test("clinical PDFs are stored privately with random names and restrictive permissions, not global attachments", async () => {
  const response = await request(app)
    .post("/surgical-consignments/4/files")
    .field("purpose", "RECEIPT")
    .attach("file", Buffer.from("%PDF clinical fixture"), "signed-receipt.pdf");
  expect(response.status).toBe(201);
  const files = await fs.readdir(directory);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[a-f0-9-]{36}\.pdf$/);
  expect((await fs.stat(path.join(directory, files[0]))).mode & 0o777).toBe(
    0o600,
  );
  expect(response.body.files[0]).not.toHaveProperty("storage_name");
  mockService.download.mockResolvedValue({
    storage_name: files[0],
    file_name: "signed-receipt.pdf",
  });
  const downloaded = await request(app).get(
    "/surgical-consignments/4/files/3/download",
  );
  expect(downloaded.status).toBe(200);
  expect(downloaded.headers["cache-control"]).toBe("no-store");
  expect(downloaded.headers["content-disposition"]).toContain("attachment");
});
test("finance-only access cannot upload clinical files", async () => {
  mockService.get.mockResolvedValue({ clinical_access: false });
  const response = await request(app)
    .post("/surgical-consignments/4/files")
    .field("purpose", "USAGE")
    .attach("file", Buffer.from("private"), "clinical.pdf");
  expect(response.status).toBe(403);
  expect(await fs.readdir(directory)).toEqual([]);
  expect(mockService.attach).not.toHaveBeenCalled();
});
test("failed metadata transactions remove the newly stored private blob", async () => {
  mockService.attach.mockRejectedValue(
    Object.assign(new Error("Attachment not committed"), { statusCode: 409 }),
  );
  const response = await request(app)
    .post("/surgical-consignments/4/files")
    .field("purpose", "RECEIPT")
    .attach("file", Buffer.from("private"), "clinical.pdf");
  expect(response.status).toBe(409);
  expect(await fs.readdir(directory)).toEqual([]);
});
test("a configured public uploads directory is refused for clinical files", async () => {
  process.env.SURGICAL_CONSIGNMENT_PRIVATE_DIR = path.resolve(
    __dirname,
    "../uploads/surgical-unsafe",
  );
  const response = await request(app)
    .post("/surgical-consignments/4/files")
    .field("purpose", "RECEIPT")
    .attach("file", Buffer.from("private"), "clinical.pdf");
  expect(response.status).toBe(503);
  expect(mockService.attach).not.toHaveBeenCalled();
});
test("a guessed file cannot be downloaded without case authorization", async () => {
  mockService.download.mockRejectedValue(
    Object.assign(new Error("Clinical assignment required"), {
      statusCode: 403,
    }),
  );
  expect(
    (await request(app).get("/surgical-consignments/4/files/3/download"))
      .status,
  ).toBe(403);
});

test("empty evidence cannot satisfy a clinical signed-document requirement", async () => {
  const response = await request(app)
    .post("/surgical-consignments/4/files")
    .field("purpose", "RECEIPT")
    .attach("file", Buffer.alloc(0), "empty.pdf");
  expect(response.status).toBe(400);
  expect(mockService.attach).not.toHaveBeenCalled();
  expect(await fs.readdir(directory)).toEqual([]);
});
