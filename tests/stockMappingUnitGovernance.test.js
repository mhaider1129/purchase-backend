const {
  StockItemMappingService,
} = require("../services/stockItemMappingService");
const service = new StockItemMappingService({});
const mapping = { generic_item_id: 4 };
const valid = {
  unit: "Piece",
  stock_uom_id: null,
  target_uom_id: 2,
  uom_code: "EA",
  uom_name: "Piece",
  is_active: true,
};
test.each([
  { ...valid },
  { ...valid, unit: "ea" },
  { ...valid, unit: "Legacy spelling", stock_uom_id: 2 },
])("mapping accepts equivalent controlled stock unit %j", async (row) => {
  await expect(
    service.validateStockUnit(
      { query: jest.fn().mockResolvedValue({ rows: [row] }) },
      7,
      mapping,
    ),
  ).resolves.toBeUndefined();
});
test.each([
  { ...valid, unit: "Box" },
  { ...valid, stock_uom_id: 3 },
  { ...valid, is_active: false },
])("mapping cannot reinterpret balances %j", async (row) => {
  await expect(
    service.validateStockUnit(
      { query: jest.fn().mockResolvedValue({ rows: [row] }) },
      7,
      mapping,
    ),
  ).rejects.toMatchObject({ code: "mapping_inventory_uom_mismatch" });
});
