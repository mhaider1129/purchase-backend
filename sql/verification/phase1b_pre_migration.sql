-- READ ONLY. Run in a read-only transaction and spool the result before migration.
BEGIN TRANSACTION READ ONLY;
SELECT 'stock_item_count' metric,COUNT(*)::text value FROM stock_items
UNION ALL SELECT 'duplicate_stock_item_ids',COUNT(*)::text FROM(SELECT id FROM stock_items GROUP BY id HAVING COUNT(*)>1)x
UNION ALL SELECT 'null_primary_keys',COUNT(*)::text FROM stock_items WHERE id IS NULL
UNION ALL SELECT 'stock_items_with_quantity',COUNT(*)::text FROM stock_items WHERE COALESCE(available_quantity,0)<>0
UNION ALL SELECT 'inventory_transaction_count',COUNT(*)::text FROM inventory_transactions
UNION ALL SELECT 'stock_items_with_transactions',COUNT(DISTINCT stock_item_id)::text FROM inventory_transactions
UNION ALL SELECT 'stock_items_with_lots_or_expiry',COUNT(DISTINCT stock_item_id)::text FROM inventory_transactions WHERE batch_number IS NOT NULL OR expiry_date IS NOT NULL OR serial_number IS NOT NULL;
SELECT tc.table_name,kcu.column_name,ccu.table_name referenced_table,ccu.column_name referenced_column,rc.delete_rule,rc.update_rule FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu USING(constraint_catalog,constraint_schema,constraint_name) JOIN information_schema.referential_constraints rc USING(constraint_catalog,constraint_schema,constraint_name) JOIN information_schema.constraint_column_usage ccu USING(constraint_catalog,constraint_schema,constraint_name) WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='stock_items' ORDER BY tc.table_name;
SELECT a.attname,format_type(a.atttypid,a.atttypmod) data_type FROM pg_attribute a WHERE a.attrelid='stock_items'::regclass AND a.attnum>0 AND NOT a.attisdropped;
SELECT * FROM pg_indexes WHERE tablename='stock_items'; SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='stock_items'::regclass;
SELECT tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='stock_items'::regclass AND NOT tgisinternal;
SELECT * FROM pg_policies WHERE tablename='stock_items'; SELECT grantee,privilege_type FROM information_schema.role_table_grants WHERE table_name='stock_items';
SELECT category,COUNT(*) FROM stock_items GROUP BY category ORDER BY COUNT(*) DESC; SELECT unit,COUNT(*) FROM stock_items GROUP BY unit ORDER BY COUNT(*) DESC; SELECT brand,COUNT(*) FROM stock_items GROUP BY brand ORDER BY COUNT(*) DESC;
SELECT 'warehouse_stock_levels_orphans',COUNT(*) FROM warehouse_stock_levels d LEFT JOIN stock_items s ON s.id=d.stock_item_id WHERE s.id IS NULL;
ROLLBACK;