const {
  isCompatibilityCandidate,
  loadPolicy,
  assertReadyForCommand,
  updatePolicy,
} = require("../services/procurementIdentityPolicyService");
const line = {
  id: 7,
  request_id: 4,
  request_mode: "free_text",
  catalog_status: "pending_mapping",
  stocking_policy: "non_stock",
};
function client(enforce = false) {
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes("to_regclass")) return { rows: [{ available: true }] };
      if (sql.includes("SELECT enforce_item_identity"))
        return {
          rows: [{ enforce_item_identity: enforce, reason: "Catalog setup" }],
        };
      if (sql.startsWith("UPDATE"))
        return { rows: [{ id: 1, enforce_item_identity: enforce }] };
      return { rows: [] };
    }),
  };
}
test("missing migration and missing singleton both fail closed", async () => {
  const db = {
    query: jest.fn().mockResolvedValue({ rows: [{ available: false }] }),
  };
  expect(await loadPolicy(db)).toMatchObject({
    enforce_item_identity: true,
    configured: false,
  });
  await expect(assertReadyForCommand(db, line)).rejects.toMatchObject({
    code: "ITEM_IDENTITY_RESOLUTION_REQUIRED",
  });
  await expect(
    updatePolicy(
      db,
      { enforce_item_identity: false, reason: "Setup" },
      { id: 1 },
    ),
  ).rejects.toMatchObject({ code: "IDENTITY_POLICY_SCHEMA_MISSING" });
  const empty = client();
  empty.query
    .mockResolvedValueOnce({ rows: [{ available: true }] })
    .mockResolvedValueOnce({ rows: [] });
  expect(await loadPolicy(empty)).toMatchObject({
    enforce_item_identity: true,
    configured: false,
  });
});
test.each([null, "free_text"])(
  "compatibility permits %s description-only demand and audits without reclassification",
  async (mode) => {
    const db = client();
    const item = { ...line, request_mode: mode };
    await assertReadyForCommand(db, item, { id: 3 }, "register_procurement");
    expect(db.query.mock.calls.some(([sql]) => sql.includes("FOR SHARE"))).toBe(
      true,
    );
    const [, values] = db.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO item_master_audit_events"),
    );
    expect(values[2]).toBe("procurement.compatibility_used");
    expect(values[3]).toBe(3);
    expect(item).toEqual({ ...line, request_mode: mode });
  },
);
test.each([
  { request_mode: "pending_item_creation" },
  { request_mode: "unknown" },
  { request_mode: "" },
  { generic_item_id: 1 },
  { mandatory_product_id: 1 },
  { preferred_product_id: 1 },
  { stocking_policy: "stock" },
  { stocking_policy: "service" },
  { approval_status: "Rejected" },
])(
  "compatibility rejects invalid or unresolved governed states %j",
  async (patch) => {
    const db = client();
    const item = { ...line, ...patch };
    expect(isCompatibilityCandidate(item)).toBe(false);
    await expect(
      assertReadyForCommand(db, item, { id: 1 }),
    ).rejects.toMatchObject({ code: "ITEM_IDENTITY_RESOLUTION_REQUIRED" });
    expect(db.query).not.toHaveBeenCalled();
  },
);
test("strict policy blocks commands; changes require boolean, reason and a row lock", async () => {
  const db = client(true);
  await expect(assertReadyForCommand(db, line)).rejects.toMatchObject({
    code: "ITEM_IDENTITY_RESOLUTION_REQUIRED",
  });
  await expect(
    updatePolicy(
      db,
      { enforce_item_identity: "false", reason: "Setup" },
      { id: 1 },
    ),
  ).rejects.toMatchObject({ statusCode: 400 });
  await expect(
    updatePolicy(db, { enforce_item_identity: false, reason: " " }, { id: 1 }),
  ).rejects.toMatchObject({ statusCode: 400 });
  await updatePolicy(
    db,
    { enforce_item_identity: false, reason: "Setup" },
    { id: 1 },
  );
  expect(db.query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(
    true,
  );
  expect(
    db.query.mock.calls.some(([, values]) => values?.[2] === "policy.updated"),
  ).toBe(true);
});

test.each([{stocking_policy:'unknown'},{catalog_status:'catalogued'},{catalog_status:'approved_exception'}])('compatibility fails closed for inconsistent metadata %j',async patch=>{
  await expect(assertReadyForCommand(client(),{...line,...patch},{id:1})).rejects.toMatchObject({code:'ITEM_IDENTITY_RESOLUTION_REQUIRED'});
});
