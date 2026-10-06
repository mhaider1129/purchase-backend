-- MANUAL DATABASE MIGRATION REQUIRED.
-- Run this complete file before retrying SQL 035.
-- Unknown historical timestamps remain NULL. No weights, thresholds or scores change.
-- Existing columns, timestamps, constraints and defaults are preserved.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.procurement_evaluation_criteria IN ACCESS EXCLUSIVE MODE;

DO $criteria_metadata$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY ARRAY['created_at','updated_at'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid='public.procurement_evaluation_criteria'::regclass
        AND a.attname=column_name AND NOT a.attisdropped
    ) THEN
      -- Do not stamp old criteria with the migration time.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN %I timestamptz',column_name);
      -- This separate default affects future inserts only.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_criteria ALTER COLUMN %I SET DEFAULT CURRENT_TIMESTAMP',column_name);
    END IF;
  END LOOP;
END $criteria_metadata$;

COMMIT;
