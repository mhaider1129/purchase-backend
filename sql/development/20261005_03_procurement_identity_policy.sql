-- MANUAL DATABASE MIGRATION REQUIRED. Apply through the owner's SQL Editor.
-- Additive only; leaves all existing request/catalog/stock data unchanged.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.item_master_audit_events') IS NULL THEN
    RAISE EXCEPTION 'Item Master foundation migration must be applied first';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.procurement_identity_policy (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  enforce_item_identity BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT NOT NULL,
  updated_by INTEGER REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.procurement_identity_policy(id,enforce_item_identity,reason)
VALUES(1,TRUE,'Strict Item Master enforcement by default') ON CONFLICT(id) DO NOTHING;
-- This configuration is accessible through authorized backend commands only.
ALTER TABLE public.procurement_identity_policy ENABLE ROW LEVEL SECURITY;
COMMIT;
-- Postflight: expect exactly one row, strict unless previously changed by Management.
SELECT id,enforce_item_identity,reason,updated_at FROM public.procurement_identity_policy;
