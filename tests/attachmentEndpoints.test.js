const express = require("express"),
  request = require("supertest");
jest.mock("../config/db", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../utils/permissionService", () => ({
  getPermissionsForUserId: jest.fn(),
}));
jest.mock("../services/attachmentStorageAdapter", () => ({
  key: jest.fn((v) => {
    if (
      v.includes("..") ||
      v.includes("\\") ||
      v.includes("%") ||
      v.startsWith("/")
    )
      throw Object.assign(new Error("File not found"), { statusCode: 404 });
    return v;
  }),
  download: jest.fn(async (file, req, res) =>
    res.type("application/octet-stream").send("fixture content"),
  ),
  remove: jest.fn(async () => {}),
}));
jest.mock("../utils/attachmentStorage", () => ({
  storeAttachmentFile: jest.fn(async () => ({ objectKey: "uploads/new.pdf" })),
}));
jest.mock("../utils/attachmentSchema", () => ({
  insertAttachment: jest.fn(async () => ({ rows: [{ id: 31 }] })),
}));
jest.mock("../services/auditService", () => ({
  writeAuditEvent: jest.fn(async () => {}),
}));
jest.mock("../middleware/authMiddleware", () => ({
  authenticateUser: (req, res, next) => {
    if (!req.headers.authorization)
      return res.status(401).json({ message: "Authentication required" });
    req.user = { id: 1 };
    next();
  },
}));
const fixture = require("./helpers/attachmentFixture"),
  pool = require("../config/db"),
  perms = require("../utils/permissionService"),
  storage = require("../services/attachmentStorageAdapter"),
  uploads = require("../utils/attachmentStorage"),
  audit = require("../services/auditService");
const canonical = require("../controllers/attachmentsController");
const app = express();
app.use("/attachments", require("../routes/attachments"));
app.use("/files", require("../routes/files"));
app.use(
  "/uploads",
  require("../middleware/authMiddleware").authenticateUser,
  canonical.pathDownload,
);
app.use((e, req, res, next) =>
  res.status(e.statusCode || 500).json({ message: e.message }),
);
let f;
beforeEach(() => {
  jest.clearAllMocks();
  f = fixture();
  pool.query.mockImplementation(f.query);
  pool.connect.mockResolvedValue({ query: f.query, release: jest.fn() });
  perms.getPermissionsForUserId.mockImplementation(f.authority);
});
const get = (path) =>
  request(app).get(path).set("Authorization", "Bearer fixture");
test.each([
  "/attachments/30/download",
  "/attachments/20",
  "/attachments/item/50",
  "/files/30",
  "/uploads/request-20/test.pdf",
])("anonymous access blocked: %s", async (p) => {
  expect((await request(app).get(p)).status).toBe(401);
  expect(pool.query).not.toHaveBeenCalled();
  expect(storage.download).not.toHaveBeenCalled();
});
test.each([
  "/attachments/30/download",
  "/files/30",
  "/attachments/download?path=uploads/request-20/test.pdf",
  "/uploads/request-20/test.pdf",
])("all aliases authorize current parent: %s", async (p) => {
  expect((await get(p)).status).toBe(200);
  f.state.root.requester_id = 2;
  const denied = await get(p);
  expect(denied.status).toBe(404);
  expect(denied.text).not.toMatch(/test.pdf|fixture content|request-20/);
});
test("legacy metadata URL points at canonical authenticated download without a signed storage URL", async () => {
  const r = await get("/files/30");
  expect(r.body.url).toBe("/attachments/30/download");
  expect(r.body).not.toHaveProperty("s3_key");
});
test("unauthorized multipart upload never reaches storage", async () => {
  f.state.root.requester_id = 2;
  const r = await request(app)
    .post("/attachments/20")
    .set("Authorization", "Bearer fixture")
    .attach("file", Buffer.from("test"), "test.pdf");
  expect(r.status).toBe(404);
  expect(uploads.storeAttachmentFile).not.toHaveBeenCalled();
});
test("requester upload rechecks current permission/relationship after slow storage", async () => {
  uploads.storeAttachmentFile.mockImplementationOnce(async () => {
    f.state.root.requester_id = 2;
    return { objectKey: "uploads/new.pdf" };
  });
  const r = await request(app)
    .post("/attachments/20")
    .set("Authorization", "Bearer fixture")
    .attach("file", Buffer.from("test"), "test.pdf");
  expect(r.status).toBe(404);
  expect(storage.remove).toHaveBeenCalledWith("uploads/new.pdf");
  expect(
    require("../utils/attachmentSchema").insertAttachment,
  ).not.toHaveBeenCalled();
});
test("unauthorized and foreign deletion never removes blob or metadata", async () => {
  f.state.root.institute_id = 11;
  expect(
    (
      await request(app)
        .delete("/files/30")
        .set("Authorization", "Bearer fixture")
    ).status,
  ).toBe(404);
  expect(f.state.deleted).toBe(false);
  expect(storage.remove).not.toHaveBeenCalled();
});
test.each(["approval", "technical", "fk-race"])(
  "retained evidence blocks delete without removing object: %s",
  async (kind) => {
    if (kind === "approval") f.state.signed = true;
    if (kind === "technical") {
      f.state.tables.add("technical_evidence_references");
      f.state.retained = true;
    }
    if (kind === "fk-race") f.state.fkRace = true;
    const r = await request(app)
      .delete("/attachments/30")
      .set("Authorization", "Bearer fixture");
    expect(r.status).toBe(409);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(f.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  },
);
test("authorized delete commits audit before storage cleanup and supports legacy URL", async () => {
  const r = await request(app)
    .delete("/files/30")
    .set("Authorization", "Bearer fixture");
  expect(r.status).toBe(200);
  expect(audit.writeAuditEvent).toHaveBeenCalled();
  expect(storage.remove).toHaveBeenCalledWith(f.state.file.file_path);
  const calls = f.query.mock.calls.map(([sql]) => sql);
  expect(
    calls.indexOf("SELECT id FROM requests WHERE id=$1 FOR UPDATE"),
  ).toBeLessThan(
    calls.indexOf("SELECT id FROM attachments WHERE id=$1 FOR UPDATE"),
  );
  expect(calls).toContain("COMMIT");
});
test.each([
  "../private-uploads/file.pdf",
  "uploads/../../file",
  "uploads/%2e%2e/secret",
  "C:\\secret",
])("traversal never touches storage: %s", async (path) => {
  expect((await get("/attachments/download").query({ path })).status).toBe(404);
  expect(storage.download).not.toHaveBeenCalled();
});
test("ambiguous filename compatibility fails closed", async () => {
  pool.query.mockImplementation(async (sql, args) =>
    sql.includes("file_path=$1 OR")
      ? { rows: [{ id: 30 }, { id: 31 }] }
      : f.query(sql, args),
  );
  expect((await get("/attachments/download/test.pdf")).status).toBe(404);
  expect(storage.download).not.toHaveBeenCalled();
});

test("concurrent deletion is serialized and cannot remove the same object twice", async () => {
  let release,
    pending = null;
  pool.connect.mockImplementation(async () => {
    let owns = false;
    return {
      release: jest.fn(),
      query: async (sql, args) => {
        if (sql === "SELECT id FROM requests WHERE id=$1 FOR UPDATE") {
          if (pending) await pending;
          pending = new Promise((resolve) => {
            release = resolve;
          });
          owns = true;
        }
        const result = await f.query(sql, args);
        if (owns && (sql === "COMMIT" || sql === "ROLLBACK")) {
          owns = false;
          const unblock = release;
          pending = null;
          unblock();
        }
        return result;
      },
    };
  });
  const results = await Promise.all([
    request(app).delete("/files/30").set("Authorization", "Bearer fixture"),
    request(app).delete("/files/30").set("Authorization", "Bearer fixture"),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
  expect(storage.remove).toHaveBeenCalledTimes(1);
});
test("listing metadata cannot bypass parent access and foreign upload remains denied", async () => {
  f.state.root.institute_id = 11;
  const list = await get("/attachments/20");
  expect(list.status).toBe(404);
  expect(list.text).not.toContain("test.pdf");
  const upload = await request(app)
    .post("/attachments/item/50")
    .set("Authorization", "Bearer fixture")
    .attach("file", Buffer.from("test"), "test.pdf");
  expect(upload.status).toBe(404);
  expect(uploads.storeAttachmentFile).not.toHaveBeenCalled();
});

test.each(["contract approval", "document version"])(
  "contract evidence remains retained: %s",
  async (type) => {
    f.state.permissions = ["contracts.manage"];
    f.state.file.request_id = null;
    f.state.file.contract_id = 9;
    f.state.contract = { id: 9, creator_institute_id: 10, created_by: 1 };
    if (type === "contract approval") {
      f.state.tables.add("contract_approvals");
      f.state.contractSigned = true;
    } else {
      f.state.tables.add("contract_document_versions");
      f.state.versionRetained = true;
    }
    const response = await request(app)
      .delete("/files/30")
      .set("Authorization", "Bearer fixture");
    expect(response.status).toBe(409);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(f.state.deleted).toBe(false);
  },
);


describe("approval attachment listing with the device-demo module installed", () => {
  beforeEach(() => {
    f.state.tables.add("device_demo_reviewers");
  });

  test.each(["requester", "approver", "buyer", "manager"])(
    "%s can list request attachments when demo reviewers have no surrogate ID",
    async (kind) => {
      if (kind !== "requester") f.state.root.requester_id = 2;
      if (kind === "approver") f.state.approver = true;
      if (kind === "buyer") {
        f.state.buyer = true;
        f.state.permissions = ["procurement.update-status"];
      }
      if (kind === "manager") f.state.permissions = ["requests.view-all"];
      const response = await get("/attachments/20");
      expect(response.status).toBe(200);
      expect(response.body).toEqual([expect.objectContaining({ id: 30, file_name: "test.pdf" })]);
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(storage.download).not.toHaveBeenCalled();
    },
  );

  test("unrelated and foreign accounts still cannot inspect attachment metadata", async () => {
    f.state.root.requester_id = 2;
    let response = await get("/attachments/20");
    expect(response.status).toBe(404);
    expect(response.text).not.toMatch(/test.pdf|request-20/);
    f.state.permissions = ["requests.view-all"];
    f.state.root.institute_id = 11;
    response = await get("/attachments/20");
    expect(response.status).toBe(404);
    expect(response.text).not.toMatch(/test.pdf|request-20/);
  });

  test("demo reviewer sees selected evidence only and loses access when assignment is revoked", async () => {
    f.state.root.requester_id = 2;
    f.state.file.uploaded_by = 2;
    f.state.demoReviewer = true;
    f.state.tables.add("device_demo_events");
    let response = await get("/attachments/20");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 30 })]);
    f.state.selected = false;
    response = await get("/attachments/20");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    f.state.demoReviewer = false;
    expect((await get("/attachments/20")).status).toBe(404);
  });

  test("real query failures still fail closed rather than returning an empty success", async () => {
    const query = f.query;
    pool.query.mockImplementation((sql, args) => {
      if (sql.includes("FROM device_demo_reviewers own"))
        throw Object.assign(new Error("database unavailable"), { code: "ECONNRESET" });
      return query(sql, args);
    });
    const response = await get("/attachments/20");
    expect(response.status).toBe(500);
    expect(response.text).not.toMatch(/test.pdf|request-20/);
  });
});
