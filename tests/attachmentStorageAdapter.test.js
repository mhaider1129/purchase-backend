const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
jest.mock("../utils/attachmentPaths", () => ({
  ...jest.requireActual("../utils/attachmentPaths"),
  UPLOADS_DIR: require("node:fs").mkdtempSync(
    require("node:path").join(
      require("node:os").tmpdir(),
      "attachment-download-",
    ),
  ),
}));
const adapter = require("../services/attachmentStorageAdapter");
afterAll(async () =>
  fs.rm(require("../utils/attachmentPaths").UPLOADS_DIR, {
    recursive: true,
    force: true,
  }),
);
let root, outside;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-gate-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-outside-"));
  await fs.writeFile(path.join(root, "allowed % file.pdf"), "fixture");
  await fs.writeFile(path.join(outside, "secret.pdf"), "private");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});
test("local stored key resolves within configured root, including legitimate spaces and percent names", async () => {
  expect(await adapter.localPath("uploads/allowed % file.pdf", root)).toBe(
    path.join(root, "allowed % file.pdf"),
  );
});
test.each([
  "uploads/../secret.pdf",
  "uploads/../../private/file.pdf",
  "/etc/passwd",
  "C:\\secret",
  "uploads/./file",
  "uploads//file",
  "https://untrusted/object",
  "uploads/\0file",
])("rejects unsafe key %s", async (value) => {
  await expect(adapter.localPath(value, root)).rejects.toMatchObject({
    statusCode: 404,
  });
});
test("symlink escape never resolves outside upload root", async () => {
  await fs.symlink(
    path.join(outside, "secret.pdf"),
    path.join(root, "link.pdf"),
  );
  await expect(
    adapter.localPath("uploads/link.pdf", root),
  ).rejects.toMatchObject({ statusCode: 404 });
  await fs.symlink(outside, path.join(root, "dir"));
  await expect(
    adapter.localPath("uploads/dir/secret.pdf", root),
  ).rejects.toMatchObject({ statusCode: 404 });
});

test("authorized local adapter streams actual bytes with private headers", async () => {
  const directory = require("../utils/attachmentPaths").UPLOADS_DIR;
  await fs.writeFile(
    path.join(directory, "stream.pdf"),
    "actual local fixture",
  );
  const app = require("express")();
  app.get("/", (req, res, next) =>
    Promise.resolve(
      adapter.download(
        { file_path: "uploads/stream.pdf", file_name: "stream.pdf" },
        req,
        res,
        next,
      ),
    ).catch(next),
  );
  const response = await require("supertest")(app).get("/");
  expect(response.status).toBe(200);
  expect(response.body.toString()).toBe("actual local fixture");
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
});
