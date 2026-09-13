const fs = require('fs');
const path = require('path');
const SparePartsRepository = require('../repositories/sparePartsRepository');

test('023 adds the governed Spare Part to Stock Item bridge', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/023_spare_part_stock_item_integration.sql'), 'utf8');
  expect(sql).toContain('approved_spare_parts_stock_item_fk');
  expect(sql).toContain('REFERENCES public.stock_items(id) ON DELETE RESTRICT');
  expect(sql).toContain('SQL_023_ALREADY_APPLIED_COMPATIBLE');
  expect(sql).toContain('SQL_023_PARTIAL_OR_DRIFTED_SCHEMA');
});

test('Stock Item options and quantities are scoped through institute warehouses', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await new SparePartsRepository(db).availableStockItems(7, { generic_item_id: 2, approved_product_id: 3 });
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain('JOIN warehouses w ON w.id=wsl.warehouse_id');
  expect(sql).toContain('w.institute_id=$1');
  expect(sql).toContain('COALESCE(wsl.quantity,0)-COALESCE(wsl.reserved_quantity,0)');
  expect(params).toEqual([7, 2, 3]);
});