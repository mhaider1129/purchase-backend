-- MANUAL DATABASE MIGRATION REQUIRED. Apply complete 059, 064 and 065 first.
-- Review metadata only. Never backfill, post, pay, reverse or change historical money.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF to_regprocedure('public.guard_canonical_invoice_contract_source()') IS NULL THEN
  RAISE EXCEPTION 'Complete canonical contract finance SQL 065 is required';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.contract_financial_reviews (
 id BIGSERIAL PRIMARY KEY,
 institute_id INTEGER NOT NULL REFERENCES public.institutes(id),
 contract_id INTEGER NOT NULL REFERENCES public.contracts(id),
 record_type TEXT NOT NULL CHECK(record_type IN ('legacy_invoice','legacy_payment')),
 source_id BIGINT NOT NULL CHECK(source_id>0),
 revision INTEGER NOT NULL CHECK(revision>0),
 decision TEXT NOT NULL CHECK(decision IN ('CONFIRMED_MATCH','REJECTED_PROPOSAL','CONFLICTING','NEEDS_INVESTIGATION')),
 canonical_ids BIGINT[] NOT NULL DEFAULT '{}',
 source_fingerprint TEXT NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 evidence_snapshot JSONB NOT NULL,
 supporting_evidence TEXT NOT NULL CHECK(length(trim(supporting_evidence)) BETWEEN 1 AND 8000),
 notes TEXT NOT NULL CHECK(length(trim(notes)) BETWEEN 1 AND 4000),
 reviewer_id INTEGER NOT NULL REFERENCES public.users(id),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 command_key TEXT NOT NULL CHECK(length(command_key) BETWEEN 8 AND 200),
 command_fingerprint TEXT NOT NULL CHECK(command_fingerprint ~ '^[a-f0-9]{64}$'),
 UNIQUE(institute_id,record_type,source_id,revision),
 UNIQUE(institute_id,command_key)
);
CREATE INDEX IF NOT EXISTS contract_financial_reviews_worklist_idx ON public.contract_financial_reviews(institute_id,contract_id,record_type,source_id,revision DESC);
CREATE OR REPLACE FUNCTION public.preserve_contract_financial_reviews() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Financial reconciliation reviews are append-only; record a new revision' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS contract_financial_reviews_append_only ON public.contract_financial_reviews;
CREATE TRIGGER contract_financial_reviews_append_only BEFORE UPDATE OR DELETE ON public.contract_financial_reviews FOR EACH ROW EXECUTE FUNCTION public.preserve_contract_financial_reviews();
DROP TRIGGER IF EXISTS contract_financial_reviews_no_truncate ON public.contract_financial_reviews;
CREATE TRIGGER contract_financial_reviews_no_truncate BEFORE TRUNCATE ON public.contract_financial_reviews FOR EACH STATEMENT EXECUTE FUNCTION public.preserve_contract_financial_reviews();
ALTER TABLE public.contract_financial_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_financial_reviews FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.contract_financial_reviews_id_seq FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.contract_financial_reviews FROM anon; REVOKE ALL ON SEQUENCE public.contract_financial_reviews_id_seq FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.contract_financial_reviews FROM authenticated; REVOKE ALL ON SEQUENCE public.contract_financial_reviews_id_seq FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON public.contract_financial_reviews FROM service_role;
  REVOKE ALL ON SEQUENCE public.contract_financial_reviews_id_seq FROM service_role;
  GRANT SELECT,INSERT ON public.contract_financial_reviews TO service_role;
  GRANT USAGE,SELECT ON SEQUENCE public.contract_financial_reviews_id_seq TO service_role;
 END IF;
END $$;
COMMIT;
