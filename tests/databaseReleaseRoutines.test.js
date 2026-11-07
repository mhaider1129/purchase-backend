"use strict";
const catalog = require("../scripts/lib/databaseRelease/catalog");
const expected = {
  functions: [
    {
      name: "cash_dist",
      arguments: "money, money",
      definition_md5: "approved",
      security_definer: false,
    },
  ],
  browser_function_grants: [
    {
      name: "cash_dist",
      arguments: "money, money",
      role: "anon",
      can_execute: true,
    },
  ],
};
const fn = {
  schema_name: "extensions",
  name: "cash_dist",
  arguments: "money, money",
  definition_md5: "relocated",
  security_definer: false,
  extension_name: "btree_gist",
  extension_version: "1.8",
};
const grant = { ...fn, role: "anon", can_execute: true, schema_usage: true };
const evidence = (functions = [fn], browserGrants = [grant]) => ({
  functions,
  browserGrants,
  extensions: [],
  server: { version_num: 170000 },
});
test("relocated extension members explain missing public requirements but remain blocking findings", () => {
  const missing = catalog.compare(expected, {
    functions: [],
    browser_function_grants: [],
  });
  const result = catalog.explainRoutineFindings(missing, evidence());
  expect(result).toHaveLength(2);
  for (const f of result) {
    expect(f.reason).toBe("missing");
    expect(f.expected_schema).toBe("public");
    expect(f.category).toBe("extension_environment_review");
    expect(f.disposition).toBe(
      "BLOCKING_REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE",
    );
  }
});
test("matching names in extensions do not turn application-owned functions into trusted extension members", () => {
  const result = catalog.explainRoutineFindings(
    catalog.compare(expected, { functions: [], browser_function_grants: [] }),
    evidence(
      [{ ...fn, extension_name: null }],
      [{ ...grant, extension_name: null }],
    ),
  );
  expect(result.find((f) => f.group === "functions").category).toBe(
    "application_routine_review",
  );
});
test("public application body and browser-grant changes remain strict despite extension namesakes", () => {
  const actual = {
    functions: [{ ...expected.functions[0], definition_md5: "tampered" }],
    browser_function_grants: [
      { ...expected.browser_function_grants[0], can_execute: false },
    ],
  };
  const findings = catalog.compare(expected, actual);
  const result = catalog.explainRoutineFindings(
    findings,
    evidence(
      [{ ...fn, schema_name: "public", extension_name: null }, fn],
      [
        {
          ...grant,
          schema_name: "public",
          extension_name: null,
          can_execute: false,
        },
        grant,
      ],
    ),
  );
  expect(result).toEqual(expect.arrayContaining(findings));
  expect(
    result.find((f) => f.object === "cash_dist(money, money)").category,
  ).toBeUndefined();
});
test("unowned SECURITY DEFINER and browser access under extensions are never excluded", () => {
  const result = catalog.explainRoutineFindings(
    [],
    evidence(
      [
        {
          ...fn,
          name: "gbt_fake",
          security_definer: true,
          extension_name: null,
        },
      ],
      [
        {
          ...grant,
          name: "gbt_fake",
          extension_name: null,
          schema_usage: false,
        },
      ],
    ),
  );
  expect(result).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reason: "unreviewed_security_definer",
        category: "application_security",
      }),
      expect.objectContaining({
        reason: "unreviewed_security_object",
        category: "application_security",
      }),
    ]),
  );
});
test("extension vendor browser exposure requires review; no-USAGE vendor rows remain evidence only", () => {
  expect(catalog.explainRoutineFindings([], evidence([], [grant]))).toEqual([
    expect.objectContaining({
      reason: "extension_browser_grant_requires_review",
    }),
  ]);
  expect(
    catalog.explainRoutineFindings(
      [],
      evidence([], [{ ...grant, schema_usage: false }]),
    ),
  ).toEqual([]);
  expect(
    catalog.explainRoutineFindings(
      [],
      evidence([{ ...fn, security_definer: true }], []),
    ),
  ).toEqual([
    expect.objectContaining({
      reason: "unreviewed_security_definer",
      category: "extension_security_review",
    }),
  ]);
});
test("evidence query proves extension membership through pg_depend rather than schema/name prefixes", async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await catalog.routineEvidence(db);
  expect(db.query.mock.calls[2][0]).toContain("d.deptype='e'");
  expect(db.query.mock.calls[2][0]).toContain("pg_extension");
  expect(db.query.mock.calls[3][0]).toContain("has_schema_privilege");
  expect(db.query.mock.calls[2][0]).not.toContain(
    "pg_get_functiondef(p.oid) definition,",
  );
  expect(catalog.queries.functions).toContain("n.nspname='public'"); // legacy fingerprint unchanged
});
test("qualified extension types produce candidate evidence without normalizing away the contract failure", () => {
  const findings = [
    {
      group: "functions",
      object: "gbt_bit_same(gbtreekey_var, internal)",
      reason: "missing",
    },
  ];
  const result = catalog.explainRoutineFindings(
    findings,
    evidence(
      [
        {
          ...fn,
          name: "gbt_bit_same",
          arguments: "extensions.gbtreekey_var, internal",
        },
      ],
      [],
    ),
  );
  expect(result[0].category).toBe("extension_environment_review");
  expect(result[0].reason).toBe("missing");
  expect(result[0].routine_evidence[0].arguments).toBe(
    "extensions.gbtreekey_var, internal",
  );
});
