-- MANUAL DATABASE MIGRATION REQUIRED. Run in Supabase SQL Editor before deploying.
-- Request-level ordering is separate from item assessments and legacy rank history.
BEGIN;
CREATE TABLE IF NOT EXISTS public.request_priority_rankings (
  request_id BIGINT PRIMARY KEY REFERENCES public.requests(id),
  institute_id BIGINT NOT NULL,
  department_id BIGINT NOT NULL,
  department_rank INTEGER CHECK (department_rank > 0),
  institutional_rank INTEGER CHECK (institutional_rank > 0),
  institutional_override_reason TEXT,
  row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version > 0),
  updated_by BIGINT REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_priority_department_order
  ON public.request_priority_rankings(institute_id,department_id,department_rank);
CREATE INDEX IF NOT EXISTS request_priority_institutional_order
  ON public.request_priority_rankings(institute_id,institutional_rank);
-- These internal ranks are served only by authorized backend routes.
ALTER TABLE public.request_priority_rankings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.request_priority_rankings FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.request_priority_rankings FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.request_priority_rankings FROM authenticated;
  END IF;
END $$;
-- No backfill or rewrite: until explicitly saved, the backend derives one
-- request position from the highest existing active item position. Historical
-- item rankings, assessments, profiles and audit records remain untouched.
COMMIT;
