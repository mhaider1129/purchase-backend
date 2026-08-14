-- Phase 5A diagnostics: MANUAL, READ-ONLY, never invoked by application code.
DO $diagnostics$
DECLARE table_name text; row_count bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['generic_items','approved_products','supplier_catalog_items','item_master','item_master_items','warehouse_supply_items','legacy_item_mappings','item_master_aliases','stock_items','pending_item_requests'] LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE NOTICE 'table=%, table_present=false, count=null, diagnostic_status=ABSENT_OPTIONAL',table_name;
    ELSE
      EXECUTE format('SELECT count(*) FROM %I',table_name) INTO row_count;
      RAISE NOTICE 'table=%, table_present=true, count=%, diagnostic_status=OK',table_name,row_count;
    END IF;
  END LOOP;
END
$diagnostics$ LANGUAGE plpgsql;

SELECT COUNT(*) FILTER (WHERE g.id IS NULL) AS products_missing_generic_parent FROM approved_products p LEFT JOIN generic_items g ON g.id=p.generic_item_id;
SELECT COUNT(*) FILTER (WHERE p.id IS NULL) AS catalog_rows_missing_product_parent FROM supplier_catalog_items c LEFT JOIN approved_products p ON p.id=c.approved_product_id;

DO $receipts$
DECLARE findings record;
BEGIN
 IF to_regclass('public.goods_receipt_items') IS NULL THEN RAISE NOTICE 'table=goods_receipt_items, table_present=false, diagnostic_status=ABSENT_OPTIONAL';
 ELSE
  EXECUTE 'SELECT count(*) AS total_receipt_lines, count(*) FILTER (WHERE generic_item_id IS NULL) AS missing_generic_item_id, count(*) FILTER (WHERE approved_product_id IS NULL) AS missing_approved_product_id, count(*) FILTER (WHERE supplier_catalog_item_id IS NULL) AS missing_supplier_catalog_item_id, count(*) FILTER (WHERE stock_item_id IS NULL) AS missing_stock_item_id FROM goods_receipt_items' INTO findings;
  RAISE NOTICE 'table=goods_receipt_items, table_present=true, total_receipt_lines=%, missing_generic_item_id=%, missing_approved_product_id=%, missing_supplier_catalog_item_id=%, missing_stock_item_id=%, diagnostic_status=OK',findings.total_receipt_lines,findings.missing_generic_item_id,findings.missing_approved_product_id,findings.missing_supplier_catalog_item_id,findings.missing_stock_item_id;
 END IF;
END
$receipts$ LANGUAGE plpgsql;