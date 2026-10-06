-- DEVELOPMENT ONLY, READ ONLY. Owner runs manually; no cleanup/drop is authorized
-- by this file. Retain outputs and review external consumers before any removal.
BEGIN TRANSACTION READ ONLY;
SELECT a.attname,format_type(a.atttypid,a.atttypmod) type_name,a.attnotnull
FROM pg_attribute a WHERE a.attrelid=to_regclass('public.stock_items')
  AND a.attname='supplier_catalog_item_id' AND NOT a.attisdropped;
DO $data$
DECLARE populated bigint; distinct_offers bigint;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.stock_items')
      AND attname='supplier_catalog_item_id' AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FILTER(WHERE supplier_catalog_item_id IS NOT NULL),count(DISTINCT supplier_catalog_item_id) FROM public.stock_items'
      INTO populated,distinct_offers;
    RAISE NOTICE 'STOCK_CATALOG_PROVENANCE: populated_rows=%, distinct_offers=%. Nonzero provenance must be reconciled/retained before any drop',populated,distinct_offers;
  ELSE RAISE NOTICE 'STOCK_CATALOG_COLUMN_ABSENT: no cleanup required'; END IF;
END $data$;
SELECT c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) definition
FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
WHERE c.conrelid=to_regclass('public.stock_items') AND a.attname='supplier_catalog_item_id';
SELECT idx.relname index_name,pg_get_indexdef(i.indexrelid) definition
FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
WHERE i.indrelid=to_regclass('public.stock_items')
  AND pg_get_indexdef(i.indexrelid) ILIKE '%supplier_catalog_item_id%';
SELECT pg_describe_object(d.classid,d.objid,d.objsubid) dependent_object,d.deptype
FROM pg_depend d JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
WHERE d.refclassid='pg_class'::regclass AND d.refobjid=to_regclass('public.stock_items')
  AND a.attname='supplier_catalog_item_id';
SELECT schemaname,viewname,definition FROM pg_views
WHERE definition ILIKE '%stock_items%' AND definition ILIKE '%supplier_catalog_item_id%';
SELECT schemaname,matviewname,definition FROM pg_matviews
WHERE definition ILIKE '%stock_items%' AND definition ILIKE '%supplier_catalog_item_id%';
SELECT n.nspname,p.proname,pg_get_functiondef(p.oid) definition FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')
  AND p.prosrc ILIKE '%stock_items%' AND p.prosrc ILIKE '%supplier_catalog_item_id%';
SELECT t.tgname,pg_get_triggerdef(t.oid) definition FROM pg_trigger t
WHERE t.tgrelid=to_regclass('public.stock_items') AND NOT t.tgisinternal;
ROLLBACK;
-- Catalog and text scans cannot prove absence of dynamic SQL or external reports.
-- There is deliberately no removal migration until actual outputs are reviewed.
