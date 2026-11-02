const policy = require("../services/legacyContractSettlementPolicy");
const fs = require("node:fs");
const path = require("node:path");
const actor = { institute_id: 1, hasPermission: () => true };
const contract = {
  amount_paid: "9007199254740993.00",
  actual_consumed_value: "10.00",
  resolved_institute_id: 1,
};
test("financial routes cannot be added without explicit containment coverage", () => {
  const routes = fs.readFileSync(
    path.join(__dirname, "../routes/contracts.js"),
    "utf8",
  );
  for (const [, endpoint, handler] of routes.matchAll(
    /router\.(?:post|patch|delete)\('([^']+)',\s*(\w+)\)/g,
  )) {
    if (/\/(payments|invoices|consumption-entries)(\/|$)/.test(endpoint))
      expect(policy.MUTATIONS.has(handler)).toBe(true);
  }
});
test("identical stored amounts use exact equality and do not grant a financial writer", () => {
  expect(() =>
    policy.assertAllowed({
      name: "updateContract",
      body: {
        amount_paid: "9007199254740993.0000",
        actual_consumed_value: "10",
      },
      contract,
      actor,
    }),
  ).not.toThrow();
  for (const value of [
    "9007199254740992.00",
    "9007199254740993.00000000000000001",
    null,
    "",
  ])
    expect(() =>
      policy.assertAllowed({
        name: "updateContract",
        body: { amount_paid: value },
        contract,
        actor,
      }),
    ).toThrow(expect.objectContaining({ statusCode: 410, code: policy.CODE }));
});
test("new roots accept an empty balance but cannot import an unreconciled paid amount", () => {
  for (const amount_paid of [null, 0, "0.00"])
    expect(() =>
      policy.assertAllowed({
        name: "createContract",
        body: { amount_paid },
        actor,
      }),
    ).not.toThrow();
  expect(() =>
    policy.assertAllowed({
      name: "createContract",
      body: { amount_paid: 1 },
      actor,
    }),
  ).toThrow(expect.objectContaining({ statusCode: 410 }));
});
test("renewal never confers cross-institute finance authority", () => {
  expect(() =>
    policy.assertAllowed({
      name: "renewContract",
      body: { amount_paid: 1 },
      contract: { ...contract, resolved_institute_id: 2 },
      actor,
    }),
  ).toThrow(expect.objectContaining({ statusCode: 404 }));
  expect(() =>
    policy.assertAllowed({
      name: "renewContract",
      body: { amount_paid: null },
      contract,
      actor,
    }),
  ).not.toThrow();
});
