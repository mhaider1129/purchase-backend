"use strict";
const fs = require("node:fs");
const service = require("../services/databaseReleaseService");
afterEach(() => {
  delete process.env.DB_RELEASE_SCHEMA_PROFILE;
  jest.restoreAllMocks();
});
test("exported contract version follows the selected canonical contract instead of stale 7C metadata", () => {
  delete process.env.DB_RELEASE_SCHEMA_PROFILE;
  expect(service.CONTRACT_VERSION).toBe("hospital-erp-2026-11-scop1");
  expect(service.CONTRACT_VERSION).toBe(service.loadContract().version);
});
test("exported version follows an explicitly selected reviewed profile and refuses unknown profiles", () => {
  process.env.DB_RELEASE_SCHEMA_PROFILE = "wici-2026-11";
  expect(service.CONTRACT_VERSION).toBe(service.loadContract().version);
  process.env.DB_RELEASE_SCHEMA_PROFILE = "arbitrary";
  expect(() => service.CONTRACT_VERSION).toThrow("UNKNOWN_DATABASE_PROFILE");
});
test("a missing version cannot be certified as a contract", () => {
  const read = fs.readFileSync;
  jest
    .spyOn(fs, "readFileSync")
    .mockImplementation((file, ...args) =>
      String(file).endsWith("schema-contract.json")
        ? JSON.stringify({ catalog: {} })
        : read(file, ...args),
    );
  expect(() => service.loadContract()).toThrow(
    expect.objectContaining({ code: "INVALID_DATABASE_CONTRACT_VERSION" }),
  );
});
