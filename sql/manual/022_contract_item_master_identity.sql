-- 022: Connect Contract lines to canonical Item Master identity.
-- FORWARD-ONLY. Existing free-text lines remain readable; all new lines are governed in service code.
BEGIN;

DO $migration$
BEGIN
  IF to_regclass('public.contract_items') IS NULL OR to_regclass('public.generic_items') IS NULL
     OR to_regclass('public.approved_products') IS NULL OR to_regclass('public.supplier_catalog_items') IS NULL THEN
    RAISE EXCEPTION 'SQL_022_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contract_items' AND column_name='generic_item_id') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contract_items' AND column_name='approved_product_id')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contract_items' AND column_name='supplier_catalog_item_id') THEN
      RAISE NOTICE 'SQL_022_ALREADY_APPLIED_COMPATIBLE'; RETURN;
    END IF;
    RAISE EXCEPTION 'SQL_022_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  ALTER TABLE public.contract_items
    ADD COLUMN generic_item_id bigint REFERENCES public.generic_items(id) ON DELETE RESTRICT,
    ADD COLUMN approved_product_id bigint REFERENCES public.approved_products(id) ON DELETE RESTRICT,
    ADD COLUMN supplier_catalog_item_id bigint REFERENCES public.supplier_catalog_items(id) ON DELETE RESTRICT;
  CREATE INDEX contract_items_generic_idx ON public.contract_items(generic_item_id) WHERE generic_item_id IS NOT NULL;
  CREATE INDEX contract_items_product_idx ON public.contract_items(approved_product_id) WHERE approved_product_id IS NOT NULL;
  CREATE INDEX contract_items_catalog_idx ON public.contract_items(supplier_catalog_item_id) WHERE supplier_catalog_item_id IS NOT NULL;
END $migration$;

COMMIT;