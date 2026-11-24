"use strict";
// Builds only a runner-created disposable PostgreSQL database from reviewed
// catalog metadata. Never reachable from application startup or release CLI.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { loadProfile } = require("../scripts/lib/databaseRelease/profiles");
const catalog = require("../scripts/lib/databaseRelease/catalog");
const quote = (value) => '"' + String(value).replaceAll('"', '""') + '"';
async function build(client, url) {
  require("./disposableDatabase").disposableDatabaseUrl(url);
  const observed = loadProfile("wici-2026-11", "observed").catalog;
  const canonical = (
    await client.query(
      "SELECT p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')",
    )
  ).rows;
  const style = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "fixtures/wici-function-styles.json"),
      "utf8",
    ),
  );
  await client.query(
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions; SET search_path=public,extensions,pg_catalog; SET check_function_bodies=off",
  );
  // btree_gist functions are extension implementation, not application functions.
  // The normal runner already installs it in a separate schema, if needed below.
  const tables = observed.relations.filter((r) => ["r", "p"].includes(r.kind));
  const sequences = new Set();
  for (const column of observed.columns) {
    const found = /nextval\('([^']+)'::regclass\)/.exec(
      column.default_expression || "",
    );
    if (found) sequences.add(found[1]);
  }
  for (const sequence of sequences)
    await client.query(
      `CREATE SEQUENCE IF NOT EXISTS public.${quote(sequence.replace(/^public\./, ""))}`,
    );
  for (const table of tables) {
    const columns = observed.columns.filter((c) => c.relation === table.name);
    const definitions = columns.map(
      (c) =>
        `${quote(c.name)} ${c.type}${c.identity ? ` GENERATED ${c.identity === "a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY` : c.generated ? ` GENERATED ALWAYS AS (${c.default_expression}) STORED` : c.default_expression != null ? ` DEFAULT ${c.default_expression}` : ""}${c.not_null ? " NOT NULL" : ""}`,
    );
    await client.query(
      `CREATE TABLE public.${quote(table.name)} (${definitions.join(",")})`,
    );
  }
  // The upload describes defaults/identity but not pg_depend sequence ownership.
  // Reconstruct conventional serial ownership for this disposable fixture only.
  for (const column of observed.columns.filter(
    (c) => c.name === "id" && !c.identity,
  )) {
    const sequence = /nextval\('([^']+)'::regclass\)/.exec(
      column.default_expression || "",
    )?.[1];
    if (
      sequence &&
      sequence.replace(/^public\./, "") === `${column.relation}_id_seq`
    )
      await client.query(
        `ALTER SEQUENCE public.${quote(sequence.replace(/^public\./, ""))} OWNED BY public.${quote(column.relation)}.${quote(column.name)}`,
      );
  }
  for (const constraint of observed.constraints.filter((c) => c.type !== "f"))
    await client.query(
      `ALTER TABLE public.${quote(constraint.relation)} ADD CONSTRAINT ${quote(constraint.name)} ${constraint.definition}`,
    );
  const constraintNames = new Set(
    observed.constraints.map((c) => c.relation + "." + c.name),
  );
  for (const index of observed.indexes) {
    if (
      !index.primary_index &&
      !constraintNames.has(index.relation + "." + index.name)
    )
      await client.query(index.definition);
  }
  for (const constraint of observed.constraints.filter((c) => c.type === "f"))
    await client.query(
      `ALTER TABLE public.${quote(constraint.relation)} ADD CONSTRAINT ${quote(constraint.name)} ${constraint.definition}`,
    );
  const viewSql = fs.readFileSync(
    path.join(__dirname, "../sql/manual/059_backend_contract_refresh.sql"),
    "utf8",
  );
  for (const body of viewSql.matchAll(
    /\$view_body\$(CREATE OR REPLACE VIEW stock_item_[\s\S]*?)\$view_body\$/g,
  ))
    await client.query(body[1]);
  await client.query(
    `CREATE VIEW public.audit_log AS SELECT id,user_id,action::text action_type,target_type::text,target_id,description::text details,created_at AS timestamp FROM public.audit_logs`,
  );
  for (const functionRow of observed.functions) {
    const k = catalog.key("functions", functionRow);
    let definition = canonical.find(
      (f) => catalog.key("functions", f) === k,
    )?.definition;
    if (!definition)
      definition = style.extra_functions.find(
        (f) => catalog.key("functions", f) === k,
      )?.definition;
    assert(definition, `Missing reviewed fixture function ${k}`);
    const format = style.style[k];
    if (format) {
      if (format.marker_comment)
        definition = definition.replace(
          /(\n\s*BEGIN\n)\n/,
          "$1      -- SQL_027_FUNCTION_CONTRACT_V1\n",
        );
      const start =
          definition.indexOf("AS $function$") + "AS $function$".length,
        end = definition.lastIndexOf("$function$");
      definition =
        definition.slice(0, start) +
        definition.slice(start, end).replaceAll("\n", "\r\n") +
        definition.slice(end);
    }
    await client.query(definition);
  }
  for (const trigger of observed.triggers)
    await client.query(trigger.definition);
  for (const table of tables) {
    if (table.rls)
      await client.query(
        `ALTER TABLE public.${quote(table.name)} ENABLE ROW LEVEL SECURITY`,
      );
    if (table.force_rls)
      await client.query(
        `ALTER TABLE public.${quote(table.name)} FORCE ROW LEVEL SECURITY`,
      );
  }
  for (const policy of observed.policies)
    await client.query(
      `CREATE POLICY ${quote(policy.name)} ON public.${quote(policy.relation)} AS ${policy.permissive} FOR ${policy.cmd} TO ${policy.roles.map(quote).join(",")} ${policy.qual ? "USING (" + policy.qual + ")" : ""} ${policy.with_check ? "WITH CHECK (" + policy.with_check + ")" : ""}`,
    );
  for (const row of observed.browser_table_grants) {
    const privileges = ["select", "insert", "update", "delete"].filter(
      (p) => row["can_" + p],
    );
    if (privileges.length)
      await client.query(
        `GRANT ${privileges.join(",")} ON public.${quote(row.relation)} TO ${quote(row.role)}`,
      );
  }
  for (const row of observed.browser_function_grants) {
    if (!row.can_execute)
      await client.query(
        `REVOKE EXECUTE ON FUNCTION public.${quote(row.name)}(${row.arguments}) FROM PUBLIC,${quote(row.role)}`,
      );
  }
  await client.query(
    "GRANT USAGE ON SCHEMA public TO purchase_backend; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO purchase_backend; REVOKE ALL ON database_release_migrations,database_release_attestations FROM purchase_backend; GRANT SELECT ON database_release_migrations,database_release_attestations TO purchase_backend; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO purchase_backend; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO purchase_backend",
  );
  for (const row of observed.permissions)
    await client.query("INSERT INTO permissions(code,name) VALUES($1,$1)", [
      row.code,
    ]);
  for (const row of observed.ui_resources)
    await client.query(
      "INSERT INTO ui_resource_permissions(resource_key,label,permissions,require_all) VALUES($1,$1,$2,$3)",
      [row.resource_key, row.permissions, row.require_all],
    );
  for (const row of observed.route_policies)
    await client.query(
      "INSERT INTO route_capability_policies(route_prefix,module,resource,permissions) VALUES($1,$2,$3,$4)",
      [row.route_prefix, row.module, row.resource, row.permissions],
    );
  for (const row of observed.reference_accounts)
    await client.query(
      "INSERT INTO finance_chart_of_accounts(code,name,account_type) VALUES($1,$1,$2)",
      [row.code, row.code.startsWith("2") ? "liability" : "expense"],
    );
  for (const row of observed.evaluation_criteria_codes)
    await client.query(
      "INSERT INTO evaluation_criteria(code,name,role,components) VALUES($1,$1,'SCM','[]')",
      [row.code],
    );
  await client.query("SET check_function_bodies=on");
  const reconstructed = await catalog.snapshot(client);
  const findings = catalog.compare(observed, reconstructed);
  // pg_get_*def is not byte-idempotent when its pretty-printed SQL is parsed
  // again (notably varchar ARRAY casts). Each expression above was executed
  // verbatim; accept only re-deparsed definitions in this disposable fixture.
  // Production profile matching remains exact, including these definitions.
  const unexpected = findings.filter(
    (f) =>
      !["constraints", "indexes"].includes(f.group) ||
      JSON.stringify(f.fields) !== JSON.stringify(["definition"]),
  );
  assert.deepEqual(unexpected, [], JSON.stringify(unexpected).slice(0, 5000));
  return { observed, reconstructed, deparsed: findings };
}
module.exports = { build };
function fixtureContract(contract, fixture) {
  const result = structuredClone(contract);
  for (const f of fixture.deparsed) {
    const old = fixture.observed[f.group].find(
      (r) => catalog.key(f.group, r) === f.object,
    );
    const replacement = fixture.reconstructed[f.group].find(
      (r) => catalog.key(f.group, r) === f.object,
    );
    const row = result.catalog[f.group].find(
      (r) => catalog.key(f.group, r) === f.object,
    );
    if (row && row.definition === old.definition)
      row.definition = replacement.definition;
  }
  return result;
}
module.exports.fixtureContract = fixtureContract;
