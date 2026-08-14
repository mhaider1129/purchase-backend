-- Phase 5A Batch 1 diagnostics. MANUAL, READ-ONLY, and intentionally not executed.
-- Run only after reviewing against the deployed Phase 1B and item-foundation schema.

SELECT 'generic_items.total' AS diagnostic, COUNT(*)::bigint AS count FROM generic_items
UNION ALL SELECT 'generic_items.active', COUNT(*) FROM generic_items WHERE lifecycle_status = 'active' AND is_active
UNION ALL SELECT 'item_master.total', COUNT(*) FROM item_master
UNION ALL SELECT 'item_master_items.total', COUNT(*) FROM item_master_items
UNION ALL SELECT 'legacy_mappings.active', COUNT(*) FROM legacy_item_mappings WHERE mapping_status = 'active'
UNION ALL SELECT 'aliases.total', COUNT(*) FROM item_master_aliases
UNION ALL SELECT 'stock_items.unmapped_generic', COUNT(*) FROM stock_items WHERE generic_item_id IS NULL
UNION ALL SELECT 'pending_items.total', COUNT(*) FROM pending_item_requests
UNION ALL SELECT 'duplicate_reviews.unresolved', COUNT(*) FROM item_duplicate_reviews WHERE decision = 'pending';

SELECT source_table, COUNT(*) AS unmapped
FROM (
  SELECT 'item_master'::text source_table, i.id FROM item_master i
  LEFT JOIN legacy_item_mappings m ON m.source_table='item_master' AND m.legacy_item_id=i.id AND m.mapping_status='active'
  WHERE m.id IS NULL
  UNION ALL
  SELECT 'item_master_items', i.id FROM item_master_items i
  LEFT JOIN legacy_item_mappings m ON m.source_table='item_master_items' AND m.legacy_item_id=i.id AND m.mapping_status='active'
  WHERE m.id IS NULL
) unmapped GROUP BY source_table ORDER BY source_table;

SELECT structured_fingerprint, COUNT(*) AS duplicate_count, ARRAY_AGG(id ORDER BY id) AS generic_item_ids
FROM generic_items GROUP BY structured_fingerprint HAVING COUNT(*) > 1 ORDER BY duplicate_count DESC;

SELECT COALESCE(manufacturer_id::text, LOWER(TRIM(manufacturer))) AS manufacturer_key,
       normalized_manufacturer_part_number, COUNT(*) AS duplicate_count, ARRAY_AGG(id ORDER BY id) AS product_ids
FROM approved_products
GROUP BY COALESCE(manufacturer_id::text, LOWER(TRIM(manufacturer))), normalized_manufacturer_part_number
HAVING COUNT(*) > 1 ORDER BY duplicate_count DESC;

SELECT
  COUNT(*) FILTER (WHERE category_id IS NULL) AS missing_category_id,
  COUNT(*) FILTER (WHERE base_uom_id IS NULL) AS missing_base_uom_id,
  COUNT(*) FILTER (WHERE inventory_uom_id IS NULL) AS missing_inventory_uom_id,
  COUNT(*) FILTER (WHERE purchasing_uom IS NOT NULL AND purchasing_uom_id IS NULL) AS missing_purchasing_uom_id
FROM generic_items;

SELECT COALESCE(request_mode, '<null>') AS request_mode,
       COALESCE(catalog_status, '<null>') AS catalog_status,
       COUNT(*) AS lines_missing_generic
FROM requested_items WHERE generic_item_id IS NULL
GROUP BY request_mode, catalog_status ORDER BY request_mode, catalog_status;

SELECT
  COUNT(*) AS po_lines,
  COUNT(*) FILTER (WHERE generic_item_id IS NULL) AS missing_generic,
  COUNT(*) FILTER (WHERE approved_product_id IS NULL) AS missing_product,
  COUNT(*) FILTER (WHERE supplier_catalog_item_id IS NULL) AS missing_catalog
FROM purchase_order_items;

SELECT
  COUNT(*) AS inventory_movements,
  COUNT(*) FILTER (WHERE generic_item_id IS NULL) AS missing_generic,
  COUNT(*) FILTER (WHERE approved_product_id IS NULL) AS missing_product,
  COUNT(*) FILTER (WHERE supplier_catalog_item_id IS NULL) AS missing_catalog
FROM inventory_transactions;

SELECT
  COUNT(*) FILTER (WHERE p.id IS NULL) AS missing_product_link,
  COUNT(*) FILTER (WHERE p.id IS NOT NULL AND (p.approval_status <> 'approved' OR NOT p.is_active)) AS linked_to_unapproved_product
FROM supplier_catalog_items c LEFT JOIN approved_products p ON p.id=c.approved_product_id;

SELECT COUNT(*) AS products_not_linked_to_active_generic
FROM approved_products p LEFT JOIN generic_items g ON g.id=p.generic_item_id
WHERE g.id IS NULL OR g.lifecycle_status <> 'active' OR NOT g.is_active;

SELECT 'warehouse_supply_name_keys' AS source, COUNT(*) AS records_requiring_mapping
FROM warehouse_supply_items WHERE stock_item_id IS NULL
UNION ALL
SELECT 'contract_items_without_canonical_item', COUNT(*) FROM contract_items WHERE item_id IS NULL
UNION ALL
SELECT 'requested_free_text_or_unclassified', COUNT(*) FROM requested_items
WHERE generic_item_id IS NULL AND COALESCE(request_mode, 'approved_free_text_exception') NOT IN ('service','pending_item_creation');

SELECT status, resolution_type, COUNT(*) AS request_count
FROM pending_item_requests GROUP BY status, resolution_type ORDER BY status, resolution_type;

SELECT entity_type, decision, COUNT(*) AS review_count
FROM item_duplicate_reviews GROUP BY entity_type, decision ORDER BY entity_type, decision;

SELECT
  COUNT(*) FILTER (WHERE lifecycle_status='active' AND NOT is_active) AS active_status_but_flag_false,
  COUNT(*) FILTER (WHERE lifecycle_status<>'active' AND is_active) AS nonactive_status_but_flag_true,
  COUNT(*) FILTER (WHERE lifecycle_status='retired' AND retired_at IS NULL) AS retired_without_timestamp
FROM generic_items;

SELECT
  COUNT(*) FILTER (WHERE approval_status='retired' AND is_active) AS retired_products_still_active,
  COUNT(*) FILTER (WHERE approval_status='approved' AND approved_at IS NULL) AS approved_without_timestamp
FROM approved_products;

SELECT source_table, mapping_status, COUNT(*) AS mapping_count
FROM legacy_item_mappings GROUP BY source_table, mapping_status ORDER BY source_table, mapping_status;

SELECT alias_type, COUNT(*) AS alias_count, COUNT(DISTINCT generic_item_id) AS generic_items_covered
FROM item_master_aliases GROUP BY alias_type ORDER BY alias_type;