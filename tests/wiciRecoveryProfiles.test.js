const fs = require("node:fs"),
  path = require("node:path");
const {
  applyOverlay,
  loadProfile,
} = require("../scripts/lib/databaseRelease/profiles");
const service = require("../services/databaseReleaseService");
const base = require("../database/releases/schema-contract.json");
const observed = require("../database/releases/profiles/wici-observed.json");
afterEach(() => {
  delete process.env.DB_RELEASE_SCHEMA_PROFILE;
});
test("canonical readiness remains the default; unknown profile paths are rejected", () => {
  expect(service.loadContract()).toEqual(base);
  process.env.DB_RELEASE_SCHEMA_PROFILE = "../../unreviewed";
  expect(() => service.loadContract()).toThrow("UNKNOWN_DATABASE_PROFILE");
});
test("the approved profile is tied to the unchanged canonical source contract", () => {
  expect(() => applyOverlay({ ...base, version: "changed" }, observed)).toThrow(
    "DATABASE_PROFILE_BASE_CHANGED",
  );
  expect(() => loadProfile("wici-2026-11", "../../other")).toThrow(
    "UNKNOWN_DATABASE_PROFILE",
  );
});
test("observed controls keep enabled RLS, validated foreign keys and generated UOM alias", () => {
  const c = loadProfile("wici-2026-11", "observed").catalog;
  expect(c.relations.find((r) => r.name === "requests").rls).toBe(true);
  expect(
    c.columns.find((r) => r.relation === "item_uom" && r.name === "name")
      .generated,
  ).toBe("s");
  expect(
    c.constraints.find((r) => r.name === "ai_interactions_user_id_fkey")
      .validated,
  ).toBe(true);
  expect(
    c.columns.find(
      (r) => r.relation === "ap_payables" && r.name === "invoice_total",
    ).type,
  ).toBe("numeric(14,2)");
});
test("recovery catalog adds prerequisites and blocks the legacy stock mutation trigger", () => {
  const c = loadProfile("wici-2026-11").catalog;
  expect(c.relations.some((r) => r.name === "contract_financial_reviews")).toBe(
    true,
  );
  expect(
    c.relations.some((r) => r.name === "scop_fulfillment_allocations"),
  ).toBe(true);
  expect(
    c.triggers.find((r) => r.name === "trg_approve_stock_item_request").enabled,
  ).toBe("D");
  expect(
    c.browser_table_grants.every(
      (r) => !r.can_select && !r.can_insert && !r.can_update && !r.can_delete,
    ),
  ).toBe(true);
});
test("new forward SQL does not silently backfill history or alter posted amounts", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../sql/manual/073_wici_observed_schema_recovery.sql"),
    "utf8",
  );
  expect(sql).not.toMatch(
    /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE)\s+public\.(?:journal_entries|journal_entry_lines|payments|ap_payables|contract_payments|inventory_transactions)\b/i,
  );
  expect(sql).toContain(
    "WICI_RECOVERY_DUPLICATE_JOURNAL_REFERENCE_REQUIRES_FINANCE_REVIEW",
  );
});
test("recovery is manual and cannot enter a canonical release plan", () => {
  const {
    selectMigrations,
  } = require("../scripts/lib/databaseRelease/planner");
  const inventory = service.loadInventory();
  expect(selectMigrations(inventory).map((r) => r.id)).toEqual(["072"]);
  expect(() =>
    selectMigrations(inventory, ["073_wici_observed_schema_recovery"]),
  ).toThrow("FROZEN_REPLAY_DISABLED");
  expect(
    selectMigrations(inventory, undefined, "wici-2026-11").map((r) => r.id),
  ).toEqual(["073"]);
});
test("fractional operational quantities widen while monetary precision stays unchanged", () => {
  const c = loadProfile("wici-2026-11").catalog;
  const column = (relation, name) =>
    c.columns.find((r) => r.relation === relation && r.name === name);
  expect(column("goods_receipt_items", "received_quantity").type).toBe(
    "numeric",
  );
  expect(
    column("goods_receipt_items", "technical_accepted_quantity").type,
  ).toBe("numeric");
  expect(column("item_conversion", "conversion_factor").type).toBe("numeric");
  expect(column("ap_payables", "invoice_total").type).toBe("numeric(14,2)");
  expect(column("goods_receipt_items", "unit_price").type).toBe(
    "numeric(14,2)",
  );
});
test("checked-in operator SQL is reproducible from the final source-bound plan", () => {
  const {
    bundle,
    selectMigrations,
  } = require("../scripts/lib/databaseRelease/planner");
  const inventory = service.loadInventory();
  const actual = fs.readFileSync(
    path.join(
      __dirname,
      "../sql/operator-recovery/wici-production-recovery.sql",
    ),
    "utf8",
  );
  expect(actual).toBe(
    bundle({
      inventory,
      contract: loadProfile("wici-2026-11"),
      ids: ["073_wici_observed_schema_recovery"],
      environment: "production",
      actor: "WICI authorized operator",
      releaseRef: "wici-recovery-2026-11-07-r3",
    }),
  );
  expect(() =>
    selectMigrations(inventory, ["wici-production-recovery"], "wici-2026-11"),
  ).toThrow("FROZEN_REPLAY_DISABLED");
});
