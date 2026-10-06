-- MANUAL DATABASE MIGRATION REQUIRED. Run before retrying SQL 035.
-- Missing historical alternative flags remain unknown (NULL).
-- No volumes, growth assumptions, required-item decisions or saved results change.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.procurement_evaluation_tests IN ACCESS EXCLUSIVE MODE;

DO $alternative_metadata$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid='public.procurement_evaluation_tests'::regclass
      AND a.attname='is_alternative' AND NOT a.attisdropped
  ) THEN
    -- No initial default: do not classify historical tests without evidence.
    ALTER TABLE public.procurement_evaluation_tests ADD COLUMN is_alternative boolean;
    -- Only subsequent inserts receive the SQL 035 default.
    ALTER TABLE public.procurement_evaluation_tests ALTER COLUMN is_alternative SET DEFAULT false;
  END IF;
END $alternative_metadata$;

COMMIT;
