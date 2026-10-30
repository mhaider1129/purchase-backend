"use strict";
const fs = require("node:fs/promises");
const constants = require("node:fs").constants;
const path = require("node:path");
const { pipeline } = require("node:stream");
const { UPLOADS_DIR, isStoredLocally } = require("../utils/attachmentPaths");
const storage = require("../utils/storage");
const fail = () =>
  Object.assign(new Error("File not found"), { statusCode: 404 });
function key(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    /^[a-z]+:/i.test(value) ||
    value.startsWith("/") ||
    value.includes("\\")
  )
    throw fail();
  if (value.split("/").some((s) => !s || s === "." || s === "..")) throw fail();
  return value;
}
async function localPath(value, rootDir = UPLOADS_DIR) {
  const stored = key(value);
  if (!isStoredLocally(stored)) throw fail();
  const absent = (e) => {
    const error = fail();
    if (e.code === "ENOENT") error.code = "ATTACHMENT_LOCAL_MISSING";
    throw error;
  };
  const root = await fs.realpath(rootDir).catch(absent);
  const target = await fs
    .realpath(path.resolve(rootDir, stored.slice("uploads/".length)))
    .catch(absent);
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw fail();
  return target;
}
function headers(res, file) {
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.attachment(file.file_name || "attachment");
  res.type("application/octet-stream");
}
async function download(file, req, res, next) {
  const stored = key(file.file_path);
  headers(res, file);
  if (isStoredLocally(stored)) {
    let target;
    try {
      target = await localPath(stored);
    } catch (e) {
      if (
        e.code === "ATTACHMENT_LOCAL_MISSING" &&
        storage.isStorageConfigured()
      )
        return remote(stored, req, res, next);
      throw e;
    }
    const handle = await fs.open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      throw fail();
    }
    const stream = handle.createReadStream();
    res.on("close", () => stream.destroy());
    pipeline(stream, res, (e) => {
      if (e && !res.destroyed) next(e);
    });
    return;
  }
  return remote(stored, req, res, next);
}
function remote(stored, req, res, next) {
  if (!storage.isStorageConfigured())
    throw Object.assign(new Error("File storage unavailable"), {
      statusCode: 503,
    });
  const config = storage.buildObjectDownloadRequest(stored),
    url = new URL(config.url);
  if (!["https:", "http:"].includes(url.protocol)) throw fail();
  const upstream = require(
    url.protocol === "https:" ? "node:https" : "node:http",
  ).get(url, { headers: config.headers }, (incoming) => {
    if (incoming.statusCode !== 200) {
      incoming.resume();
      return next(
        Object.assign(new Error("File unavailable"), {
          statusCode: incoming.statusCode === 404 ? 404 : 502,
        }),
      );
    }
    pipeline(incoming, res, (e) => {
      if (e && !res.destroyed) next(e);
    });
  });
  upstream.setTimeout(30000, () =>
    upstream.destroy(new Error("Storage timeout")),
  );
  upstream.on("error", () => {
    if (!res.headersSent)
      next(
        Object.assign(new Error("File storage unavailable"), {
          statusCode: 502,
        }),
      );
    else res.destroy();
  });
  res.on("close", () => upstream.destroy());
}
async function remove(value) {
  const stored = key(value);
  if (isStoredLocally(stored)) {
    try {
      await fs.unlink(await localPath(stored));
    } catch (e) {
      if (e.statusCode !== 404 && e.code !== "ENOENT") throw e;
    }
  } else await storage.removeObject(stored);
}
module.exports = { key, localPath, download, remove };
