"use strict";
const fs = require("fs"),
  path = require("path");
const { root, hash, verifyFiles } = require("./inventory");
const { migrationBody } = require("./sqlStatements");
const { queries, businessQueries } = require("./catalog");
const literal = (v) => "'" + String(v).replace(/'/g, "''") + "'";
function selectMigrations(inventory, ids, profile = null) {
  const checksumErrors = verifyFiles(inventory);
  if (checksumErrors.length)
    throw Object.assign(new Error("CHECKSUM_MISMATCH"), {
      findings: checksumErrors,
    });
  const active = inventory.artifacts.filter((r) =>
    profile
      ? r.classification === "manual_recovery_migration" &&
        r.profile === profile
      : r.classification === "active_forward_migration",
  );
  const requested = ids?.length
    ? ids
    : active.map((r) => path.basename(r.path, ".sql"));
  const selected = requested.map((id) => {
    const r = inventory.artifacts.find(
      (a) => path.basename(a.path, ".sql") === id,
    );
    if (!r) throw new Error("UNKNOWN_MIGRATION");
    if (
      r.classification !== "active_forward_migration" &&
      !(
        r.classification === "manual_recovery_migration" &&
        r.profile === profile
      )
    )
      throw new Error("FROZEN_REPLAY_DISABLED");
    return r;
  });
  validateOrder(
    selected,
    new Set(
      inventory.artifacts
        .filter(
          (r) =>
            r.governed_receipt_required &&
            r.classification === "frozen_historical_migration",
        )
        .map((r) => path.basename(r.path, ".sql")),
    ),
  );
  return selected;
}
function validateOrder(selected, prior = new Set()) {
  const positions = new Map(
    selected.map((r, i) => [path.basename(r.path, ".sql"), i]),
  );
  for (let i = 0; i < selected.length; i++)
    for (const dep of selected[i].depends_on || []) {
      const p = positions.get(dep);
      if ((p === undefined && !prior.has(dep)) || p >= i)
        throw new Error("MIGRATION_ORDER_OR_PREREQUISITE_INVALID");
    }
  return selected;
}
function snapshotExpression() {
  const groups = { ...queries, ...businessQueries };
  return `jsonb_build_object(${Object.entries(groups)
    .flatMap(([key, q]) => [
      literal(key),
      `(SELECT COALESCE(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) FROM (${q}) rows)`,
    ])
    .join(",")})`;
}
function checks(expected, { preflight = false } = {}) {
  const selected = {};
  for (const [k, rows] of Object.entries(expected)) {
    if (
      preflight &&
      (k.startsWith("browser_") ||
        [
          "permissions",
          "route_policies",
          "reference_accounts",
          "evaluation_criteria_codes",
        ].includes(k))
    )
      continue;
    selected[k] = preflight
      ? rows.filter(
          (r) =>
            !String(r.relation || r.name).startsWith("database_release_") &&
            r.name !== "preserve_database_release_evidence",
        )
      : rows;
  }
  return `expected := ${literal(JSON.stringify(selected))}::jsonb;
 FOR section, wanted IN SELECT key,value FROM jsonb_each(expected) LOOP
  FOR required IN SELECT value FROM jsonb_array_elements(wanted) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(actual->section,'[]')) observed(value) WHERE observed.value @> required) THEN
    RAISE EXCEPTION 'DATABASE_CONTRACT_INVALID: % %',section,required->>'name';
   END IF;
  END LOOP;
  IF section IN ('policies','browser_table_grants','browser_function_grants') AND NOT (COALESCE(actual->section,'[]') <@ wanted) THEN
   RAISE EXCEPTION 'DATABASE_SECURITY_DRIFT: %',section;
  END IF;
 END LOOP;`;
}
function bundle({ inventory, contract, ids, environment, actor, releaseRef }) {
  if (
    !["development", "staging", "production", "disposable"].includes(
      environment,
    ) ||
    !String(actor || "").trim() ||
    !String(releaseRef || "").trim()
  )
    throw new Error("EXPLICIT_ENVIRONMENT_ACTOR_AND_RELEASE_REQUIRED");
  const selected = selectMigrations(inventory, ids, contract.profile);
  if (selected.length !== 1)
    throw new Error("REVIEW_ONE_TRANSACTIONAL_FORWARD_STEP_AT_A_TIME");
  const entry = selected[0],
    id = path.basename(entry.path, ".sql"),
    sql = fs.readFileSync(path.join(root, entry.path), "utf8"),
    body = migrationBody(sql);
  const tag = "$db_release_" + entry.sha256.slice(0, 16) + "$";
  if (body.includes(tag)) throw new Error("SQL_BUNDLE_DELIMITER_COLLISION");
  const preflight = entry.profile
    ? require("./profiles").loadProfile(entry.profile, "observed")
    : entry.preflight_contract
      ? JSON.parse(
          fs.readFileSync(path.join(root, entry.preflight_contract), "utf8"),
        )
      : contract;
  const preflightChecks =
    entry.profile || entry.preflight_contract
      ? `BEGIN
 ${checks(preflight.catalog, { preflight: true })}
 EXCEPTION WHEN raise_exception THEN
 ${checks(contract.catalog, { preflight: true })}
 END;`
      : checks(preflight.catalog, { preflight: true });
  if (entry.profile && entry.profile !== contract.profile)
    throw Error("RECOVERY_PROFILE_REQUIRED");
  const dependencies = (entry.depends_on || [])
    .map((dep) => {
      const previous = inventory.artifacts.find(
        (r) => path.basename(r.path, ".sql") === dep,
      );
      if (!previous) throw new Error("UNKNOWN_MIGRATION_PREREQUISITE");
      return `IF NOT EXISTS(SELECT 1 FROM public.database_release_migrations WHERE migration_id=${literal(dep)} AND filename=${literal(previous.path)} AND content_sha256=${literal(previous.sha256)} AND execution_environment=${literal(environment)} AND execution_status='APPLIED') THEN RAISE EXCEPTION 'DATABASE_RELEASE_PREREQUISITE_RECEIPT_MISSING'; END IF;`;
    })
    .join("\n");
  const fingerprint = `encode(sha256(convert_to(actual::text,'UTF8')),'hex')`;
  return `-- Generated offline. Review checksum, actor, environment and release before manual SQL Editor execution.
-- Historical migrations remain UNVERIFIED. This bundle never replays a frozen file.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5min';
${entry.profile ? "SET LOCAL search_path = public, extensions, pg_catalog;" : ""}
DO ${tag}
DECLARE started timestamptz:=clock_timestamp(); actual jsonb; expected jsonb; section text; wanted jsonb; required jsonb; prior_hash text;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('purchase-tracker:database-release',0)) THEN RAISE EXCEPTION 'DATABASE_RELEASE_BUSY'; END IF;
 IF NOT has_schema_privilege(current_user,'public','CREATE') THEN RAISE EXCEPTION 'DATABASE_MIGRATION_OWNER_REQUIRED'; END IF;
 IF to_regclass('public.permissions') IS NULL OR to_regclass('public.ui_resource_permissions') IS NULL THEN RAISE EXCEPTION 'DATABASE_BASELINE_PREREQUISITE_MISSING'; END IF;
 IF to_regclass('public.database_release_migrations') IS NOT NULL THEN
  EXECUTE 'SELECT content_sha256 FROM public.database_release_migrations WHERE migration_id=$1 AND execution_environment=$2 AND execution_status=''APPLIED''' INTO prior_hash USING ${literal(id)},${literal(environment)};
  IF prior_hash IS NOT NULL AND prior_hash<>${literal(entry.sha256)} THEN RAISE EXCEPTION 'MIGRATION_CHECKSUM_MISMATCH'; END IF;
 END IF;
${dependencies}
 IF prior_hash IS NULL THEN
  actual := ${snapshotExpression()};
  ${preflightChecks}
  EXECUTE ${literal(body)};
 END IF;
 actual := ${snapshotExpression()};
 ${checks(contract.catalog)}
 INSERT INTO public.database_release_migrations(migration_id,filename,content_sha256,execution_environment,execution_status,execution_actor,duration_ms,application_release_ref,evidence)
 VALUES(${literal(id)},${literal(entry.path)},${literal(entry.sha256)},${literal(environment)},'APPLIED',${literal(actor)},EXTRACT(epoch FROM clock_timestamp()-started)*1000,${literal(releaseRef)},jsonb_build_object('source','REVIEWED_TRANSACTIONAL_FORWARD_BUNDLE','contract_version',${literal(contract.version)}${entry.profile ? ", 'observed_baseline_profile'," + literal(entry.profile) + ", 'historical_execution','UNVERIFIED'" : ""}))
 ON CONFLICT(execution_environment,migration_id) WHERE execution_status='APPLIED' DO NOTHING;
 IF EXISTS(SELECT 1 FROM public.database_release_attestations WHERE application_release_ref=${literal(releaseRef)} AND execution_environment=${literal(environment)} AND application_manifest_sha256<>${literal(inventory.application_manifest_sha256)}) THEN RAISE EXCEPTION 'APP_RELEASE_REF_ALREADY_BOUND_TO_DIFFERENT_CODE'; END IF;
 INSERT INTO public.database_release_attestations(contract_version,contract_sha256,application_manifest_sha256,observed_schema_sha256,execution_environment,application_release_ref,reviewed_by)
 VALUES(${literal(contract.version)},${literal(hash(JSON.stringify(contract)))},${literal(inventory.application_manifest_sha256)},${fingerprint},${literal(environment)},${literal(releaseRef)},${literal(actor)}) ON CONFLICT DO NOTHING;
END ${tag};
COMMIT;
`;
}
module.exports = {
  literal,
  validateOrder,
  selectMigrations,
  snapshotExpression,
  checks,
  bundle,
};
