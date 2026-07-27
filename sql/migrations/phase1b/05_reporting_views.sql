BEGIN;
CREATE OR REPLACE VIEW stock_item_identity_read_model AS SELECT si.id,si.name AS legacy_name,si.description AS legacy_description,si.mapping_status,si.identity_source,si.generic_item_id,si.approved_product_id,
 COALESCE(g.generic_name,si.name) AS display_name, g.canonical_description,ap.manufacturer,ap.manufacturer_part_number,si.legacy_identity_snapshot
 FROM stock_items si LEFT JOIN generic_items g ON g.id=si.generic_item_id LEFT JOIN approved_products ap ON ap.id=si.approved_product_id;
CREATE OR REPLACE VIEW stock_item_mapping_coverage AS SELECT mapping_status,category,sub_category,unit,COUNT(*) AS item_count,ROUND(100.0*COUNT(*)/NULLIF(SUM(COUNT(*)) OVER(),0),2) AS coverage_percent FROM stock_items GROUP BY mapping_status,category,sub_category,unit;
REVOKE ALL ON stock_item_identity_read_model,stock_item_mapping_coverage FROM anon;
GRANT SELECT ON stock_item_identity_read_model,stock_item_mapping_coverage TO authenticated;
COMMIT;