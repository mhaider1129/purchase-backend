const {
  normalizeNewRequestItem,
  validateRequestItemIdentity,
  resolveIdentity,
  assertProcurementReady,
} = require("../services/procurementItemIdentityService");
const {
  insertRequestedItem,
  prepareRequestedItemEdits,
  applyRequestedItemEdits,
} = require("../services/requestedItemWriteService");
const { isReady } = require("../services/sourcingReadinessService");
const actor = {
  id: 7,
  hasPermission: (code) => code === "item-master.free-text-exception",
};
const generic = {
  id: 4,
  generic_name: "Controlled item",
  canonical_description: "Canonical",
  inventory_uom: "EA",
};
const base = { item_name: "Demand wording", quantity: 2, unit_cost: 10 };
const client = () => ({
  query: jest.fn(async (sql) =>
    /FROM generic_items/.test(sql)
      ? { rowCount: 1, rows: [generic] }
      : /FROM approved_products/.test(sql)
        ? { rowCount: 1, rows: [{ id: 9, generic_item_id: 4 }] }
        : { rowCount: 1, rows: [{ id: 20 }] },
  ),
});

test.each([
  ["generic_item", { generic_item_id: 4 }, "catalogued", true],
  [
    "generic_item_with_preference",
    {
      generic_item_id: 4,
      preferred_product_id: 9,
      preferred_product_reason: "Clinical preference",
    },
    "catalogued",
    true,
  ],
  [
    "specific_approved_product",
    {
      generic_item_id: 4,
      mandatory_product_id: 9,
      restriction_justification: "Compatibility",
    },
    "catalogued",
    true,
  ],
  ["free_text", {}, "pending_mapping", false],
  [
    "pending_item_creation",
    { pending_item: { justification: "No appropriate catalog item" } },
    "pending_mapping",
    false,
  ],
  [
    "approved_free_text_exception",
    { restriction_justification: "Authorized emergency" },
    "approved_exception",
    true,
  ],
  ["service", {}, "approved_exception", true],
])(
  "%s has deterministic status and procurement readiness",
  async (mode, fields, status, ready) => {
    const result = await normalizeNewRequestItem(
      client(),
      { ...base, ...fields, request_mode: mode, catalog_status: "forged" },
      actor,
    );
    expect(result.catalog_status).toBe(status);
    expect(isReady(result)).toBe(ready);
    if (mode === "generic_item_with_preference")
      expect(result.mandatory_product_id).toBeNull();
  },
);
test("missing mode becomes unresolved demand; missing mode with IDs is rejected", async () => {
  expect(await normalizeNewRequestItem(client(), base, actor)).toMatchObject({
    request_mode: "free_text",
    catalog_status: "pending_mapping",
  });
  await expect(
    normalizeNewRequestItem(client(), { ...base, generic_item_id: 4 }, actor),
  ).rejects.toThrow(/request_mode/);
});
test.each(["generic", "typo", "approved_exception"])(
  "invalid mode %s is rejected",
  async (mode) => {
    await expect(
      normalizeNewRequestItem(client(), { ...base, request_mode: mode }, actor),
    ).rejects.toThrow(/valid request_mode/);
  },
);
test("exception permission and restriction justification cannot be bypassed", async () => {
  await expect(
    normalizeNewRequestItem(
      client(),
      {
        ...base,
        request_mode: "approved_free_text_exception",
        restriction_justification: "Urgent",
      },
      {},
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    normalizeNewRequestItem(
      client(),
      {
        ...base,
        request_mode: "specific_approved_product",
        generic_item_id: 4,
        mandatory_product_id: 9,
      },
      actor,
    ),
  ).rejects.toThrow(/justification/);
  await expect(
    normalizeNewRequestItem(
      client(),
      { ...base, request_mode: "pending_item_creation" },
      actor,
    ),
  ).rejects.toThrow(/justification/);
});
test("wrong Product and accidental mandatory preference are rejected", async () => {
  const db = client();
  db.query
    .mockResolvedValueOnce({ rowCount: 1, rows: [generic] })
    .mockResolvedValueOnce({ rowCount: 0, rows: [] });
  await expect(
    validateRequestItemIdentity(
      db,
      {
        ...base,
        request_mode: "generic_item_with_preference",
        generic_item_id: 4,
        preferred_product_id: 9,
      },
      actor,
    ),
  ).rejects.toThrow(/belong/);
  await expect(
    normalizeNewRequestItem(
      client(),
      {
        ...base,
        request_mode: "generic_item_with_preference",
        generic_item_id: 4,
        preferred_product_id: 9,
        mandatory_product_id: 9,
      },
      actor,
    ),
  ).rejects.toThrow(/mandatory/);
});
test("legacy NULL remains readable but cannot source or award", () => {
  const legacy = {
    id: 2,
    item_name: "Historical wording",
    request_mode: null,
    catalog_status: null,
  };
  expect(JSON.parse(JSON.stringify(legacy)).item_name).toBe(
    "Historical wording",
  );
  expect(isReady(legacy)).toBe(false);
  expect(() => assertProcurementReady(legacy)).toThrow(
    expect.objectContaining({ code: "ITEM_IDENTITY_RESOLUTION_REQUIRED" }),
  );
});
test("historical import explicitly inserts NULL state without approved defaults", async () => {
  const db = client();
  await insertRequestedItem(db, 3, base, actor, { historical: true });
  const [sql, values] = db.query.mock.calls[0];
  const columns = sql.match(/\(request_id,([^)]*)\)/)[1].split(",");
  expect(values[1 + columns.indexOf("request_mode")]).toBeNull();
  expect(values[1 + columns.indexOf("catalog_status")]).toBeNull();
});
test("new insertion persists the same normalized identity used by creation", async () => {
  const input = {
    ...base,
    request_mode: "generic_item_with_preference",
    generic_item_id: 4,
    preferred_product_id: 9,
    preferred_product_reason: "Preference",
    required_date: "2026-11-01",
  };
  const expected = await normalizeNewRequestItem(client(), input, actor);
  const db = client();
  await insertRequestedItem(db, 3, input, actor);
  const [sql, values] = db.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO public.requested_items"),
  );
  const columns = sql.match(/\(request_id,([^)]*)\)/)[1].split(",");
  for (const key of [
    "request_mode",
    "catalog_status",
    "generic_item_id",
    "preferred_product_id",
    "mandatory_product_id",
    "preferred_product_reason",
    "required_date",
  ])
    expect(values[1 + columns.indexOf(key)]).toEqual(expected[key] ?? null);
});
test.each([null, "generic_item", "approved_free_text_exception"])(
  "ordinary edits preserve ID and stored %s identity",
  async (mode) => {
    const stored = {
      ...base,
      id: 11,
      request_mode: mode,
      catalog_status:
        mode === "generic_item"
          ? "catalogued"
          : mode
            ? "approved_exception"
            : null,
      generic_item_id: mode === "generic_item" ? 4 : null,
      restriction_justification:
        mode === "approved_free_text_exception" ? "Existing approval" : null,
      item_name_snapshot: "Original wording",
      canonical_description_snapshot: "Original canonical description",
      required_date: "2026-11-01",
    };
    const db = {
      query: jest.fn(async (sql) =>
        sql.startsWith("SELECT *") ? { rows: [stored] } : { rows: [] },
      ),
    };
    const result = await applyRequestedItemEdits(
      db,
      3,
      [{ id: 11, ...base, quantity: 3 }],
      { id: 8 },
    );
    expect(result[0]).toMatchObject({
      id: 11,
      request_mode: mode,
      quantity: 3,
      item_name_snapshot: "Original wording",
      required_date: "2026-11-01",
    });
    expect(
      db.query.mock.calls.some(([sql]) =>
        /DELETE|INSERT INTO public.requested_items/.test(sql),
      ),
    ).toBe(false);
  },
);
test("foreign, duplicate, omitted and ID-less replacement edits cannot destroy lineage", async () => {
  const db = {
    query: jest
      .fn()
      .mockResolvedValue({
        rows: [{ ...base, id: 11, request_mode: null, catalog_status: null }],
      }),
  };
  await expect(
    prepareRequestedItemEdits(db, 3, [{ ...base, id: 99 }], actor),
  ).rejects.toThrow(/belong/);
  await expect(
    prepareRequestedItemEdits(
      db,
      3,
      [
        { ...base, id: 11 },
        { ...base, id: 11 },
      ],
      actor,
    ),
  ).rejects.toThrow(/unique/);
  await expect(
    prepareRequestedItemEdits(db, 3, [base], actor),
  ).rejects.toMatchObject({
    code: "REQUEST_ITEM_REMOVAL_REQUIRES_CONTROLLED_ACTION",
  });
});
test("explicit identity edits revalidate exception authority", async () => {
  const db = {
    query: jest
      .fn()
      .mockResolvedValue({
        rows: [{ ...base, id: 11, request_mode: null, catalog_status: null }],
      }),
  };
  await expect(
    prepareRequestedItemEdits(
      db,
      3,
      [
        {
          ...base,
          id: 11,
          request_mode: "approved_free_text_exception",
          restriction_justification: "Change",
        },
      ],
      { id: 8 },
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
});

test("resolution clears obsolete mandatory identity and validates the new Generic", async () => {
  const result = await resolveIdentity(
    client(),
    {
      ...base,
      mandatory_product_id: 9,
      restriction_justification: "Old restriction",
      item_name_snapshot: "Original wording",
      request_mode: "specific_approved_product",
    },
    { request_mode: "generic_item", generic_item_id: 4 },
    actor,
  );
  expect(result).toMatchObject({
    request_mode: "generic_item",
    catalog_status: "catalogued",
    generic_item_id: 4,
    preferred_product_id: null,
    mandatory_product_id: null,
    restriction_justification: null,
    item_name_snapshot: "Original wording",
  });
});
test("serialized approval dates preserve identity without reclassification", async () => {
  const stored = {
    ...base,
    id: 11,
    request_mode: null,
    catalog_status: null,
    required_date: new Date("2026-11-01T00:00:00Z"),
  };
  const db = { query: jest.fn().mockResolvedValue({ rows: [stored] }) };
  const result = await prepareRequestedItemEdits(
    db,
    3,
    [{ id: 11, required_date: "2026-11-01T00:00:00.000Z" }],
    actor,
  );
  expect(result[0]).toMatchObject({
    identityChanged: false,
    request_mode: null,
    catalog_status: null,
  });
  expect(db.query).toHaveBeenCalledTimes(1);
});
test.each([null, "free_text", "pending_item_creation"])(
  "award rejects unresolved %s before writing",
  async (mode) => {
    const { createAward } = require("../services/procurementAwardService");
    const tx = {
      lockRequestItem: jest
        .fn()
        .mockResolvedValue({
          id: 11,
          request_id: 3,
          request_mode: mode,
          catalog_status: "pending_mapping",
        }),
      insert: jest.fn(),
    };
    await expect(
      createAward({
        repository: { withTransaction: (work) => work(tx) },
        requestItem: { id: 11 },
        supplier: { id: 2 },
        input: { awarded_quantity: 1 },
        actor,
      }),
    ).rejects.toMatchObject({ code: "ITEM_IDENTITY_RESOLUTION_REQUIRED" });
    expect(tx.insert).not.toHaveBeenCalled();
  },
);
test("PO conversion rejects legacy identity even with an existing award", async () => {
  const {
    createPurchaseOrderFromAwards,
  } = require("../services/purchaseOrderService");
  const tx = {
    lockAwards: async () => [
      {
        id: 8,
        status: "ACTIVE",
        supplier_id: 2,
        request_id: 3,
        currency: "USD",
        awarded_quantity: 1,
        approved_product_id: 9,
        supplier_catalog_item_id: 10,
      },
    ],
    getAwardConversion: async () => ({ remaining_quantity: 1 }),
    loadAwardUomSnapshot: async () => ({
      generic_item_id: 4,
      request_mode: null,
      catalog_status: null,
    }),
    insertHeader: jest.fn(),
  };
  await expect(
    createPurchaseOrderFromAwards({
      repository: { withTransaction: (work) => work(tx) },
      awardIds: [8],
      actor,
    }),
  ).rejects.toMatchObject({ code: "ITEM_IDENTITY_RESOLUTION_REQUIRED" });
  expect(tx.insertHeader).not.toHaveBeenCalled();
});

test.each([
  "existing_generic",
  "existing_product",
  "supplier_catalog_only",
  "approved_free_text_exception",
])(
  "pending resolution %s writes the central contract and clears old restrictions",
  async (resolutionType) => {
    const {
      ItemMasterFoundationService,
    } = require("../services/itemMasterFoundationService");
    const db = client();
    db.release = jest.fn();
    db.query.mockImplementation(async (sql) => {
      if (/SELECT p\.\*/.test(sql))
        return {
          rowCount: 1,
          rows: [
            {
              id: 21,
              status: "review",
              request_id: 3,
              requested_item_id: 11,
              proposed_name: "Demand wording",
            },
          ],
        };
      if (/SELECT \* FROM public.requested_items/.test(sql))
        return {
          rowCount: 1,
          rows: [
            {
              ...base,
              id: 11,
              request_id: 3,
              mandatory_product_id: 77,
              request_mode: "pending_item_creation",
            },
          ],
        };
      if (/FROM generic_items/.test(sql))
        return { rowCount: 1, rows: [generic] };
      return { rowCount: 1, rows: [{ id: 21 }] };
    });
    await new ItemMasterFoundationService({
      connect: async () => db,
    }).resolvePending(
      21,
      {
        resolution_type: resolutionType,
        generic_item_id: 4,
        product_id: 9,
        supplier_catalog_item_id: 14,
        notes: "Steward decision",
      },
      actor,
    );
    const [sql, values] = db.query.mock.calls.find(([sql]) =>
      sql.includes("UPDATE public.requested_items SET generic_item_id"),
    );
    expect(sql).toContain("mandatory_product_id=$4");
    expect(values[3]).toBeNull();
    expect(values[4]).toBe(
      resolutionType === "existing_generic"
        ? "generic_item"
        : resolutionType === "approved_free_text_exception"
          ? "approved_free_text_exception"
          : "generic_item_with_preference",
    );
    expect(values[5]).toBe(
      resolutionType === "approved_free_text_exception"
        ? "approved_exception"
        : "catalogued",
    );
    expect(db.query).toHaveBeenCalledWith("COMMIT");
  },
);
