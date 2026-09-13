
-- 023: Connect technical Spare Part approval to warehouse Stock Item identity.
-- FORWARD-ONLY. Run manually after Item Master and migration 013.
BEGIN;

DO $migration$
BEGIN
  IF to_regclass('public.approved_spare_parts') IS NULL OR to_regclass('public.stock_items') IS NULL THEN
    RAISE EXCEPTION 'SQL_023_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='approved_spare_parts' AND column_name='stock_item_id') THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_spare_parts'::regclass AND conname='approved_spare_parts_stock_item_fk') THEN
      RAISE NOTICE 'SQL_023_ALREADY_APPLIED_COMPATIBLE'; RETURN;
    END IF;
    RAISE EXCEPTION 'SQL_023_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;
  ALTER TABLE public.approved_spare_parts ADD COLUMN stock_item_id integer;
  ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_stock_item_fk
    FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE RESTRICT;
  CREATE INDEX approved_spare_parts_stock_item_idx ON public.approved_spare_parts(institute_id,stock_item_id) WHERE stock_item_id IS NOT NULL;
END $migration$;

COMMIT;