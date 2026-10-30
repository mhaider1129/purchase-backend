const express = require("express"),
  request = require("supertest"),
  { PassThrough } = require("node:stream"),
  { EventEmitter } = require("node:events");
jest.mock("../utils/storage", () => ({
  isStorageConfigured: jest.fn(() => true),
  buildObjectDownloadRequest: jest.fn(() => ({
    url: "https://storage.invalid/private/test",
    headers: { Authorization: "fixture-secret" },
  })),
  removeObject: jest.fn(),
}));
const https = require("node:https"),
  adapter = require("../services/attachmentStorageAdapter");
afterEach(() => jest.restoreAllMocks());
function app() {
  const a = express();
  a.get("/", (req, res, next) =>
    Promise.resolve(
      adapter.download(
        { file_path: "attachments/registered/test.pdf", file_name: "test.pdf" },
        req,
        res,
        next,
      ),
    ).catch(next),
  );
  a.use((e, req, res, next) =>
    res.status(e.statusCode || 500).json({ message: e.message }),
  );
  return a;
}
test("remote bytes are proxied with private cache headers; storage credentials never reach browser", async () => {
  const get = jest
    .spyOn(https, "get")
    .mockImplementation((url, options, callback) => {
      const upstream = new EventEmitter();
      upstream.setTimeout = jest.fn();
      upstream.destroy = jest.fn();
      process.nextTick(() => {
        const incoming = new PassThrough();
        incoming.statusCode = 200;
        incoming.headers = {
          "content-disposition": "inline; filename=unsafe.html",
        };
        callback(incoming);
        incoming.end("protected bytes");
      });
      return upstream;
    });
  const response = await request(app()).get("/");
  expect(response.status).toBe(200);
  expect(response.body.toString()).toBe("protected bytes");
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.headers["content-disposition"]).toContain("attachment");
  expect(response.headers).not.toHaveProperty("authorization");
  expect(JSON.stringify(response.headers)).not.toContain("fixture-secret");
  expect(get).toHaveBeenCalled();
});
test("remote redirects are not followed or exposed as bearer URLs", async () => {
  jest.spyOn(https, "get").mockImplementation((url, options, callback) => {
    const upstream = new EventEmitter();
    upstream.setTimeout = jest.fn();
    upstream.destroy = jest.fn();
    process.nextTick(() => {
      const incoming = new PassThrough();
      incoming.statusCode = 302;
      incoming.headers = { location: "https://untrusted.invalid/secret" };
      callback(incoming);
      incoming.end();
    });
    return upstream;
  });
  expect((await request(app()).get("/")).status).toBe(502);
});

test("a missing legacy local copy falls back only to its registered remote key", async () => {
  const filesystem = jest
    .spyOn(require("node:fs/promises"), "realpath")
    .mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
  const get = jest
    .spyOn(https, "get")
    .mockImplementation((url, options, callback) => {
      const upstream = new EventEmitter();
      upstream.setTimeout = jest.fn();
      upstream.destroy = jest.fn();
      process.nextTick(() => {
        const incoming = new PassThrough();
        incoming.statusCode = 200;
        callback(incoming);
        incoming.end("remote legacy");
      });
      return upstream;
    });
  const a = express();
  a.get("/", (req, res, next) =>
    Promise.resolve(
      adapter.download(
        { file_path: "uploads/registered/legacy.pdf", file_name: "legacy.pdf" },
        req,
        res,
        next,
      ),
    ).catch(next),
  );
  const response = await request(a).get("/");
  expect(response.status).toBe(200);
  expect(response.body.toString()).toBe("remote legacy");
  expect(get).toHaveBeenCalled();
  expect(
    require("../utils/storage").buildObjectDownloadRequest,
  ).toHaveBeenCalledWith("uploads/registered/legacy.pdf");
  filesystem.mockRestore();
});
