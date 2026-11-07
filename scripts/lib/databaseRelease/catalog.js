"use strict";
// Catalog SELECTs only. No application pool, dotenv, secret or connection creation.
const queries = {
  relations: `SELECT c.relname name,c.relkind::text kind,c.relrowsecurity rls,c.relforcerowsecurity force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') ORDER BY 1`,
  columns: `SELECT c.relname relation,a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null,a.attidentity::text identity,a.attgenerated::text generated,pg_get_expr(d.adbin,d.adrelid) default_expression FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2`,
  constraints: `SELECT c.relname relation,k.conname name,k.contype::text type,k.convalidated validated,k.condeferrable deferrable,k.condeferred deferred,pg_get_constraintdef(k.oid,true) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1,2`,
  indexes: `SELECT t.relname relation,c.relname name,i.indisunique unique_index,i.indisprimary primary_index,i.indisvalid valid,i.indisready ready,i.indimmediate immediate,i.indnullsnotdistinct nulls_not_distinct,pg_get_indexdef(i.indexrelid,0,true) definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY 1,2`,
  functions: `SELECT p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result,p.prosecdef security_definer,p.provolatile::text volatility,p.proconfig config,md5(pg_get_functiondef(p.oid)) definition_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY 1,2`,
  triggers: `SELECT c.relname relation,t.tgname name,t.tgenabled::text enabled,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2`,
  policies: `SELECT tablename relation,policyname name,permissive,roles::text[] roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2`,
  browser_table_grants: `SELECT c.relname relation,r.rolname role,has_table_privilege(r.oid,c.oid,'SELECT') can_select,has_table_privilege(r.oid,c.oid,'INSERT') can_insert,has_table_privilege(r.oid,c.oid,'UPDATE') can_update,has_table_privilege(r.oid,c.oid,'DELETE') can_delete FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND r.rolname IN ('anon','authenticated') ORDER BY 1,2`,
  browser_function_grants: `SELECT p.proname name,pg_get_function_identity_arguments(p.oid) arguments,r.rolname role,has_function_privilege(r.oid,p.oid,'EXECUTE') can_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND p.prokind='f' AND r.rolname IN ('anon','authenticated') ORDER BY 1,2,3`,
};
const businessQueries = {
  permissions: "SELECT code FROM public.permissions ORDER BY code",
  ui_resources:
    "SELECT resource_key,permissions,require_all FROM public.ui_resource_permissions ORDER BY resource_key",
  route_policies:
    "SELECT route_prefix,module,resource,permissions FROM public.route_capability_policies ORDER BY route_prefix",
  evaluation_criteria_codes:
    "SELECT code FROM public.evaluation_criteria WHERE code IN ('contract_compliance','supplier_contractor_performance','financial_performance','risk_issue_management','sustainability_compliance','stakeholder_satisfaction') ORDER BY code",
  reference_accounts:
    "SELECT code FROM public.finance_chart_of_accounts WHERE code IN ('5000-PROC-EXP','2100-AP-ACCRUAL') ORDER BY code",
};
const referenceRelations = {
  permissions: "permissions",
  ui_resources: "ui_resource_permissions",
  route_policies: "route_capability_policies",
  reference_accounts: "finance_chart_of_accounts",
  evaluation_criteria_codes: "evaluation_criteria",
};
// Evidence is deliberately outside the legacy snapshot/fingerprint. Existing
// receipts must never be made valid by silently changing their catalog scope.
const routineFrom = `FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 LEFT JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid
   AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
 LEFT JOIN pg_extension e ON e.oid=d.refobjid`;
const routineWhere = `WHERE p.prokind IN ('f','p')
 AND n.nspname NOT IN ('pg_catalog','information_schema')
 AND (n.nspname IN ('public','extensions') OR e.oid IS NOT NULL)`;
async function routineEvidence(db) {
  const server = (
    await db.query(
      "SELECT current_setting('server_version_num')::int version_num,current_setting('server_version') version,ARRAY(SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','purchase_backend') ORDER BY rolname) release_roles_present",
    )
  ).rows[0];
  const extensions = (
    await db.query(
      "SELECT e.extname name,e.extversion version,n.nspname schema_name FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY 1",
    )
  ).rows;
  const functions = (
    await db.query(`SELECT n.nspname schema_name,p.proname name,
    pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result,
    p.prosecdef security_definer,p.provolatile::text volatility,
    md5(pg_get_functiondef(p.oid)) definition_md5,e.extname extension_name,e.extversion extension_version
    ${routineFrom} ${routineWhere} ORDER BY 1,2,3`)
  ).rows;
  const browserGrants = (
    await db.query(`SELECT n.nspname schema_name,p.proname name,
    pg_get_function_identity_arguments(p.oid) arguments,r.rolname role,
    has_function_privilege(r.oid,p.oid,'EXECUTE') can_execute,
    has_schema_privilege(r.oid,n.oid,'USAGE') schema_usage,
    e.extname extension_name,e.extversion extension_version
    ${routineFrom} CROSS JOIN pg_roles r ${routineWhere}
    AND p.prokind='f' AND r.rolname IN ('anon','authenticated') ORDER BY 1,2,3,4`)
  ).rows;
  return { server, extensions, functions, browserGrants };
}
// Candidate-only rendering comparison for extension-owned signatures whose
// type namespace becomes explicit after relocation/search-path changes. This
// never changes compare(), fingerprints, or the blocking missing finding.
function routineCandidateKey(group, row) {
  if (!row.extension_name || !/^[a-z_][a-z0-9_]*$/.test(row.schema_name))
    return key(group, row);
  return key(group, {
    ...row,
    arguments: row.arguments.replace(
      new RegExp("\\b" + row.schema_name + "\\.", "g"),
      "",
    ),
  });
}
function explainRoutineFindings(findings, evidence) {
  const result = findings.map((finding) => {
    if (!["functions", "browser_function_grants"].includes(finding.group))
      return finding;
    const rows =
      finding.group === "functions"
        ? evidence.functions
        : evidence.browserGrants;
    const counterparts =
      finding.reason === "missing"
        ? rows.filter(
            (r) =>
              r.schema_name !== "public" &&
              (key(finding.group, r) === finding.object ||
                routineCandidateKey(finding.group, r) === finding.object),
          )
        : [];
    const publicRow = rows.find(
      (r) =>
        r.schema_name === "public" && key(finding.group, r) === finding.object,
    );
    if (counterparts.length || publicRow?.extension_name)
      return {
        ...finding,
        category: counterparts.some((r) => !r.extension_name)
          ? "application_routine_review"
          : "extension_environment_review",
        expected_schema: "public",
        routine_evidence: counterparts.length ? counterparts : [publicRow],
        disposition: "BLOCKING_REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE",
      };
    return finding;
  });
  for (const row of evidence.functions.filter(
    (r) => r.schema_name !== "public" && r.security_definer,
  ))
    result.push({
      group: "functions",
      object: `${row.schema_name}.${key("functions", row)}`,
      reason: "unreviewed_security_definer",
      category: row.extension_name
        ? "extension_security_review"
        : "application_security",
      routine_evidence: [row],
    });
  for (const row of evidence.browserGrants.filter(
    (r) =>
      r.schema_name !== "public" &&
      r.can_execute &&
      (!r.extension_name || r.schema_usage),
  )) {
    if (
      result.some(
        (f) =>
          f.group === "browser_function_grants" &&
          f.routine_evidence?.some(
            (r) =>
              r.schema_name === row.schema_name &&
              key("browser_function_grants", r) ===
                key("browser_function_grants", row),
          ),
      )
    )
      continue;
    result.push({
      group: "browser_function_grants",
      object: `${row.schema_name}.${key("browser_function_grants", row)}`,
      reason: row.extension_name
        ? "extension_browser_grant_requires_review"
        : "unreviewed_security_object",
      category: row.extension_name
        ? "extension_security_review"
        : "application_security",
      routine_evidence: [row],
    });
  }
  return result;
}
async function visibility(db) {
  const rows = (
    await db.query(
      `SELECT c.relname relation,
      has_table_privilege(current_user,c.oid,'SELECT') can_select,
      pg_catalog.row_security_active(c.oid) rls_active
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,
      [
        [
          ...Object.values(referenceRelations),
          "database_release_migrations",
          "database_release_attestations",
        ],
      ],
    )
  ).rows;
  const hidden = rows.filter((r) => !r.can_select || r.rls_active);
  const unreadableRelations = hidden.map((r) => r.relation);
  return {
    complete: hidden.length === 0,
    unreadableRelations,
    unobservableGroups: Object.entries(referenceRelations)
      .filter(([, relation]) => unreadableRelations.includes(relation))
      .map(([group]) => group),
    findings: hidden.map((r) => ({
      group: "catalog_visibility",
      object: r.relation,
      reason: !r.can_select
        ? "SELECT_missing"
        : "row_security_may_hide_reference_or_release_evidence",
    })),
  };
}
async function snapshot(db, { unobservableGroups = [] } = {}) {
  const result = {};
  for (const [k, sql] of Object.entries(queries))
    result[k] = (await db.query(sql)).rows;
  const present = new Set(result.relations.map((r) => r.name));
  for (const [group, relation] of Object.entries(referenceRelations))
    result[group] =
      present.has(relation) && !unobservableGroups.includes(group)
        ? (await db.query(businessQueries[group])).rows
        : [];
  return result;
}
const key = (group, row) =>
  group === "columns"
    ? `${row.relation}.${row.name}`
    : group === "functions"
      ? `${row.name}(${row.arguments})`
      : ["permissions", "evaluation_criteria_codes"].includes(group)
        ? row.code
        : group === "ui_resources"
          ? row.resource_key
          : group === "route_policies"
            ? row.route_prefix
            : group === "reference_accounts"
              ? row.code
              : group.startsWith("browser_")
                ? `${row.relation || row.name}:${row.arguments || ""}:${row.role}`
                : row.relation
                  ? `${row.relation}.${row.name}`
                  : row.name;
function compare(expected, actual, { tables = null } = {}) {
  const findings = [];
  for (const [group, rows] of Object.entries(expected)) {
    const got = new Map((actual[group] || []).map((r) => [key(group, r), r]));
    for (const row of rows) {
      if (
        tables &&
        !(
          tables.includes(row.relation || row.name) ||
          ["functions", "policies", "permissions", "ui_resources"].includes(
            group,
          )
        )
      )
        continue;
      const found = got.get(key(group, row));
      if (!found)
        findings.push({ group, object: key(group, row), reason: "missing" });
      else if (JSON.stringify(found) !== JSON.stringify(row)) {
        // JSON key order is not part of a database contract.
        const different = Object.keys(row).filter(
          (k) => JSON.stringify(found[k]) !== JSON.stringify(row[k]),
        );
        if (different.length)
          findings.push({
            group,
            object: key(group, row),
            reason: "contract_drift",
            fields: different,
          });
      }
    }
    if (group === "functions") {
      const known = new Set(rows.map((r) => key(group, r)));
      for (const r of actual.functions || [])
        if (r.security_definer && !known.has(key(group, r)))
          findings.push({
            group,
            object: key(group, r),
            reason: "unreviewed_security_definer",
          });
    }
    // Extra policies or browser privileges can weaken isolation even if expected rows exist.
    if (
      ["policies", "browser_table_grants", "browser_function_grants"].includes(
        group,
      )
    ) {
      const known = new Set(rows.map((r) => key(group, r)));
      for (const r of actual[group] || [])
        if (
          !known.has(key(group, r)) &&
          (group === "policies" ||
            Object.keys(r).some((k) => k.startsWith("can_") && r[k]))
        )
          findings.push({
            group,
            object: key(group, r),
            reason: "unreviewed_security_object",
          });
    }
  }
  return findings;
}
async function fingerprint(db, actual) {
  return (
    await db.query(
      "SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') digest",
      [JSON.stringify(actual)],
    )
  ).rows[0].digest;
}
module.exports = {
  queries,
  businessQueries,
  routineEvidence,
  explainRoutineFindings,
  visibility,
  snapshot,
  key,
  compare,
  fingerprint,
};
