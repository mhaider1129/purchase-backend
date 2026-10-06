-- MANUAL DATABASE MIGRATION REQUIRED.
-- Run this complete file before retrying SQL 035.
-- These optional fields are stored/imported but not used by current cost formulas.
-- No historical stability duration, shelf life, price or cost is inferred.
-- open_vial_stability_days affects utilization; it is deliberately NOT repaired here.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.procurement_evaluation_offer_test_costs IN ACCESS EXCLUSIVE MODE;

DO $stability_metadata$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY ARRAY['onboard_stability_days','shelf_life_months'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid='public.procurement_evaluation_offer_test_costs'::regclass
        AND a.attname=column_name AND NOT a.attisdropped
    ) THEN
      -- Unknown historical metadata must remain NULL, not a fabricated duration.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN %I numeric(20,6)',column_name);
      -- Match SQL 035 for future inserts only; existing rows are not backfilled.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_offer_test_costs ALTER COLUMN %I SET DEFAULT 0',column_name);
    END IF;
  END LOOP;
END $stability_metadata$;

COMMIT;
