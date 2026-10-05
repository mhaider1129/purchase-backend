-- MANUAL DATABASE MIGRATION REQUIRED for populated offers missing optional model JSON.
-- Run before retrying the original SQL 035, or use the corrected SQL 035.
-- Existing offer fields and model data are preserved; unknown historical models stay NULL.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.procurement_evaluation_offers IN ACCESS EXCLUSIVE MODE;

DO $offer_models$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY ARRAY[
    'technical_model','contract_model','package_model',
    'service_model','risk_model','scenario_metadata'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid='public.procurement_evaluation_offers'::regclass
         AND a.attname=column_name AND NOT a.attisdropped
    ) THEN
      -- No initial default: do not infer model contents for historical offers.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_offers ADD COLUMN %I jsonb',column_name);
      -- Only subsequent inserts receive an empty-model default.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_offers ALTER COLUMN %I SET DEFAULT ''{}''::jsonb',column_name);
    END IF;
  END LOOP;
END $offer_models$;

COMMIT;
