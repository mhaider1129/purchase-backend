-- READ ONLY and compatible with the Supabase SQL editor.
-- Replace only the NULL values below with values from the signed pre-migration
-- report. Leaving a value NULL returns NOT_RUN rather than a misleading PASS.
BEGIN TRANSACTION READ ONLY;

WITH verification_inputs AS (
  SELECT
    NULL::BIGINT AS baseline_stock_item_count,
    NULL::NUMERIC AS baseline_total_quantity,
    NULL::BIGINT AS baseline_transaction_count,
    NULL::TIMESTAMPTZ AS migration_started_at
), observations AS (
  SELECT
    COUNT(*)::BIGINT AS stock_item_count,
    COALESCE(SUM(available_quantity), 0)::NUMERIC AS total_quantity,
    (SELECT COUNT(*)::BIGINT FROM inventory_transactions) AS transaction_count
  FROM stock_items
), reconciliation AS (
  SELECT 'stock_item_count_reconciled' AS check_name,
         CASE WHEN i.baseline_stock_item_count IS NULL THEN 'NOT_RUN'
              WHEN o.stock_item_count = i.baseline_stock_item_count THEN 'PASS' ELSE 'FAIL' END AS result,
         format('observed=%s baseline=%s', o.stock_item_count, COALESCE(i.baseline_stock_item_count::TEXT, 'not supplied')) AS detail
  FROM verification_inputs i CROSS JOIN observations o
  UNION ALL
  SELECT 'total_inventory_quantity_reconciled',
         CASE WHEN i.baseline_total_quantity IS NULL THEN 'NOT_RUN'
              WHEN o.total_quantity = i.baseline_total_quantity THEN 'PASS' ELSE 'FAIL' END,
         format('observed=%s baseline=%s', o.total_quantity, COALESCE(i.baseline_total_quantity::TEXT, 'not supplied'))
  FROM verification_inputs i CROSS JOIN observations o
  UNION ALL
  SELECT 'transaction_count_reconciled',
         CASE WHEN i.baseline_transaction_count IS NULL THEN 'NOT_RUN'
              WHEN o.transaction_count = i.baseline_transaction_count THEN 'PASS' ELSE 'FAIL' END,
         format('observed=%s baseline=%s', o.transaction_count, COALESCE(i.baseline_transaction_count::TEXT, 'not supplied'))
  FROM verification_inputs i CROSS JOIN observations o
  UNION ALL
  SELECT 'no_auto_active_generic_items',
         CASE WHEN i.migration_started_at IS NULL THEN 'NOT_RUN'
              WHEN COUNT(g.id) = 0 THEN 'PASS' ELSE 'FAIL' END,
         format('active generic items created since migration start=%s; migration_started_at=%s', COUNT(g.id), COALESCE(i.migration_started_at::TEXT, 'not supplied'))
  FROM verification_inputs i
  LEFT JOIN generic_items g
    ON i.migration_started_at IS NOT NULL
   AND g.created_at >= i.migration_started_at
   AND g.lifecycle_status = 'active'
  GROUP BY i.migration_started_at
)
SELECT check_name, result, detail FROM reconciliation ORDER BY check_name;

SELECT 'mapping_stock_fk_valid' AS check_name, CASE WHEN COUNT(*)=0 THEN 'PASS' ELSE 'FAIL' END AS result, COUNT(*)::TEXT AS detail
FROM stock_item_master_mappings m LEFT JOIN stock_items s ON s.id=m.stock_item_id WHERE s.id IS NULL
UNION ALL SELECT 'generic_mapping_valid',CASE WHEN COUNT(*)=0 THEN 'PASS' ELSE 'FAIL' END,COUNT(*)::TEXT
FROM stock_items s LEFT JOIN generic_items g ON g.id=s.generic_item_id WHERE s.generic_item_id IS NOT NULL AND g.id IS NULL
UNION ALL SELECT 'product_ownership_valid',CASE WHEN COUNT(*)=0 THEN 'PASS' ELSE 'FAIL' END,COUNT(*)::TEXT
FROM stock_items s JOIN approved_products p ON p.id=s.approved_product_id WHERE p.generic_item_id<>s.generic_item_id
UNION ALL SELECT 'unmapped_operational',CASE WHEN COUNT(*)>0 THEN 'PASS' ELSE 'FAIL' END,COUNT(*)::TEXT
FROM stock_items WHERE mapping_status='unmapped' AND identity_source='legacy_stock_item';

SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('stock_item_master_mappings','stock_item_migration_staging','item_attribute_templates','stock_item_attribute_suggestions');

SELECT indexname
FROM pg_indexes
WHERE indexname IN ('stock_items_generic_identity_idx','stock_items_product_identity_idx','stock_item_one_active_final_mapping_idx');

ROLLBACK;