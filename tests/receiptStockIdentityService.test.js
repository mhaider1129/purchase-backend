const {
  resolveReceiptStockItem,
} = require("../services/receiptStockIdentityService");
const identity = {
  generic_item_id: 4,
  approved_product_id: 9,
  base_uom_id: 2,
  warehouse_id: 7,
};
test("queries the immutable receipt identity, UOM, approved mapping and warehouse without first-row fallback", async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 22 }] }) };
  expect(await resolveReceiptStockItem(db, identity)).toEqual({ id: 22 });
  const [sql, args] = db.query.mock.calls[0];
  expect(args).toEqual([4, 9, 2, 7]);
  expect(sql).toContain("si.inventory_uom_id=$3");
  expect(sql).toContain("'mapped_generic','mapped_product'");
  expect(sql).toContain("levels.warehouse_id=w.id");
  expect(sql).not.toMatch(/LIMIT\s+1|supplier_catalog/i);
});
test.each([
  [[], "STOCK_IDENTITY_NOT_FOUND"],
  [[{ id: 1 }, { id: 2 }], "STOCK_IDENTITY_AMBIGUOUS"],
])("rejects missing or ambiguous inventory mappings", async (rows, code) => {
  await expect(
    resolveReceiptStockItem(
      { query: jest.fn().mockResolvedValue({ rows }) },
      identity,
    ),
  ).rejects.toMatchObject({ code });
});
test.each(["generic_item_id", "base_uom_id", "warehouse_id"])(
  "rejects unresolved %s",
  async (field) => {
    const query = jest.fn();
    await expect(
      resolveReceiptStockItem({ query }, { ...identity, [field]: null }),
    ).rejects.toMatchObject({ code: "STOCK_IDENTITY_UNRESOLVED" });
    expect(query).not.toHaveBeenCalled();
  },
);
