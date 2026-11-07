"use strict";
const catalog = require("../scripts/lib/databaseRelease/catalog");
const { verificationConnection } = require("../scripts/databaseRelease");
afterEach(() => {
  delete process.env.DB_RUNTIME_ROLE;
});
test("RLS-hidden reference rows are unobservable, not missing permissions", async () => {
  const db = {
    query: jest.fn().mockResolvedValue({
      rows: [
        { relation: "permissions", can_select: true, rls_active: true },
        {
          relation: "database_release_migrations",
          can_select: true,
          rls_active: true,
        },
        {
          relation: "ui_resource_permissions",
          can_select: true,
          rls_active: false,
        },
      ],
    }),
  };
  const result = await catalog.visibility(db);
  expect(result.complete).toBe(false);
  expect(result.unobservableGroups).toEqual(["permissions"]);
  expect(result.unreadableRelations).toContain("database_release_migrations");
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        group: "catalog_visibility",
        object: "permissions",
        reason: "row_security_may_hide_reference_or_release_evidence",
      }),
    ]),
  );
});
test("missing SELECT is reported before querying protected reference rows", async () => {
  const db = {
    query: jest.fn().mockResolvedValue({
      rows: [{ relation: "permissions", can_select: false, rls_active: false }],
    }),
  };
  expect((await catalog.visibility(db)).findings[0].reason).toBe(
    "SELECT_missing",
  );
});
test("a complete owner/bypass snapshot remains observable without relaxing RLS", async () => {
  const db = {
    query: jest.fn().mockResolvedValue({
      rows: [{ relation: "permissions", can_select: true, rls_active: false }],
    }),
  };
  expect((await catalog.visibility(db)).complete).toBe(true);
  expect(db.query.mock.calls[0][0]).toContain("pg_catalog.row_security_active");
});
test("diagnostics never inherit the runtime SET ROLE configuration", () => {
  process.env.DB_RUNTIME_ROLE = "purchase_backend";
  const connection = verificationConnection({});
  expect(connection.mode).toBe("diagnostic");
  expect(connection.Client).toBe(require("pg").Client);
});
test("runtime acceptance is explicit and cannot use a hypothetical backend role", () => {
  process.env.DB_RUNTIME_ROLE = "purchase_backend";
  expect(
    verificationConnection({ "connection-mode": "runtime" }).Client,
  ).not.toBe(require("pg").Client);
  expect(() =>
    verificationConnection({
      "connection-mode": "runtime",
      "backend-role": "purchase_backend",
    }),
  ).toThrow("RUNTIME_ROLE_OVERRIDE_NOT_ALLOWED");
  expect(() => verificationConnection({ "connection-mode": "skip" })).toThrow(
    "CONNECTION_MODE_MUST_BE_DIAGNOSTIC_OR_RUNTIME",
  );
});
test("numeric scale, RLS and validated-key differences remain explicit drift", () => {
  expect(
    catalog.compare(
      { columns: [{ relation: "receipt", name: "quantity", type: "numeric" }] },
      {
        columns: [
          { relation: "receipt", name: "quantity", type: "numeric(14,2)" },
        ],
      },
    ),
  ).toHaveLength(1);
  expect(
    catalog.compare(
      { relations: [{ name: "requests", rls: false }] },
      { relations: [{ name: "requests", rls: true }] },
    ),
  ).toHaveLength(1);
  expect(
    catalog.compare(
      {
        constraints: [
          {
            relation: "x",
            name: "fk",
            validated: false,
            definition: "FOREIGN KEY (id) REFERENCES y(id) NOT VALID",
          },
        ],
      },
      {
        constraints: [
          {
            relation: "x",
            name: "fk",
            validated: true,
            definition: "FOREIGN KEY (id) REFERENCES y(id)",
          },
        ],
      },
    ),
  ).toHaveLength(1);
});
test("retained AP numeric(14,2) matches the canonical accounting amount policy", () => {
  const {
    parseAccountingAmount,
  } = require("../services/accountingEntryValidation");
  const c = require("../scripts/lib/databaseRelease/profiles").loadProfile(
    "wici-2026-11",
  ).catalog;
  for (const [relation, name] of [
    ["ap_payables", "invoice_total"],
    ["ap_payables", "open_balance"],
    ["ap_voucher_lines", "debit_amount"],
    ["ap_voucher_lines", "credit_amount"],
  ])
    expect(
      c.columns.find((r) => r.relation === relation && r.name === name).type,
    ).toBe("numeric(14,2)");
  expect(parseAccountingAmount("999999999999.99", "AP amount")).toBe(
    99999999999999n,
  );
  expect(() => parseAccountingAmount("0.001", "AP amount")).toThrow(
    expect.objectContaining({ code: "ACCOUNTING_AMOUNT_PRECISION" }),
  );
  expect(() => parseAccountingAmount("1000000000000.00", "AP amount")).toThrow(
    expect.objectContaining({ code: "ACCOUNTING_AMOUNT_OUT_OF_RANGE" }),
  );
});
