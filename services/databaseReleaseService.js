"use strict";
const fs = require("fs"),
  path = require("path");
const catalog = require("../scripts/lib/databaseRelease/catalog");
const {
  hash,
  verifyFiles,
} = require("../scripts/lib/databaseRelease/inventory");
const directory = path.join(__dirname, "../database/releases");
const CONTRACT_VERSION = "hospital-erp-2026-11-7c";
function loadContract() {
  const profile = process.env.DB_RELEASE_SCHEMA_PROFILE;
  if (profile && profile !== "canonical")
    return require("../scripts/lib/databaseRelease/profiles").loadProfile(
      profile,
    );
  return JSON.parse(
    fs.readFileSync(path.join(directory, "schema-contract.json"), "utf8"),
  );
}
function loadInventory() {
  return JSON.parse(
    fs.readFileSync(path.join(directory, "migration-inventory.json"), "utf8"),
  );
}
async function existingLedgers(db) {
  const result = {};
  for (const [name, sql] of [
    [
      "supabase_migrations.schema_migrations",
      "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
    ],
    [
      "public.pgmigrations",
      "SELECT name,run_on FROM public.pgmigrations ORDER BY run_on,name",
    ],
  ]) {
    const relation = (
      await db.query(
        `SELECT has_schema_privilege(current_user,n.oid,'USAGE') AND has_table_privilege(current_user,c.oid,'SELECT') readable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2`,
        name.split("."),
      )
    ).rows[0];
    result[name] = !relation
      ? { status: "ABSENT" }
      : !relation.readable
        ? { status: "NOT_ACCESSIBLE_TO_VERIFIER" }
        : {
            status: "UNVERIFIED_EXTERNAL_HISTORY",
            rows: (await db.query(sql)).rows,
          };
  }
  return result;
}
async function runtimeAuthority(db, role = null) {
  const session = (
    await db.query("SELECT current_user name,session_user principal")
  ).rows[0];
  const current = session.name;
  const name = role || current;
  const { rows } = await db.query(
    `SELECT r.rolname name,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,
 has_schema_privilege(r.oid,'public','CREATE') schema_create,has_database_privilege(r.oid,current_database(),'CREATE') database_create,
 (EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') AND pg_has_role(r.oid,c.relowner,'MEMBER')) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_has_role(r.oid,p.proowner,'MEMBER'))) owns_application_objects
 FROM pg_roles r WHERE r.rolname=$1`,
    [name],
  );
  const account = rows[0];
  const findings = [];
  if (!account)
    findings.push({ group: "runtime_role", object: name, reason: "missing" });
  else {
    if (
      account.rolsuper ||
      account.rolcreatedb ||
      account.rolcreaterole ||
      account.schema_create ||
      account.database_create ||
      account.owns_application_objects
    )
      findings.push({
        group: "runtime_role",
        object: name,
        reason: "persistent_ddl_or_owner_authority",
      });
    if (!account.rolbypassrls)
      findings.push({
        group: "runtime_role",
        object: name,
        reason:
          "trusted_backend_rls_bypass_required_by_current_server_authorization_architecture",
      });
    const objects = await db.query(
      `SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND NOT has_table_privilege($1,c.oid,'SELECT')`,
      [name],
    );
    for (const row of objects.rows)
      findings.push({
        group: "runtime_privilege",
        object: row.name,
        reason: "SELECT_missing",
      });
    const writes = await db.query(
      `SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT IN ('database_release_migrations','database_release_attestations','scop_request_purposes','scop_fulfillment_policies','scop_requirement_profiles','scop_fulfillment_allocations','scop_allocation_evidence','scop_allocation_commands') AND NOT (has_table_privilege($1,c.oid,'INSERT') AND has_table_privilege($1,c.oid,'UPDATE') AND has_table_privilege($1,c.oid,'DELETE'))`,
      [name],
    );
    for (const row of writes.rows)
      findings.push({
        group: "runtime_privilege",
        object: row.name,
        reason: "required_business_DML_missing",
      });
    // SCOP reference/history tables have an explicit least-privilege contract.
    // Presence/shape is certified by the catalog; this checks both missing and excess DML.
    const operationalPrivileges = await db.query(
      `WITH policy(name,allowed) AS (VALUES
      ('scop_request_purposes',ARRAY['SELECT']),('scop_fulfillment_policies',ARRAY['SELECT']),
      ('scop_requirement_profiles',ARRAY['SELECT','INSERT']),('scop_allocation_evidence',ARRAY['SELECT','INSERT']),
      ('scop_allocation_commands',ARRAY['SELECT','INSERT']),('scop_fulfillment_allocations',ARRAY['SELECT','INSERT','UPDATE'])
    ) SELECT p.name,privilege,privilege=ANY(p.allowed) AS required,
      has_table_privilege($1,c.oid,privilege) AS observed
    FROM policy p JOIN pg_class c ON c.relname=p.name JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege`,
      [name],
    );
    for (const row of operationalPrivileges.rows)
      if (row.required !== row.observed)
        findings.push({
          group: "runtime_privilege",
          object: row.name,
          reason: row.required
            ? "required_business_DML_missing"
            : "unreviewed_operational_privilege",
          privilege: row.privilege,
        });
    const routines = await db.query(
      `SELECT p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND NOT has_function_privilege($1,p.oid,'EXECUTE')`,
      [name],
    );
    for (const row of routines.rows)
      findings.push({
        group: "runtime_privilege",
        object: row.name,
        reason: "EXECUTE_missing",
      });
    const namespaces = await db.query(
      `SELECT n.nspname name FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND has_schema_privilege($1,n.oid,'CREATE')`,
      [name],
    );
    for (const row of namespaces.rows)
      if (row.name !== "public")
        findings.push({
          group: "runtime_role",
          object: row.name,
          reason: "persistent_ddl_or_owner_authority",
        });
    const sequences = await db.query(
      `SELECT DISTINCT s.relname name FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass AND d.deptype IN ('a','i') JOIN pg_class t ON t.oid=d.refobjid WHERE n.nspname='public' AND s.relkind='S' AND t.relname NOT IN ('database_release_migrations','database_release_attestations') AND NOT CASE WHEN s.relkind='S' THEN has_sequence_privilege($1,s.oid,'USAGE') ELSE true END`,
      [name],
    );
    for (const row of sequences.rows)
      findings.push({
        group: "runtime_privilege",
        object: row.name,
        reason: "sequence_USAGE_missing",
      });
    const ledgerWrites = await db.query(
      `SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('database_release_migrations','database_release_attestations') AND (has_table_privilege($1,c.oid,'INSERT') OR has_table_privilege($1,c.oid,'UPDATE') OR has_table_privilege($1,c.oid,'DELETE') OR has_table_privilege($1,c.oid,'TRUNCATE'))`,
      [name],
    );
    for (const row of ledgerWrites.rows)
      findings.push({
        group: "runtime_privilege",
        object: row.name,
        reason: "release_evidence_writable_by_runtime",
      });
  }
  if (!role && session.principal !== current) {
    const principal = await runtimeAuthority(db, session.principal);
    for (const finding of principal.findings.filter(
      (f) => f.reason === "persistent_ddl_or_owner_authority",
    ))
      findings.push({ ...finding, group: "connection_principal" });
  }
  return {
    connection_role: current,
    connection_principal: session.principal,
    target_role: name,
    assessment_mode: role ? "TARGET_ROLE_ONLY" : "ACTUAL_RUNTIME_CONNECTION",
    account,
    findings,
  };
}
async function verify(
  db,
  {
    releaseRef,
    environment,
    role = null,
    contract = loadContract(),
    inventory = loadInventory(),
    requireEvidence = true,
  } = {},
) {
  const fileErrors = verifyFiles(inventory),
    visibility = await catalog.visibility(db),
    actual = await catalog.snapshot(db, visibility),
    observableExpected = Object.fromEntries(
      Object.entries(contract.catalog).filter(
        ([group]) => !visibility.unobservableGroups.includes(group),
      ),
    ),
    findings = [
      ...fileErrors,
      ...visibility.findings,
      ...catalog.compare(observableExpected, actual),
    ];
  const authority = await runtimeAuthority(db, role);
  findings.push(...authority.findings);
  const observed = visibility.complete
      ? await catalog.fingerprint(db, actual)
      : null,
    contractDigest = hash(JSON.stringify(contract));
  let receipts = [],
    attestation = null,
    observedBaseline = null;
  const receiptsObservable = !visibility.unreadableRelations.includes(
    "database_release_migrations",
  );
  const attestationObservable = !visibility.unreadableRelations.includes(
    "database_release_attestations",
  );
  if (
    receiptsObservable &&
    actual.relations.some((r) => r.name === "database_release_migrations")
  )
    receipts = (
      await db.query(
        "SELECT migration_id,filename,content_sha256,execution_environment,execution_status,application_release_ref,evidence FROM public.database_release_migrations ORDER BY id",
      )
    ).rows;
  if (requireEvidence) {
    if (!releaseRef || !environment)
      findings.push({
        group: "release",
        reason: "explicit_release_and_environment_required",
      });
    const baselineId = contract.observed_baseline_migration;
    const baselineEntry =
      baselineId &&
      inventory.artifacts.find(
        (r) => r.id === baselineId && r.profile === contract.profile,
      );
    const baseline =
      baselineEntry &&
      receipts.find(
        (r) =>
          r.migration_id === path.basename(baselineEntry.path, ".sql") &&
          r.execution_environment === environment &&
          r.execution_status === "APPLIED" &&
          r.content_sha256 === baselineEntry.sha256 &&
          r.filename === baselineEntry.path &&
          r.evidence?.source === "REVIEWED_TRANSACTIONAL_FORWARD_BUNDLE" &&
          r.evidence?.observed_baseline_profile === contract.profile,
      );
    if (baseline)
      observedBaseline = {
        migration: baseline.migration_id,
        profile: contract.profile,
        historical_execution: "UNVERIFIED",
        observed_prior_controls: baselineEntry.observes_prior_controls,
      };
    for (const entry of inventory.artifacts.filter(
      (r) =>
        r.classification === "active_forward_migration" ||
        r.governed_receipt_required ||
        r.id === baselineId,
    )) {
      // Hidden ledger rows are unknown evidence, never proof of missing execution.
      if (!receiptsObservable) continue;
      const id = path.basename(entry.path, ".sql");
      const applied = receipts.find(
        (r) =>
          r.migration_id === id &&
          r.execution_environment === environment &&
          r.execution_status === "APPLIED",
      );
      if (
        !applied &&
        baseline &&
        baselineEntry.observes_prior_controls?.includes(entry.id)
      )
        continue;
      if (!applied)
        findings.push({
          group: "ledger",
          object: id,
          reason: "APPLIED_receipt_missing",
        });
      else if (
        applied.content_sha256 !== entry.sha256 ||
        applied.filename !== entry.path
      )
        findings.push({
          group: "ledger",
          object: id,
          reason: "CHECKSUM_MISMATCH",
        });
    }
    if (
      actual.relations.some(
        (r) => r.name === "database_release_attestations",
      ) &&
      observed &&
      attestationObservable &&
      releaseRef &&
      environment
    )
      attestation =
        (
          await db.query(
            `SELECT id FROM public.database_release_attestations WHERE contract_version=$1 AND contract_sha256=$2 AND observed_schema_sha256=$3 AND application_release_ref=$4 AND execution_environment=$5 AND application_manifest_sha256=$6`,
            [
              contract.version,
              contractDigest,
              observed,
              releaseRef,
              environment,
              inventory.application_manifest_sha256,
            ],
          )
        ).rows[0] || null;
    if (!attestation)
      findings.push({
        group: "attestation",
        reason:
          !observed || !attestationObservable
            ? "attestation_unverifiable_with_incomplete_visibility"
            : "current_schema_and_release_not_attested",
      });
  }
  return {
    restart_eligible: !findings.length && requireEvidence && !role,
    status: findings.length
      ? "BLOCKED"
      : requireEvidence
        ? "DATABASE_READY"
        : "SCHEMA_VERIFIED_UNATTESTED",
    application_release_ref: releaseRef || null,
    environment: environment || null,
    required_contract: contract.version,
    contract_sha256: contractDigest,
    application_manifest_sha256: inventory.application_manifest_sha256,
    observed_schema_sha256: observed,
    findings,
    runtime: authority,
    catalog_visibility: visibility,
    receipt_visibility: receiptsObservable
      ? "OBSERVABLE"
      : "UNVERIFIED_INSUFFICIENT_VISIBILITY",
    receipts,
    historical_migrations:
      "UNVERIFIED_UNLESS_SUPPORTED_BY_SEPARATE_TRUSTWORTHY_EVIDENCE",
    attestation,
    observed_baseline: observedBaseline,
  };
}
async function assertReady(db, options) {
  const report = await verify(db, options);
  if (report.status !== "DATABASE_READY")
    throw Object.assign(
      new Error(
        "Database release blocked; run the read-only release verifier and review manual SQL requirements",
      ),
      {
        code: "DATABASE_RELEASE_INCOMPATIBLE",
        statusCode: 503,
        findings: report.findings,
      },
    );
  return report;
}
async function startWhenReady(db, options, onReady) {
  if (options?.role)
    throw Object.assign(new Error("Runtime role override is not permitted"), {
      code: "RUNTIME_ROLE_OVERRIDE_NOT_ALLOWED",
    });
  // Pin startup verification to one connection and one consistent catalog snapshot.
  const borrowed =
    typeof db.totalCount === "number" && typeof db.connect === "function";
  const client = borrowed ? await db.connect() : db;
  let report;
  try {
    if (borrowed)
      await client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
    report = await assertReady(client, options);
    if (borrowed) await client.query("COMMIT");
  } catch (error) {
    if (borrowed) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (borrowed) client.release();
  }
  require("../utils/runtimeSchemaContract").markReleaseVerified(db);
  return onReady(report);
}

module.exports = {
  startWhenReady,
  CONTRACT_VERSION,
  loadContract,
  loadInventory,
  existingLedgers,
  runtimeAuthority,
  verify,
  assertReady,
};
