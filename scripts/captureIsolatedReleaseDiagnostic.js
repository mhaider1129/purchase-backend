"use strict";
// Operator-invoked READ ONLY capture. Never reads dotenv or DATABASE_URL and
// never starts the application, workers, migrations or runtime SET ROLE helper.
const fs = require("node:fs"),
  path = require("node:path");
function isolatedConnection(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("EXPLICIT_ISOLATED_DATABASE_URL_REQUIRED");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "::1"].includes(host) ||
    url.port !== "55432" ||
    decodeURIComponent(url.pathname) !== "/wici_migration_test" ||
    url.search ||
    url.hash ||
    !url.username ||
    !url.password
  )
    throw Error(
      "ISOLATED_TARGET_MUST_BE_LOOPBACK_55432_WICI_MIGRATION_TEST_WITH_NO_OVERRIDES",
    );
  return {
    host,
    port: 55432,
    database: "wici_migration_test",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
    options: "-c default_transaction_read_only=on",
    application_name: "wici-isolated-release-diagnostic",
  };
}
function category(f) {
  if (f.category) return f.category;
  if (
    f.file ||
    [
      "CHECKSUM_MISMATCH",
      "MANIFEST_DIGEST_MISMATCH",
      "UNREGISTERED_RELEASE_ARTIFACT",
    ].includes(f.reason)
  )
    return "source_attestation";
  if (
    ["runtime_role", "runtime_privilege", "connection_principal"].includes(
      f.group,
    )
  )
    return "runtime_role_provisioning";
  if (["ledger", "attestation", "release"].includes(f.group))
    return "release_evidence";
  if (f.group === "catalog_visibility") return "assessment_visibility";
  if (
    f.group === "relations" &&
    f.fields?.some((v) => ["rls", "force_rls"].includes(v))
  )
    return "rls_security_review";
  if (
    ["policies", "browser_table_grants", "browser_function_grants"].includes(
      f.group,
    )
  )
    return "application_security_review";
  if (["constraints", "indexes"].includes(f.group))
    return "constraint_or_server_representation_review";
  if (f.group === "functions") return "application_routine_review";
  if (
    [
      "permissions",
      "ui_resources",
      "route_policies",
      "reference_accounts",
      "evaluation_criteria_codes",
    ].includes(f.group)
  )
    return "reference_data_review";
  return "application_schema_review";
}
function outputPath(value) {
  if (!value || !path.isAbsolute(value))
    throw Error("ABSOLUTE_OUTPUT_PATH_REQUIRED");
  const parent = fs.realpathSync(path.dirname(value)),
    file = path.join(parent, path.basename(value));
  if (fs.existsSync(file)) throw Error("OUTPUT_ALREADY_EXISTS");
  for (let dir = parent; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git")))
      throw Error("OUTPUT_MUST_BE_OUTSIDE_GIT");
    if (path.dirname(dir) === dir) break;
  }
  return file;
}
async function main(values = process.argv.slice(2)) {
  const { args } = require("./databaseRelease");
  const options = args(["capture", ...values]);
  if (!options.environment || !options.release || !options.profile)
    throw Error("EXPLICIT_ENVIRONMENT_RELEASE_AND_PROFILE_REQUIRED");
  const connection = isolatedConnection(process.env.WICI_ISOLATED_DATABASE_URL);
  const file = outputPath(options.output);
  const service = require("../services/databaseReleaseService"),
    catalog = require("./lib/databaseRelease/catalog");
  const contract =
    options.profile === "canonical"
      ? JSON.parse(
          fs.readFileSync(
            path.join(__dirname, "../database/releases/schema-contract.json"),
            "utf8",
          ),
        )
      : require("./lib/databaseRelease/profiles").loadProfile(options.profile);
  const db = new (require("pg").Client)(connection);
  try {
    await db.connect();
    await db.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await db.query("SET LOCAL statement_timeout='60s'");
    await db.query("SET LOCAL search_path=public,extensions,pg_catalog");
    const identity = (
      await db.query(
        "SELECT current_database() database,current_user role,session_user principal,current_setting('server_version_num')::int server_version_num,current_setting('transaction_read_only') transaction_read_only",
      )
    ).rows[0];
    if (
      identity.database !== "wici_migration_test" ||
      identity.server_version_num < 170000 ||
      identity.server_version_num >= 180000 ||
      identity.transaction_read_only !== "on"
    )
      throw Error("ISOLATED_POSTGRES17_READ_ONLY_IDENTITY_REQUIRED");
    const report = await service.verify(db, {
      contract,
      environment: options.environment,
      releaseRef: options.release,
      role: options["backend-role"] || null,
    });
    const actual = await catalog.snapshot(db, report.catalog_visibility);
    const enriched = report.findings.map((f) => ({
      ...f,
      category: category(f),
      expected: contract.catalog[f.group]?.find(
        (r) => catalog.key(f.group, r) === f.object,
      ),
      observed: actual[f.group]?.find(
        (r) => catalog.key(f.group, r) === f.object,
      ),
    }));
    const categories = {};
    for (const f of enriched)
      categories[f.category] = (categories[f.category] || 0) + 1;
    await db.query("ROLLBACK");
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          kind: "ISOLATED_READ_ONLY_DIAGNOSTIC_NOT_RESTART_AUTHORIZATION",
          identity,
          target: {
            host: connection.host,
            port: 55432,
            database: connection.database,
          },
          profile: options.profile,
          ...report,
          status: "BLOCKED",
          restart_eligible: false,
          verification_mode: "isolated-diagnostic",
          finding_count: enriched.length,
          categories,
          findings: enriched,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      JSON.stringify({
        file,
        mode: "ISOLATED_READ_ONLY_DIAGNOSTIC",
        findingCount: enriched.length,
        categories,
        restart_eligible: false,
      }),
    );
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(
      e.code || "ISOLATED_DIAGNOSTIC_FAILED",
      /password|postgres(?:ql)?:\/\//i.test(e.message)
        ? "Connection or verification failed"
        : e.message,
    );
    process.exitCode = 1;
  });
module.exports = { isolatedConnection, category, outputPath, main };
