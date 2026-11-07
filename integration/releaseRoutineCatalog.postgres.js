"use strict";
const assert = require("node:assert/strict");
const catalog = require("../scripts/lib/databaseRelease/catalog");
module.exports = async (client, url) => {
  require("./disposableDatabase").disposableDatabaseUrl(url);
  let count = 0;
  const check = async (name, fn) => {
    await fn();
    count++;
    console.log("PASS routine catalog: " + name);
  };
  await client.query(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA extensions; CREATE EXTENSION btree_gist WITH SCHEMA public",
  );
  const before = await catalog.snapshot(client);
  await check(
    "canonical public vendor routines are captured with real extension membership",
    async () => {
      const e = await catalog.routineEvidence(client);
      assert(before.functions.some((r) => r.name === "cash_dist"));
      assert(
        e.functions.some(
          (r) =>
            r.name === "gbt_bit_compress" &&
            r.schema_name === "public" &&
            r.extension_name === "btree_gist",
        ),
      );
      assert.deepEqual(catalog.compare(before, before), []);
    },
  );
  await client.query("ALTER EXTENSION btree_gist SET SCHEMA extensions");
  const moved = await catalog.snapshot(client),
    evidence = await catalog.routineEvidence(client);
  await check(
    "a relocated function is present as extension evidence, never silently equivalent",
    async () => {
      assert(!moved.functions.some((r) => r.name === "cash_dist"));
      const findings = catalog.explainRoutineFindings(
        catalog.compare(before, moved),
        evidence,
      );
      const cash = findings.find(
        (r) =>
          r.group === "functions" && r.object === "cash_dist(money, money)",
      );
      assert(cash);
      assert.equal(cash.reason, "missing");
      assert.equal(cash.category, "extension_environment_review");
      assert(
        cash.routine_evidence.some(
          (r) =>
            r.schema_name === "extensions" && r.extension_name === "btree_gist",
        ),
      );
      assert.equal(
        cash.disposition,
        "BLOCKING_REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE",
      );
    },
  );
  await check(
    "browser execution and namespace usage are recorded independently",
    async () => {
      const g = evidence.browserGrants.find(
        (r) => r.name === "cash_dist" && r.role === "anon",
      );
      assert.equal(g.can_execute, true);
      assert.equal(g.schema_usage, false);
      assert(
        !catalog
          .explainRoutineFindings([], evidence)
          .some((r) => r.reason === "extension_browser_grant_requires_review"),
      );
    },
  );
  await client.query(
    "CREATE FUNCTION public.cash_dist(money,money) RETURNS money LANGUAGE sql IMMUTABLE AS 'SELECT $1'",
  );
  await check(
    "an unowned public namesake cannot hide application body drift",
    async () => {
      const actual = await catalog.snapshot(client),
        e = await catalog.routineEvidence(client);
      const f = catalog
        .explainRoutineFindings(catalog.compare(before, actual), e)
        .find(
          (r) =>
            r.group === "functions" && r.object === "cash_dist(money, money)",
        );
      assert.equal(f.reason, "contract_drift");
      assert(f.fields.includes("definition_md5"));
      assert.equal(f.category, undefined);
    },
  );
  await client.query(
    "CREATE FUNCTION extensions.gbt_fake(integer) RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT $1'",
  );
  await check(
    "extension schema and gbt prefix never grant provenance to application SECURITY DEFINER code",
    async () => {
      const e = await catalog.routineEvidence(client),
        f = e.functions.find((r) => r.name === "gbt_fake");
      assert.equal(f.extension_name, null);
      const findings = catalog.explainRoutineFindings([], e);
      assert(
        findings.some(
          (r) =>
            r.reason === "unreviewed_security_definer" &&
            r.category === "application_security",
        ),
      );
      assert(
        findings.some(
          (r) =>
            r.reason === "unreviewed_security_object" &&
            r.category === "application_security",
        ),
      );
    },
  );
  await client.query("GRANT USAGE ON SCHEMA extensions TO anon,authenticated");
  await check(
    "newly reachable vendor browser grants remain blocking review findings",
    async () => {
      const findings = catalog.explainRoutineFindings(
        [],
        await catalog.routineEvidence(client),
      );
      assert(
        findings.some(
          (r) =>
            r.reason === "extension_browser_grant_requires_review" &&
            r.routine_evidence[0].name === "cash_dist",
        ),
      );
    },
  );
  await client.query(
    "ALTER FUNCTION extensions.cash_dist(money,money) SECURITY DEFINER",
  );
  await check(
    "extension membership cannot exempt an unreviewed SECURITY DEFINER",
    async () => {
      const findings = catalog.explainRoutineFindings(
        [],
        await catalog.routineEvidence(client),
      );
      assert(
        findings.some(
          (r) =>
            r.reason === "unreviewed_security_definer" &&
            r.category === "extension_security_review",
        ),
      );
    },
  );
  console.log(`Routine catalog PostgreSQL scenarios passed: ${count}`);
};
