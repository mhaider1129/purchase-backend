"use strict";
// Offline by default. The only connection mode runs a read-only transaction and
// requires a dedicated operator-supplied environment variable, never DATABASE_URL.
const fs = require("fs"),
  path = require("path");
const { root, inventory } = require("./lib/databaseRelease/inventory");
const service = require("../services/databaseReleaseService");
const { selectMigrations, bundle } = require("./lib/databaseRelease/planner");
function args(values) {
  const result = { command: values[0] || "plan" };
  for (let i = 1; i < values.length; i++) {
    if (!values[i].startsWith("--")) throw new Error("Unexpected argument");
    result[values[i].slice(2)] = values[++i];
  }
  return result;
}
function verificationConnection(options) {
  const mode = options["connection-mode"] || "diagnostic";
  if (!["diagnostic", "runtime"].includes(mode))
    throw Error("CONNECTION_MODE_MUST_BE_DIAGNOSTIC_OR_RUNTIME");
  if (mode === "runtime" && options["backend-role"])
    throw Error("RUNTIME_ROLE_OVERRIDE_NOT_ALLOWED");
  return {
    mode,
    Client:
      mode === "runtime"
        ? require("../utils/runtimeDatabaseIdentity").clientClass()
        : require("pg").Client,
  };
}
async function main(options = args(process.argv.slice(2))) {
  if (options.command === "new") {
    if (!/^[a-z][a-z0-9_]+$/.test(options.name || ""))
      throw new Error("A lowercase --name is required");
    const id =
      String(inventory().highest_manual_number + 1).padStart(3, "0") +
      "_" +
      options.name;
    const text = `-- MANUAL DATABASE MIGRATION REQUIRED. Review prerequisites, data preservation and postflight.\nBEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='5min';\n-- Add reviewed forward-only statements. Never copy old execution receipts.\nCOMMIT;\n`;
    if (options.output)
      fs.writeFileSync(path.resolve(options.output), text, { flag: "wx" });
    console.log(
      JSON.stringify({
        id,
        status: "DRAFT_NOT_REGISTERED_NOT_EXECUTED",
        next: "Review in disposable PostgreSQL and update the locked release inventory/contract before planning",
      }),
    );
    return;
  }
  if (options.command === "inventory") {
    console.log(JSON.stringify(inventory(), null, 2));
    return;
  }
  if (options.command === "rollback-disabled")
    throw new Error(
      "DESTRUCTIVE_ROLLBACK_DISABLED: use a reviewed forward correction",
    );
  const manifest = service.loadInventory(),
    contract = service.loadContract();
  if (options.command === "plan") {
    const entries = selectMigrations(
      manifest,
      options.migration?.split(","),
      contract.profile,
    );
    const report = {
      mode: "OFFLINE_DRY_RUN_NO_DATABASE_CONNECTION",
      contract: contract.version,
      historical_execution: "UNVERIFIED",
      steps: entries.map((e) => ({
        file: e.path,
        sha256: e.sha256,
        classification: e.classification,
        prerequisites:
          "Actual canonical contracts, not a filename-based historical execution claim",
      })),
    };
    if (options.output) {
      const sql = bundle({
        inventory: manifest,
        contract,
        ids: options.migration?.split(","),
        environment: options.environment,
        actor: options.actor,
        releaseRef: options.release,
      });
      fs.writeFileSync(path.resolve(options.output), sql);
      report.reviewable_sql = path.resolve(options.output);
    }
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  if (options.command !== "verify")
    throw new Error(
      "Supported commands: inventory, plan, verify. No automated migration executor exists.",
    );
  if (
    !options.environment ||
    !options.release ||
    !process.env.DB_RELEASE_READONLY_URL
  )
    throw new Error(
      "Explicit --environment, --release and DB_RELEASE_READONLY_URL are required",
    );
  const connection = verificationConnection(options);
  const db = new connection.Client({
    connectionString: process.env.DB_RELEASE_READONLY_URL,
    application_name: "purchase-tracker-read-only-release-verifier",
  });
  try {
    await db.connect();
    await db.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await db.query("SET LOCAL statement_timeout='60s'");
    await db.query("SET LOCAL search_path=public,extensions,pg_catalog");
    const report = await service.verify(db, {
      releaseRef: options.release,
      environment: options.environment,
      role: options["backend-role"],
    });
    report.external_ledgers = await service.existingLedgers(db);
    report.verification_mode = connection.mode;
    if (connection.mode !== "runtime") {
      report.findings.push({
        group: "verification",
        reason: "diagnostic_connection_is_not_runtime_acceptance",
      });
      report.status = "BLOCKED";
      report.restart_eligible = false;
    }
    await db.query("ROLLBACK");
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "DATABASE_READY") process.exitCode = 1;
    return report;
  } finally {
    await db.end();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(
      JSON.stringify({
        status: "BLOCKED",
        code: e.code || "DATABASE_RELEASE_CHECK_FAILED",
        message: /password|postgres(?:ql)?:\/\//i.test(e.message)
          ? "Database connection or verification failed"
          : e.message,
      }),
    );
    process.exitCode = 1;
  });
module.exports = { main, args, verificationConnection };
