-- Phase 5A diagnostics: MANUAL, READ-ONLY, never invoked by application code.
-- Required foundation tables deliberately fail with a clear prerequisite error.
DO $required$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['generic_items','approved_products','supplier_catalog_items'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'REQUIRED_CANONICAL_TABLE_MISSING: public.%',t; END IF;
 END LOOP;
END $required$ LANGUAGE plpgsql;

SELECT 'generic_items.total' diagnostic,COUNT(*) count FROM generic_items
UNION ALL SELECT 'generic_items.active',COUNT(*) FROM generic_items WHERE lifecycle_status='active' AND is_active;
SELECT structured_fingerprint,COUNT(*) duplicate_count,ARRAY_AGG(id ORDER BY id) generic_item_ids FROM generic_items GROUP BY structured_fingerprint HAVING COUNT(*)>1;
SELECT COALESCE(manufacturer_id::text,LOWER(TRIM(manufacturer))) manufacturer_key,normalized_manufacturer_part_number,COUNT(*) duplicate_count,ARRAY_AGG(id ORDER BY id) product_ids FROM approved_products GROUP BY 1,2 HAVING COUNT(*)>1;
SELECT COUNT(*) FILTER(WHERE category_id IS NULL) missing_category_id,COUNT(*) FILTER(WHERE base_uom_id IS NULL) missing_base_uom_id,COUNT(*) FILTER(WHERE inventory_uom_id IS NULL) missing_inventory_uom_id,COUNT(*) FILTER(WHERE purchasing_uom IS NOT NULL AND purchasing_uom_id IS NULL) missing_purchasing_uom_id FROM generic_items;
SELECT COUNT(*) FILTER(WHERE p.id IS NULL) missing_product_link,COUNT(*) FILTER(WHERE p.id IS NOT NULL AND(p.approval_status<>'approved' OR NOT p.is_active)) linked_to_unapproved_product FROM supplier_catalog_items c LEFT JOIN approved_products p ON p.id=c.approved_product_id;
SELECT COUNT(*) products_not_linked_to_active_generic FROM approved_products p LEFT JOIN generic_items g ON g.id=p.generic_item_id WHERE g.id IS NULL OR g.lifecycle_status<>'active' OR NOT g.is_active;
SELECT COUNT(*) FILTER(WHERE lifecycle_status='active' AND NOT is_active) active_status_but_flag_false,COUNT(*) FILTER(WHERE lifecycle_status<>'active' AND is_active) nonactive_status_but_flag_true,COUNT(*) FILTER(WHERE lifecycle_status='retired' AND retired_at IS NULL) retired_without_timestamp FROM generic_items;
SELECT COUNT(*) FILTER(WHERE approval_status='retired' AND is_active) retired_products_still_active,COUNT(*) FILTER(WHERE approval_status='approved' AND approved_at IS NULL) approved_without_timestamp FROM approved_products;

-- Optional/compatibility diagnostics are table- and column-catalog guarded.
DO $optional$
DECLARE t text; q text; r record; required_columns text[]; missing_columns integer;
BEGIN
 FOREACH t IN ARRAY ARRAY['item_master','item_master_items','legacy_item_mappings','item_master_aliases','requested_items','purchase_order_items','goods_receipt_items','inventory_transactions','contract_items','pending_item_requests','item_duplicate_reviews','stock_items','warehouse_supply_items'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE NOTICE 'table=%, diagnostic_status=ABSENT_OPTIONAL_LEGACY_TABLE',t; CONTINUE; END IF;
  EXECUTE format('SELECT COUNT(*) count FROM %I',t) INTO r;
  RAISE NOTICE 'table=%, total=%, diagnostic_status=OK',t,r.count;
 END LOOP;

 -- Legacy unmapped rows by source and mapping coverage.
 IF to_regclass('public.legacy_item_mappings') IS NOT NULL THEN
  FOR t IN SELECT unnest(ARRAY['item_master','item_master_items']) LOOP
   IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('SELECT COUNT(*) count FROM %I i LEFT JOIN legacy_item_mappings m ON m.source_table=%L AND m.legacy_item_id=i.id AND m.mapping_status=''active'' WHERE m.id IS NULL',t,t) INTO r; RAISE NOTICE 'source=%, unmapped=%, diagnostic=legacy_mapping_coverage',t,r.count; END IF;
  END LOOP;
  FOR r IN EXECUTE 'SELECT source_table,mapping_status,COUNT(*) count FROM legacy_item_mappings GROUP BY source_table,mapping_status' LOOP RAISE NOTICE 'source=%, status=%, mappings=%',r.source_table,r.mapping_status,r.count; END LOOP;
 END IF;
 IF to_regclass('public.item_master_aliases') IS NOT NULL THEN FOR r IN EXECUTE 'SELECT alias_type,COUNT(*) count,COUNT(DISTINCT generic_item_id) covered FROM item_master_aliases GROUP BY alias_type' LOOP RAISE NOTICE 'alias_type=%, aliases=%, generic_covered=%',r.alias_type,r.count,r.covered; END LOOP; END IF;

 -- Canonical FK adoption by transaction/compatibility tables; absent columns are reported, never hidden.
 FOREACH t IN ARRAY ARRAY['purchase_order_items','goods_receipt_items','inventory_transactions','stock_items'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   SELECT COUNT(*) INTO missing_columns FROM unnest(CASE WHEN t='goods_receipt_items' THEN ARRAY['generic_item_id','approved_product_id','supplier_catalog_item_id','stock_item_id'] WHEN t='stock_items' THEN ARRAY['generic_item_id','approved_product_id'] ELSE ARRAY['generic_item_id','approved_product_id','supplier_catalog_item_id'] END) c
    WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name=c);
   IF missing_columns>0 THEN RAISE NOTICE 'table=%, diagnostic_status=ABSENT_OPTIONAL_LEGACY_COLUMN, missing_column_count=%',t,missing_columns;
   ELSE
    q:=CASE WHEN t='goods_receipt_items' THEN format('SELECT COUNT(*) total_receipt_lines,COUNT(*) FILTER(WHERE generic_item_id IS NULL) missing_generic_item_id,COUNT(*) FILTER(WHERE approved_product_id IS NULL) missing_approved_product_id,COUNT(*) FILTER(WHERE supplier_catalog_item_id IS NULL) missing_supplier_catalog_item_id,COUNT(*) FILTER(WHERE stock_item_id IS NULL) missing_stock_item_id FROM %I',t)
      WHEN t='stock_items' THEN format('SELECT COUNT(*) total,COUNT(*) FILTER(WHERE generic_item_id IS NULL) missing_generic_item_id,COUNT(*) FILTER(WHERE approved_product_id IS NULL) missing_approved_product_id,0::bigint missing_supplier_catalog_item_id,0::bigint missing_stock_item_id FROM %I',t)
      ELSE format('SELECT COUNT(*) total,COUNT(*) FILTER(WHERE generic_item_id IS NULL) missing_generic_item_id,COUNT(*) FILTER(WHERE approved_product_id IS NULL) missing_approved_product_id,COUNT(*) FILTER(WHERE supplier_catalog_item_id IS NULL) missing_supplier_catalog_item_id,0::bigint missing_stock_item_id FROM %I',t) END;
    EXECUTE q INTO r; RAISE NOTICE 'table=%, missing_generic_item_id=%, missing_approved_product_id=%, missing_supplier_catalog_item_id=%, missing_stock_item_id=%',t,r.missing_generic_item_id,r.missing_approved_product_id,r.missing_supplier_catalog_item_id,r.missing_stock_item_id;
   END IF;
  END IF;
 END LOOP;

 IF to_regclass('public.requested_items') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['generic_item_id','request_mode','catalog_status']) c WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='requested_items' AND column_name=c)) THEN FOR r IN EXECUTE 'SELECT COALESCE(request_mode,''<null>'') request_mode,COALESCE(catalog_status,''<null>'') catalog_status,COUNT(*) count FROM requested_items WHERE generic_item_id IS NULL GROUP BY 1,2' LOOP RAISE NOTICE 'requested missing Generic: mode=%, catalog_status=%, count=%',r.request_mode,r.catalog_status,r.count; END LOOP; END IF;
 IF to_regclass('public.pending_item_requests') IS NOT NULL THEN FOR r IN EXECUTE 'SELECT status,resolution_type,COUNT(*) count FROM pending_item_requests GROUP BY status,resolution_type' LOOP RAISE NOTICE 'pending status=%, resolution=%, count=%',r.status,r.resolution_type,r.count; END LOOP; END IF;
 IF to_regclass('public.item_duplicate_reviews') IS NOT NULL THEN FOR r IN EXECUTE 'SELECT entity_type,decision,COUNT(*) count FROM item_duplicate_reviews GROUP BY entity_type,decision' LOOP RAISE NOTICE 'duplicate entity=%, decision=%, count=%',r.entity_type,r.decision,r.count; END LOOP; END IF;
 IF to_regclass('public.contract_items') IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contract_items' AND column_name='item_id') THEN EXECUTE 'SELECT COUNT(*) count FROM contract_items WHERE item_id IS NULL' INTO r; RAISE NOTICE 'contract_items lacking canonical mapping=%',r.count; END IF;
 IF to_regclass('public.warehouse_supply_items') IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='warehouse_supply_items' AND column_name='stock_item_id') THEN EXECUTE 'SELECT COUNT(*) count FROM warehouse_supply_items WHERE stock_item_id IS NULL' INTO r; RAISE NOTICE 'name-based compatibility warehouse_supply_items=%',r.count; END IF;
END $optional$ LANGUAGE plpgsql;