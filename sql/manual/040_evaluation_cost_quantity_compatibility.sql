-- MANUAL DATABASE MIGRATION REQUIRED.
-- Run this complete file before retrying SQL 035.
-- Missing quantities are unknown, not zero or one. No costs are recalculated.
-- Existing columns, values, constraints and defaults are left untouched.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.procurement_evaluation_offer_test_costs IN ACCESS EXCLUSIVE MODE;

DO $cost_quantities$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY ARRAY['quantity','annual_quantity'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid='public.procurement_evaluation_offer_test_costs'::regclass
        AND a.attname=column_name AND NOT a.attisdropped
    ) THEN
      -- Add without a default so historical quantities remain NULL.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN %I numeric(20,6)',column_name);
      -- Match SQL 035 for subsequent inserts only; do not backfill old rows.
      EXECUTE format('ALTER TABLE public.procurement_evaluation_offer_test_costs ALTER COLUMN %I SET DEFAULT 0',column_name);
    END IF;
  END LOOP;
END $cost_quantities$;

COMMIT;
