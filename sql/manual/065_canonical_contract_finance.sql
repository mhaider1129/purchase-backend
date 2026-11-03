-- MANUAL DATABASE MIGRATION REQUIRED. Prerequisites: 059 and 064.
-- Add provenance only. Never infer links, replay payments, or populate old balances.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='institute_id') OR
    NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contract_obligations' AND column_name='generated_from_obligation_id') THEN
  RAISE EXCEPTION 'Complete manual SQL 064 is required before SQL 065';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_invoices' AND column_name='contract_id' AND data_type='integer') THEN
  RAISE EXCEPTION 'The canonical supplier invoice contract reference from SQL 059 is required';
 END IF;
END $$;

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS contract_id INTEGER;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchase_orders' AND column_name='contract_id' AND data_type='integer') THEN RAISE EXCEPTION 'Existing purchase_orders.contract_id is incompatible; manual review required'; END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_contract_source_fkey') THEN
  ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_contract_source_fkey FOREIGN KEY(contract_id) REFERENCES public.contracts(id) NOT VALID;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.purchase_orders'::regclass AND c.conname='purchase_orders_contract_source_fkey'
   AND c.contype='f' AND c.confrelid='public.contracts'::regclass AND c.confdeltype='a'
   AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.purchase_orders'::regclass AND attname='contract_id')]::smallint[]
   AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.contracts'::regclass AND attname='id')]::smallint[]) THEN
  RAISE EXCEPTION 'Existing canonical contract PO foreign key is incompatible; manual review required';
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS supplier_invoices_contract_projection_idx ON public.supplier_invoices(contract_id) WHERE contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_orders_contract_source_idx ON public.purchase_orders(contract_id) WHERE contract_id IS NOT NULL;
-- A source is selected on creation, never attached retroactively to old liabilities.
CREATE OR REPLACE FUNCTION public.guard_canonical_contract_po_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF (OLD.contract_id IS NOT NULL OR NEW.contract_id IS NOT NULL) AND
    (NEW.contract_id IS DISTINCT FROM OLD.contract_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
  RAISE EXCEPTION 'Canonical contract PO provenance is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS canonical_contract_po_source_immutable ON public.purchase_orders;
CREATE TRIGGER canonical_contract_po_source_immutable BEFORE UPDATE OF contract_id,request_id,supplier_id,currency ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_contract_po_source();
CREATE OR REPLACE FUNCTION public.guard_contract_canonical_commitment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE used numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM public.purchase_orders WHERE contract_id=OLD.id) THEN
  IF NEW.source_request_id IS DISTINCT FROM OLD.source_request_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.currency IS DISTINCT FROM OLD.currency THEN
   RAISE EXCEPTION 'Linked canonical contract provenance is immutable' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(SUM(total_amount),0) INTO used FROM public.purchase_orders WHERE contract_id=OLD.id AND status IN ('PO_ISSUED','PO_PARTIAL','PO_DELIVERED','PO_CLOSED');
  IF NEW.contract_value IS NULL OR NEW.contract_value<=0 OR NEW.contract_value<>round(NEW.contract_value,2) OR NEW.contract_value<used THEN
   RAISE EXCEPTION 'Contract ceiling cannot invalidate canonical issued commitments' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contract_canonical_commitment_guard ON public.contracts;
CREATE TRIGGER contract_canonical_commitment_guard BEFORE UPDATE OF source_request_id,supplier_id,currency,contract_value ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.guard_contract_canonical_commitment();
CREATE OR REPLACE FUNCTION public.guard_canonical_invoice_contract_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p public.purchase_orders%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.purchase_orders WHERE id=NEW.purchase_order_id;
 IF NEW.contract_id IS NOT NULL OR p.contract_id IS NOT NULL OR (TG_OP='UPDATE' AND OLD.contract_id IS NOT NULL) THEN
  IF NEW.contract_id IS DISTINCT FROM p.contract_id OR NEW.request_id IS DISTINCT FROM p.request_id OR NEW.supplier_id IS DISTINCT FROM p.supplier_id OR NEW.currency IS DISTINCT FROM p.currency THEN
   RAISE EXCEPTION 'Invoice contract must inherit its canonical PO source' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.contract_id IS DISTINCT FROM OLD.contract_id OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
   RAISE EXCEPTION 'Canonical invoice source is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS canonical_invoice_contract_source_guard ON public.supplier_invoices;
CREATE TRIGGER canonical_invoice_contract_source_guard BEFORE INSERT OR UPDATE OF contract_id,purchase_order_id,request_id,supplier_id,currency ON public.supplier_invoices FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_invoice_contract_source();
COMMIT;
