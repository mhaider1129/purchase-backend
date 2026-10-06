-- MANUAL DATABASE MIGRATION REQUIRED for existing evaluation results missing timestamps.
-- Run this file before retrying the original SQL 035, or use the corrected SQL 035.
-- Historical timestamps remain unknown (NULL). No result, score or amount is updated.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.procurement_evaluation_results IN ACCESS EXCLUSIVE MODE;

DO $result_metadata$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY ARRAY['created_at','updated_at'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid='public.procurement_evaluation_results'::regclass
         AND a.attname=column_name AND NOT a.attisdropped
    ) THEN
      -- Adding a DEFAULT here would stamp existing results with the repair time.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_results ADD COLUMN %I timestamptz',column_name);
      -- Set the insert default separately; it does not backfill existing rows.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_results ALTER COLUMN %I SET DEFAULT CURRENT_TIMESTAMP',column_name);
    END IF;
  END LOOP;
END $result_metadata$;

COMMIT;
