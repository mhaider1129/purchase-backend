-- AUD-005. Apply manually before deploying the contract authorization boundary.
-- No ownership is guessed from free text or a creator's current placement.
-- Existing rows remain unchanged; unambiguous request/department provenance is
-- resolved by the application. Unresolved/conflicting roots fail closed.
BEGIN;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS institute_id INTEGER;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contracts'::regclass AND conname='contracts_institute_scope_fkey') THEN
  ALTER TABLE public.contracts ADD CONSTRAINT contracts_institute_scope_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS contracts_institute_scope_idx ON public.contracts(institute_id);
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS generated_from_obligation_id BIGINT;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_obligations'::regclass AND conname='contract_obligations_generated_source_fkey') THEN
  ALTER TABLE public.contract_obligations ADD CONSTRAINT contract_obligations_generated_source_fkey FOREIGN KEY (generated_from_obligation_id) REFERENCES public.contract_obligations(id) NOT VALID;
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS contract_obligations_generated_source_uq ON public.contract_obligations(generated_from_obligation_id) WHERE generated_from_obligation_id IS NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
  WHERE i.indrelid='public.contract_obligations'::regclass
    AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts=1
    AND a.attname='generated_from_obligation_id'
    AND (i.indpred IS NULL OR pg_get_expr(i.indpred,i.indrelid)='(generated_from_obligation_id IS NOT NULL)')
 ) THEN RAISE EXCEPTION 'Canonical recurring obligation source uniqueness is required; inspect the existing same-name index'; END IF;
END $$;
COMMIT;
