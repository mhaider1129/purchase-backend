"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { key } = require("./catalog");
const directory = path.resolve(__dirname, "../../../database/releases");
const hash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function applyOverlay(base, descriptor) {
  if (descriptor.base_contract_sha256 !== hash(base))
    throw Error("DATABASE_PROFILE_BASE_CHANGED_REVIEW_REQUIRED");
  const result = structuredClone(base);
  for (const [group, change] of Object.entries(descriptor.changes)) {
    if (
      !Array.isArray(result.catalog[group]) ||
      !Array.isArray(change.remove) ||
      !Array.isArray(change.put)
    )
      throw Error("INVALID_DATABASE_PROFILE");
    const rows = new Map(
      result.catalog[group].map((row) => [key(group, row), row]),
    );
    for (const id of change.remove) {
      if (!rows.delete(id)) throw Error("INVALID_DATABASE_PROFILE_REMOVE");
    }
    for (const row of change.put) rows.set(key(group, row), row);
    result.catalog[group] = [...rows.values()].sort((a, b) =>
      key(group, a) < key(group, b)
        ? -1
        : key(group, a) > key(group, b)
          ? 1
          : 0,
    );
  }
  result.version = descriptor.version;
  result.profile = descriptor.profile;
  if (descriptor.observed_baseline_migration)
    result.observed_baseline_migration = descriptor.observed_baseline_migration;
  return result;
}
function loadProfile(name, stage = "target") {
  if (name !== "wici-2026-11" || !["observed", "target"].includes(stage))
    throw Error("UNKNOWN_DATABASE_PROFILE");
  const base = JSON.parse(
    fs.readFileSync(path.join(directory, "schema-contract.json"), "utf8"),
  );
  const descriptor = JSON.parse(
    fs.readFileSync(
      path.join(directory, `profiles/wici-${stage}.json`),
      "utf8",
    ),
  );
  if (
    descriptor.base_stage &&
    !(stage === "target" && descriptor.base_stage === "observed")
  )
    throw Error("INVALID_DATABASE_PROFILE_BASE");
  return applyOverlay(
    descriptor.base_stage ? loadProfile(name, "observed") : base,
    descriptor,
  );
}
module.exports = { applyOverlay, loadProfile };
