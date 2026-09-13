-- 020: Permit canonical Asset fields to be absent without inventing Equipment identity.
-- FORWARD-ONLY. Run manually after 019; never from application startup.
BEGIN;

DO $migration$
BEGIN
  IF to_regclass('public.assets') IS NULL OR to_regclass('public.maintainable_equipment') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='maintainable_equipment' AND column_name='asset_id'
     ) THEN
    RAISE EXCEPTION 'SQL_020_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;

  -- Manufacturer and model are canonical Asset/Product facts. They may legitimately
  -- be unknown on an Asset and must not force users to invent Equipment values.
  ALTER TABLE public.maintainable_equipment ALTER COLUMN manufacturer DROP NOT NULL;
  ALTER TABLE public.maintainable_equipment ALTER COLUMN model DROP NOT NULL;
  RAISE NOTICE 'SQL_020_APPLIED_COMPATIBLE';
END $migration$;

COMMIT;