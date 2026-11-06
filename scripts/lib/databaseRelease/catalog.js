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
async function snapshot(db) {
  const result = {};
  for (const [k, sql] of Object.entries(queries))
    result[k] = (await db.query(sql)).rows;
  const present = new Set(result.relations.map((r) => r.name));
  result.permissions = present.has("permissions")
    ? (await db.query(businessQueries.permissions)).rows
    : [];
  result.ui_resources = present.has("ui_resource_permissions")
    ? (await db.query(businessQueries.ui_resources)).rows
    : [];
  result.route_policies = present.has("route_capability_policies")
    ? (await db.query(businessQueries.route_policies)).rows
    : [];
  result.reference_accounts = present.has("finance_chart_of_accounts")
    ? (await db.query(businessQueries.reference_accounts)).rows
    : [];
  result.evaluation_criteria_codes = present.has("evaluation_criteria")
    ? (await db.query(businessQueries.evaluation_criteria_codes)).rows
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
  snapshot,
  key,
  compare,
  fingerprint,
};
