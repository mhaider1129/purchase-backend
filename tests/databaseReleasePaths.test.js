"use strict";
const path = require("node:path");
const {
  inventory,
  root,
  hash,
  verifyFiles,
} = require("../scripts/lib/databaseRelease/inventory");
const { loadInventory } = require("../services/databaseReleaseService");
const { selectMigrations } = require("../scripts/lib/databaseRelease/planner");

// Only relative-path representation changes. Absolute filesystem paths and
// file bytes remain native, so Windows behavior is exercised without fake I/O.
function withRelativePaths(separator, run) {
  const relative = path.relative;
  const spy = jest.spyOn(path, "relative").mockImplementation((from, to) => {
    const value = relative(from, to);
    return from === root
      ? value.replace(/\\/g, "/").replace(/\//g, separator)
      : value;
  });
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

test.each([
  ["POSIX", "/"],
  ["Windows", "\\"],
])("%s relative paths produce the same canonical inventory", (_, separator) => {
  const expected = withRelativePaths("/", inventory);
  const actual = withRelativePaths(separator, inventory);
  expect(actual).toEqual(expected);
  expect(actual.highest_manual_number).toBe(73);
  expect(actual.artifacts.find((r) => r.id === "073")).toMatchObject({
    path: "sql/manual/073_wici_observed_schema_recovery.sql",
    classification: "manual_recovery_migration",
    execution_evidence: "UNVERIFIED",
  });
  for (const row of [
    ...actual.artifacts,
    ...actual.runtime_sources,
    ...actual.application_sources,
  ]) {
    expect(row.path).not.toContain("\\");
    expect(path.isAbsolute(row.path)).toBe(false);
  }
  expect(
    actual.artifacts
      .filter((r) => r.path.startsWith("integration/fixtures/"))
      .every((r) => r.classification === "test_fixture"),
  ).toBe(true);
  const scripts = actual.runtime_sources.filter((r) =>
    /^(scripts|integration)\//.test(r.path),
  );
  expect(scripts.length).toBeGreaterThan(0);
  expect(
    scripts.every((r) => r.classification === "test_fixture_or_verification"),
  ).toBe(true);
});

test("Windows discovery preserves locked paths and hashes without introducing path-related findings", () => {
  const manifest = loadInventory();
  const nativeFindings = verifyFiles(manifest);
  withRelativePaths("\\", () => {
    expect(verifyFiles(manifest)).toEqual(nativeFindings);
    expect(
      nativeFindings.every(
        (r) =>
          r.file === "scripts/lib/databaseRelease/inventory.js" &&
          r.reason === "CHECKSUM_MISMATCH",
      ),
    ).toBe(true);
    const actual = inventory();
    for (const row of manifest.artifacts) {
      expect(actual.artifacts.find((r) => r.path === row.path)).toMatchObject({
        sha256: row.sha256,
        classification: row.classification,
        execution_evidence: row.execution_evidence,
      });
    }
    expect(actual.application_sources.map((r) => r.path)).toEqual(
      manifest.application_sources.map((r) => r.path),
    );
  });
});

test("a source-bound in-memory review manifest preserves Windows planning and checksum rejection", () => {
  // This local object tests planning only. The checked-in manifest is never
  // overwritten; production verification must still reject its old source hash.
  const manifest = structuredClone(loadInventory());
  const current = inventory();
  const source = "scripts/lib/databaseRelease/inventory.js";
  manifest.application_sources.find((r) => r.path === source).sha256 =
    current.application_sources.find((r) => r.path === source).sha256;
  manifest.application_manifest_sha256 = hash(
    JSON.stringify(manifest.application_sources),
  );
  withRelativePaths("\\", () => {
    expect(verifyFiles(manifest)).toEqual([]);
    expect(selectMigrations(manifest).map((r) => r.id)).toEqual(["072"]);
    expect(() =>
      selectMigrations(manifest, ["073_wici_observed_schema_recovery"]),
    ).toThrow("FROZEN_REPLAY_DISABLED");
    expect(
      selectMigrations(manifest, undefined, "wici-2026-11").map((r) => r.id),
    ).toEqual(["073"]);
    manifest.artifacts.find((r) => r.id === "073").sha256 = "0".repeat(64);
    expect(() => selectMigrations(manifest, undefined, "wici-2026-11")).toThrow(
      "CHECKSUM_MISMATCH",
    );
  });
});
