-- DEVELOPMENT ONLY. Owner executes manually in the confirmed Development SQL
-- Editor. This is not a Production synchronization migration. No data backfill.
-- Apply before deploying the identity hardening application release.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE missing_columns text;
BEGIN
  IF to_regclass('public.requested_items') IS NULL THEN
    RAISE EXCEPTION 'DEV_IDENTITY_PREREQUISITE_MISSING: requested_items';
  END IF;
  SELECT string_agg(required.name,', ') INTO missing_columns FROM unnest(ARRAY[
    'id','request_id','item_name','brand','quantity','unit_cost','total_cost','available_quantity',
    'intended_use','specs','unit_of_measure','device_info','purchase_type','generic_item_id','preferred_product_id',
    'mandatory_product_id','request_mode','catalog_status','stocking_policy','preferred_product_reason',
    'restriction_justification','required_date','item_name_snapshot','canonical_description_snapshot'
  ]) required(name) WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name='requested_items' AND c.column_name=required.name);
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'DEV_IDENTITY_WRITER_COLUMNS_MISSING: %. Review/apply existing Item Master/UOM prerequisites; do not recreate requested_items',missing_columns;
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='requested_items'
      AND column_name IN ('request_mode','catalog_status') AND data_type='text' AND is_nullable='YES')<>2 THEN
    RAISE EXCEPTION 'DEV_IDENTITY_INCOMPATIBLE_COLUMNS: expected nullable text request_mode/catalog_status; review exact schema';
  END IF;
  IF EXISTS(SELECT 1 FROM public.requested_items WHERE request_mode IS NOT NULL AND request_mode NOT IN
    ('generic_item','generic_item_with_preference','specific_approved_product','free_text','pending_item_creation','approved_free_text_exception','service')) THEN
    RAISE EXCEPTION 'DEV_IDENTITY_INVALID_EXISTING_MODE: inspect records; this migration never rewrites historical data';
  END IF;
  IF EXISTS(SELECT 1 FROM public.requested_items WHERE catalog_status IS NOT NULL
      AND catalog_status NOT IN ('catalogued','pending_mapping','approved_exception')) THEN
    RAISE EXCEPTION 'DEV_IDENTITY_INVALID_EXISTING_STATUS: inspect records without bulk reclassification';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.requested_items'::regclass
      AND c.conname IN ('requested_items_request_mode_check','requested_items_catalog_status_check')
      AND (c.contype<>'c' OR cardinality(c.conkey)<>1 OR NOT EXISTS(
        SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
        AND a.attname=CASE c.conname WHEN 'requested_items_request_mode_check' THEN 'request_mode' ELSE 'catalog_status' END))) THEN
    RAISE EXCEPTION 'DEV_IDENTITY_UNEXPECTED_CONSTRAINT: review before replacing a known enum check';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
      WHERE c.conrelid='public.requested_items'::regclass AND c.contype='c'
      AND a.attname IN ('request_mode','catalog_status')
      AND c.conname NOT IN ('requested_items_request_mode_check','requested_items_catalog_status_check')) THEN
    RAISE EXCEPTION 'DEV_IDENTITY_OTHER_CHECK_DEPENDENCY: review custom identity checks; no automatic removal';
  END IF;
END $preflight$;

-- Capture these before/after counts with the owner's change record.
SELECT count(*) total_rows,count(*) FILTER(WHERE request_mode IS NULL) legacy_null_modes,
  count(*) FILTER(WHERE catalog_status IS NULL) legacy_null_statuses FROM public.requested_items;

ALTER TABLE public.requested_items ALTER COLUMN request_mode DROP DEFAULT,
  ALTER COLUMN catalog_status DROP DEFAULT;
-- Replace only the known enum constraints. IDs, rows, nullability and FKs stay intact.
ALTER TABLE public.requested_items DROP CONSTRAINT IF EXISTS requested_items_request_mode_check;
ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_request_mode_check CHECK
  (request_mode IN ('generic_item','generic_item_with_preference','specific_approved_product','free_text','pending_item_creation','approved_free_text_exception','service'));
ALTER TABLE public.requested_items DROP CONSTRAINT IF EXISTS requested_items_catalog_status_check;
ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_catalog_status_check CHECK
  (catalog_status IN ('catalogued','pending_mapping','approved_exception'));
COMMIT;

-- Expected: two nullable text columns, NULL defaults; two validated CHECKs with
-- seven modes / three statuses. Legacy NULL counts must match the preflight capture.
SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='requested_items' AND column_name IN ('request_mode','catalog_status');
SELECT conname,convalidated,pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.requested_items'::regclass AND conname IN ('requested_items_request_mode_check','requested_items_catalog_status_check');
SELECT count(*) total_rows,count(*) FILTER(WHERE request_mode IS NULL) legacy_null_modes,
  count(*) FILTER(WHERE catalog_status IS NULL) legacy_null_statuses FROM public.requested_items;
