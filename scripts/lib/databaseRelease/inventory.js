"use strict";
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const root = path.resolve(__dirname, "../../..");
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? files(path.join(dir, e.name))
        : e.isFile()
          ? [path.join(dir, e.name)]
          : [],
    );
}
function inventory() {
  const sql = files(path.join(root, "sql"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => {
      const content = fs.readFileSync(f, "utf8"),
        name = path.relative(root, f),
        number = /sql\/manual\/(\d+)_/.exec(name)?.[1];
      const verification = /verify|verification|diagnostic|(?:^|\/)007_/i.test(
        name,
      );
      const kind = verification
        ? "read_only_verification"
        : /View_Supabase|permissions_Table|UI_resource_permissions/i.test(name)
          ? "export_snapshot"
          : number
            ? Number(number) >= 69
              ? "active_forward_migration"
              : "frozen_historical_migration"
            : /migration|development/i.test(name)
              ? "frozen_historical_migration"
              : "unused_or_uncertain";
      return {
        path: name,
        id: number || null,
        classification: kind,
        sha256: hash(content),
        bytes: Buffer.byteLength(content),
        execution_evidence: "UNVERIFIED",
        ddl_statements: (
          content.match(
            /\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:TABLE|INDEX|FUNCTION|TRIGGER|POLICY|VIEW|SEQUENCE|ROLE)\b/gi,
          ) || []
        ).length,
        header: content.split("\n").slice(0, 6).join("\n"),
      };
    });
  sql.push(
    ...files(path.join(root, "integration/fixtures"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => ({
        path: path.relative(root, f),
        id: null,
        classification: "test_fixture",
        sha256: hash(fs.readFileSync(f)),
        execution_evidence: "NOT_A_DEPLOYMENT_ARTIFACT",
      })),
  );
  const superseded = {
    35: 59,
    36: 60,
    37: 61,
    38: 59,
    39: 59,
    40: 59,
    41: 59,
    42: 59,
    43: 59,
  };
  for (const entry of sql) {
    if (
      superseded[Number(entry.id)] &&
      entry.classification !== "read_only_verification"
    ) {
      entry.classification = "superseded_migration";
      entry.superseded_by_prefix = String(
        superseded[Number(entry.id)],
      ).padStart(3, "0");
      entry.note =
        "Overlapping responsibility is consolidated; never replay or infer historical execution.";
    }
    if (entry.id === "069") {
      entry.classification = "frozen_historical_migration";
      entry.governed_receipt_required = true;
    }
    if (entry.id === "070") {
      entry.classification = "frozen_historical_migration";
      entry.governed_receipt_required = true;
      entry.depends_on = ["069_database_release_governance"];
      entry.preflight_contract =
        "database/releases/prerequisites/069-schema-contract.json";
    }
    if (entry.id === "071") {
      entry.governed_receipt_required = true;
      entry.depends_on = ["070_rfid_processing_recovery"];
      entry.preflight_contract =
        "database/releases/prerequisites/070-schema-contract.json";
    }
    if (entry.id === "069")
      entry.required_contracts = [
        "canonical_procurement_completion(integer,integer,integer)",
        "canonical_receipt_inventory_quantity(bigint,integer,text,bigint)",
        "reviewed_baseline_and_permission_UI_catalogs",
      ];
  }
  const runtime = [
    "repositories",
    "jobs",
    "domain",
    "modules",
    "policies",
    "controllers",
    "utils",
    "services",
    "middleware",
    "routes",
    "scripts",
    "integration",
  ]
    .flatMap((d) => files(path.join(root, d)))
    .filter((f) => f.endsWith(".js"))
    .map((f) => {
      const c = fs.readFileSync(f, "utf8");
      const matches = [
        ...c.matchAll(
          /\b(CREATE\s+(?:TABLE|UNIQUE\s+INDEX|INDEX|(?:OR\s+REPLACE\s+)?FUNCTION)|ALTER\s+TABLE|DROP\s+INDEX)\b/gi,
        ),
      ];
      return {
        path: path.relative(root, f),
        classification: /^(scripts|integration)\//.test(path.relative(root, f))
          ? "test_fixture_or_verification"
          : "runtime_compatibility_initialization",
        ddl_occurrences: matches.length,
        sha256: hash(c),
      };
    })
    .filter((r) => r.ddl_occurrences);
  const application_sources = [
    "app.js",
    "package.json",
    "package-lock.json",
    "scripts/databaseRelease.js",
    "database/releases/runtime-modules.json",
    ...files(path.join(root, "database/releases/prerequisites")).map((f) =>
      path.relative(root, f),
    ),
    ...files(path.join(root, "scripts/lib/databaseRelease"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => path.relative(root, f)),
    ...[
      "jobs",
      "constants",
      "domain",
      "errors",
      "modules",
      "policies",
      "validators",
      "controllers",
      "services",
      "repositories",
      "routes",
      "utils",
      "middleware",
      "config",
    ].flatMap((d) =>
      files(path.join(root, d))
        .filter((f) => /\.(js|json)$/.test(f))
        .map((f) => path.relative(root, f)),
    ),
  ]
    .sort()
    .map((file) => ({
      path: file,
      sha256: hash(fs.readFileSync(path.join(root, file))),
    }));
  return {
    application_sources,
    application_manifest_sha256: hash(JSON.stringify(application_sources)),
    highest_manual_number: Math.max(...sql.map((r) => Number(r.id) || 0)),
    artifacts: sql,
    runtime_sources: runtime,
    note: "Repository existence is not execution evidence. Superseded definitions and optional policy/data patches are not a replay order.",
  };
}
function verifyFiles(manifest) {
  const errors = [];
  if (
    hash(JSON.stringify(manifest.application_sources || [])) !==
    manifest.application_manifest_sha256
  )
    errors.push({
      file: "application_sources",
      reason: "MANIFEST_DIGEST_MISMATCH",
    });
  for (const r of [
    ...manifest.artifacts,
    ...(manifest.application_sources || []),
  ]) {
    const file = path.join(root, r.path);
    if (!fs.existsSync(file) || hash(fs.readFileSync(file)) !== r.sha256)
      errors.push({ file: r.path, reason: "CHECKSUM_MISMATCH" });
  }
  const locked = new Set(
    [...manifest.artifacts, ...(manifest.application_sources || [])].map(
      (r) => r.path,
    ),
  );
  const discovered = inventory();
  for (const r of [...discovered.artifacts, ...discovered.application_sources])
    if (!locked.has(r.path))
      errors.push({ file: r.path, reason: "UNREGISTERED_RELEASE_ARTIFACT" });
  return errors;
}
module.exports = { root, hash, files, inventory, verifyFiles };
