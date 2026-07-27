const fs=require('fs');const path=require('path');
const migration=fs.readFileSync(path.join(__dirname,'../sql/migrations/20260727_item_master_foundation.sql'),'utf8');
const schema=fs.readFileSync(path.join(__dirname,'../sql/View_Supabase_SQL.sql'),'utf8');

test('migration dependencies exist in repository schema snapshot',()=>{
  for(const table of ['users','requests','requested_items','stock_items','suppliers','contracts','inventory_transactions','purchase_order_items','goods_receipt_items','warehouse_stock_levels','item_categories','item_uom','item_manufacturers'])expect(schema).toContain(`CREATE TABLE public.${table}`);
});

test('migration is transaction wrapped and never activates legacy rows',()=>{
  expect(migration.trim().startsWith('BEGIN;')).toBe(true);expect(migration.trim().endsWith('COMMIT;')).toBe(true);
  expect(migration).not.toMatch(/INSERT INTO generic_items\s+SELECT/i);
  expect(migration).toContain('legacy_item_active_mapping_idx');
});

test('request and downstream traceability columns are additive',()=>{
  for(const column of ['generic_item_id','preferred_product_id','mandatory_product_id','supplier_catalog_item_id'])expect(migration).toContain(column);
  expect(migration).toContain('ADD COLUMN IF NOT EXISTS');
});