-- Run before migration. Each query must return one row with the expected key type.
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN
 ('users','requests','requested_items','stock_items','suppliers','contracts','inventory_transactions',
  'purchase_order_items','goods_receipt_items','warehouse_stock_levels','item_categories','item_uom','item_manufacturers');
SELECT table_name,column_name,data_type FROM information_schema.columns
 WHERE table_schema='public' AND column_name='id' AND table_name IN
 ('users','requests','requested_items','stock_items','suppliers','contracts','inventory_transactions',
  'purchase_order_items','goods_receipt_items','warehouse_stock_levels','item_categories','item_uom','item_manufacturers')
 ORDER BY table_name;

-- Post-migration verification and steward backfill report. No automatic mappings are made.
SELECT (SELECT COUNT(*) FROM generic_items) generic_items,
       (SELECT COUNT(*) FROM approved_products) approved_products,
       (SELECT COUNT(*) FROM supplier_catalog_items) supplier_catalog_items,
       (SELECT COUNT(*) FROM pending_item_requests WHERE status NOT IN ('resolved','rejected','approved_exception')) pending_items;
SELECT 'item_master_items' source_table, COUNT(*) unmapped
 FROM item_master_items l LEFT JOIN legacy_item_mappings m
   ON m.source_table='item_master_items' AND m.legacy_item_id=l.id AND m.mapping_status='active'
 WHERE m.id IS NULL
UNION ALL
SELECT 'item_master', COUNT(*) FROM item_master l LEFT JOIN legacy_item_mappings m
  ON m.source_table='item_master' AND m.legacy_item_id=l.id AND m.mapping_status='active'
 WHERE m.id IS NULL;

-- Rollback guidance: first stop normalized writes, export audit/mapping tables, remove only the
-- additive foreign-key columns, then drop normalized tables in reverse dependency order.
-- Do not roll back after operational IDs have been propagated without a reviewed data recovery plan.