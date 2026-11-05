"use strict";
const catalog = require("../scripts/lib/databaseRelease/catalog");
const fs = require("fs"),
  path = require("path");
const verifiedPools = new WeakSet(),
  clientPools = new WeakMap();
function registerClient(client, pool) {
  if (client && typeof client === "object") clientPools.set(client, pool);
}
function markReleaseVerified(pool) {
  verifiedPools.add(pool);
}
async function assertModuleContract(moduleKey, db) {
  const runner = db?.query ? db : require("../config/db");
  // A successful full startup verification, not a CREATE IF NOT EXISTS cache.
  if (verifiedPools.has(runner) || verifiedPools.has(clientPools.get(runner)))
    return true;
  const release = require("../services/databaseReleaseService");
  const contract = release.loadContract();
  const modules = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../database/releases/runtime-modules.json"),
      "utf8",
    ),
  );
  const tables = modules[moduleKey];
  if (
    !Array.isArray(tables) ||
    !tables.length ||
    tables.some(
      (table) =>
        !contract.catalog.relations.some((relation) => relation.name === table),
    )
  )
    throw Object.assign(new Error("Unregistered database module contract"), {
      code: "DATABASE_MODULE_UNREGISTERED",
      statusCode: 503,
    });
  const actual = {
    relations: (
      await runner.query(
        `SELECT c.relname name,c.relkind::text kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,
        [tables],
      )
    ).rows,
    columns: (
      await runner.query(
        `SELECT c.relname relation,a.attname name,format_type(a.atttypid,a.atttypmod) type FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped`,
        [tables],
      )
    ).rows,
  };
  // Local compatibility checks are not release certification. The full startup
  // gate separately verifies constraints/indexes/functions/grants/RLS and evidence.
  const expected = {
    relations: contract.catalog.relations
      .filter((r) => tables.includes(r.name))
      .map(({ name, kind }) => ({ name, kind })),
    columns: contract.catalog.columns
      .filter((r) => tables.includes(r.relation))
      .map(({ relation, name, type }) => ({ relation, name, type })),
  };
  const findings = catalog.compare(expected, actual);
  if (findings.length)
    throw Object.assign(
      new Error(
        `Database module ${moduleKey} is incompatible; apply the reviewed forward release plan, never runtime schema repair`,
      ),
      { code: "DATABASE_MODULE_CONTRACT_MISSING", statusCode: 503, findings },
    );
  return true;
}
module.exports = { assertModuleContract, markReleaseVerified, registerClient };
